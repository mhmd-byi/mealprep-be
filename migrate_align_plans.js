require('dotenv').config();
const mongoose = require('mongoose');
const Subscription = require('./api/models/subscriptionModel');
const { loadAllPlans, backfillPricePerMeal } = require('./api/utils/planCatalog');
const { loadAllCarbTypes } = require('./api/utils/carbTypeCatalog');

const MONGODB_URL = process.env.MONGODB_URL;
const args = process.argv.slice(2);
const isLive = args.includes('--live');

if (!MONGODB_URL) {
  console.error('ERROR: MONGODB_URL is not set in .env');
  process.exit(1);
}

const flagValues = (flag) =>
  args.flatMap((arg, index) => {
    if (arg.startsWith(`${flag}=`)) return [arg.slice(flag.length + 1)];
    if (arg === flag && args[index + 1]) return [args[index + 1]];
    return [];
  });

const parsePairs = (flag) =>
  flagValues(flag).map((value) => {
    const split = value.indexOf('=');
    if (split < 1) {
      console.error(`ERROR: ${flag} needs the form "old value=new value", got "${value}"`);
      process.exit(1);
    }
    return [value.slice(0, split).trim(), value.slice(split + 1).trim()];
  });

const norm = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const slugNorm = (value) => String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
const show = (value) => (value === '' || value === null || value === undefined ? '(empty)' : `"${value}"`);

const KEYWORDS = ['trial', 'weekly', 'monthly'];

const suggestPlan = (value, plans) => {
  const word = KEYWORDS.find((keyword) => norm(value).includes(keyword));
  if (!word) return null;
  const matches = plans.filter((plan) => norm(plan.name).includes(word));
  return matches.length === 1 ? matches[0].name : null;
};

const describeGroups = async (field) =>
  Subscription.aggregate([
    {
      $group: {
        _id: `$${field}`,
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        priced: { $sum: { $cond: [{ $gt: ['$pricePerMeal', 0] }, 1, 0] } }
      }
    },
    { $sort: { total: -1 } }
  ]);

const classify = ({ groups, exactKeys, normalizeKey, lookupByNorm, explicit }) => {
  const result = { ok: [], fix: [], mapped: [], unmapped: [] };
  for (const group of groups) {
    const value = group._id;
    if (exactKeys.has(value)) {
      result.ok.push({ value, group });
      continue;
    }
    const explicitTarget = explicit.get(normalizeKey(value));
    if (explicitTarget) {
      result.mapped.push({ value, group, target: explicitTarget });
      continue;
    }
    const safeTarget = lookupByNorm.get(normalizeKey(value));
    if (safeTarget) {
      result.fix.push({ value, group, target: safeTarget });
      continue;
    }
    result.unmapped.push({ value, group });
  }
  return result;
};

const sampleUsers = async (field, value) => {
  const found = await Subscription.find({ [field]: value }, 'userId status createdAt').sort({ createdAt: -1 }).limit(3).lean();
  return found.map((sub) => `${sub.userId} (${sub.status})`).join(', ');
};

const printSection = async (title, field, classified, suggest) => {
  console.log(`\n=== ${title} ===`);
  console.log(`  Already matching : ${classified.ok.map((item) => `${show(item.value)} x${item.group.total}`).join(', ') || 'none'}`);
  for (const item of classified.fix) {
    console.log(`  [fix spelling]   ${show(item.value)} x${item.group.total}  ->  "${item.target}"`);
  }
  for (const item of classified.mapped) {
    console.log(`  [your mapping]   ${show(item.value)} x${item.group.total}  ->  "${item.target}"`);
  }
  for (const item of classified.unmapped) {
    const hint = suggest(item.value);
    console.log(`  [NEEDS A DECISION] ${show(item.value)} x${item.group.total} (${item.group.active} active). Example subscriptions: ${await sampleUsers(field, item.value)}`);
    if (hint) console.log(`      Suggestion: add  ${hint}`);
  }
};

async function run() {
  console.log(`Connecting to MongoDB... (${isLive ? 'LIVE run - will write changes' : 'DRY RUN - no changes will be written'})\n`);
  await mongoose.connect(MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log(`Connected to database "${mongoose.connection.name}" on ${mongoose.connection.host}.`);

  const plans = await loadAllPlans();
  const carbTypes = await loadAllCarbTypes();

  const planByNorm = new Map(plans.map((plan) => [norm(plan.name), plan.name]));
  const planExplicit = new Map();
  for (const [from, to] of parsePairs('--map')) {
    const target = planByNorm.get(norm(to));
    if (!target) {
      console.error(`ERROR: --map target "${to}" is not one of your plans: ${plans.map((plan) => plan.name).join(', ')}`);
      await mongoose.disconnect();
      process.exit(1);
    }
    planExplicit.set(norm(from), target);
  }

  const carbBySlug = new Map(carbTypes.map((item) => [item.slug, item.slug]));
  const carbLookup = new Map(carbTypes.flatMap((item) => [[slugNorm(item.slug), item.slug], [slugNorm(item.name), item.slug]]));
  const carbExplicit = new Map();
  for (const [from, to] of parsePairs('--map-carb')) {
    const target = carbBySlug.get(slugNorm(to));
    if (!target) {
      console.error(`ERROR: --map-carb target "${to}" is not one of your carb types: ${carbTypes.map((item) => item.slug).join(', ')}`);
      await mongoose.disconnect();
      process.exit(1);
    }
    carbExplicit.set(slugNorm(from), target);
  }

  const planGroups = await describeGroups('plan');
  const carbGroups = await describeGroups('carbType');

  const planResult = classify({
    groups: planGroups,
    exactKeys: new Set(plans.map((plan) => plan.name)),
    normalizeKey: norm,
    lookupByNorm: planByNorm,
    explicit: planExplicit
  });
  const carbResult = classify({
    groups: carbGroups,
    exactKeys: new Set(carbTypes.map((item) => item.slug)),
    normalizeKey: slugNorm,
    lookupByNorm: carbLookup,
    explicit: carbExplicit
  });

  await printSection('PLANS on subscriptions', 'plan', planResult, (value) => {
    const suggestion = suggestPlan(value, plans);
    return suggestion ? `--map "${value}=${suggestion}"` : null;
  });
  await printSection('CARB TYPES on subscriptions', 'carbType', carbResult, () => null);

  const withoutPrice = planGroups.reduce((sum, group) => sum + (group.total - group.priced), 0);
  console.log(`\nSubscriptions without a saved per-meal price: ${withoutPrice}`);

  const planChanges = [...planResult.fix, ...planResult.mapped];
  const carbChanges = [...carbResult.fix, ...carbResult.mapped];

  if (isLive) {
    for (const item of planChanges) {
      const outcome = await Subscription.updateMany({ plan: item.value }, { $set: { plan: item.target } }, { timestamps: false });
      console.log(`  plan ${show(item.value)} -> "${item.target}": ${outcome.nModified ?? outcome.modifiedCount ?? item.group.total} updated`);
    }
    for (const item of carbChanges) {
      const outcome = await Subscription.updateMany({ carbType: item.value }, { $set: { carbType: item.target } }, { timestamps: false });
      console.log(`  carb type ${show(item.value)} -> "${item.target}": ${outcome.nModified ?? outcome.modifiedCount ?? item.group.total} updated`);
    }
    for (const plan of plans) {
      const outcome = await backfillPricePerMeal(plan.name, plan.price, plan.meals);
      const changed = outcome.nModified ?? outcome.modifiedCount ?? 0;
      if (changed > 0) console.log(`  saved the per-meal price (${(plan.price / plan.meals).toFixed(2)}) on ${changed} "${plan.name}" subscription(s)`);
    }
  }

  console.log('\n-------------------------------------');
  console.log('Summary:');
  console.log(`  Plan values fixed/mapped        : ${planChanges.length}`);
  console.log(`  Carb type values fixed/mapped   : ${carbChanges.length}`);
  console.log(`  Plan values needing a decision  : ${planResult.unmapped.length}`);
  console.log(`  Carb values needing a decision  : ${carbResult.unmapped.length}`);
  console.log(`  Mode: ${isLive ? 'LIVE (changes written)' : 'DRY RUN (nothing written, re-run with --live to apply)'}`);
  console.log('-------------------------------------\n');

  await mongoose.disconnect();
}

run().catch((error) => {
  console.error('Alignment failed:', error);
  process.exit(1);
});
