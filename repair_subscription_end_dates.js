require('dotenv').config();
const mongoose = require('mongoose');
const Subscription = require('./api/models/subscriptionModel');
const MealDelivery = require('./api/models/mealDeliveryModel');

const MONGODB_URL = process.env.MONGODB_URL;
const args = process.argv.slice(2);
const isLive = args.includes('--live');
const MIN_BULK_SIZE = 50;
const BATCH = 500;

if (!MONGODB_URL) {
  console.error('ERROR: MONGODB_URL is not set in .env');
  process.exit(1);
}

const flagValue = (flag) => {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const parseDate = (value, flag) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    console.error(`ERROR: ${flag} must be a date and time such as 2026-11-12T11:00:00+05:30, got "${value}"`);
    process.exit(1);
  }
  return date;
};

const detectWindow = async () => {
  const minutes = await Subscription.aggregate([
    { $group: { _id: { $dateToString: { format: '%Y-%m-%dT%H:%M:00.000Z', date: '$updatedAt' } }, total: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: 3 }
  ]);
  console.log('Busiest minutes for "last modified" across all subscriptions (UTC):');
  minutes.forEach((row) => console.log(`  ${row._id}  ${row.total}`));
  const top = minutes[0];
  if (!top || top.total < MIN_BULK_SIZE) return null;
  const start = new Date(top._id);
  return { start: new Date(start.getTime() - 60 * 1000), end: new Date(start.getTime() + 2 * 60 * 1000) };
};

async function run() {
  console.log(`Connecting... (${isLive ? 'LIVE run - will write changes' : 'DRY RUN - nothing will be written'})`);
  await mongoose.connect(MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log(`Connected to database "${mongoose.connection.name}" on ${mongoose.connection.host}.\n`);

  let windowStart = flagValue('--from') ? parseDate(flagValue('--from'), '--from') : null;
  let windowEnd = flagValue('--to') ? parseDate(flagValue('--to'), '--to') : null;
  if (!windowStart || !windowEnd) {
    const detected = await detectWindow();
    if (!detected) {
      console.log('\nNo bulk change found (no single minute touched ' + MIN_BULK_SIZE + ' or more subscriptions). Nothing to repair.');
      await mongoose.disconnect();
      return;
    }
    windowStart = detected.start;
    windowEnd = detected.end;
  }
  console.log(`\nRepair window: ${windowStart.toISOString()} to ${windowEnd.toISOString()} (UTC)`);

  const affected = await Subscription.find(
    { status: { $in: ['completed', 'cancelled'] }, updatedAt: { $gte: windowStart, $lte: windowEnd } },
    '_id status createdAt'
  ).lean();
  console.log(`Completed or cancelled subscriptions touched in that window: ${affected.length}`);

  const lastDelivery = new Map();
  for (let index = 0; index < affected.length; index += BATCH) {
    const ids = affected.slice(index, index + BATCH).map((sub) => sub._id);
    const rows = await MealDelivery.aggregate([
      { $match: { subscriptionId: { $in: ids } } },
      { $group: { _id: '$subscriptionId', last: { $max: '$createdAt' } } }
    ]);
    rows.forEach((row) => lastDelivery.set(String(row._id), row.last));
  }

  const operations = [];
  let noDeliveries = 0;
  let tooRecent = 0;
  const samples = [];
  for (const sub of affected) {
    const last = lastDelivery.get(String(sub._id));
    if (!last) {
      noDeliveries += 1;
      continue;
    }
    if (last >= windowStart) {
      tooRecent += 1;
      continue;
    }
    operations.push({ updateOne: { filter: { _id: sub._id }, update: { $set: { updatedAt: last } } } });
    if (samples.length < 5) samples.push(`${sub._id}  ->  ${new Date(last).toISOString()}`);
  }

  console.log(`  Can be restored from their last meal delivery : ${operations.length}`);
  console.log(`  Have no meal delivery records (left unchanged) : ${noDeliveries}`);
  console.log(`  Last delivery is inside the window (left)       : ${tooRecent}`);
  if (samples.length) {
    console.log('  Examples (subscription -> restored end time):');
    samples.forEach((line) => console.log(`    ${line}`));
  }

  if (isLive && operations.length > 0) {
    let written = 0;
    for (let index = 0; index < operations.length; index += BATCH) {
      const result = await Subscription.collection.bulkWrite(operations.slice(index, index + BATCH), { ordered: false });
      written += result.modifiedCount ?? result.nModified ?? 0;
    }
    console.log(`\nRestored ${written} subscription end times.`);
  }

  console.log('\n-------------------------------------');
  console.log(`Mode: ${isLive ? 'LIVE (changes written)' : 'DRY RUN (nothing written, re-run with --live to apply)'}`);
  console.log('-------------------------------------\n');
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error('Repair failed:', error);
  process.exit(1);
});
