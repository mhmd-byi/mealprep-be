require('dotenv').config();
const mongoose = require('mongoose');
const Subscription = require('./api/models/subscriptionModel');
const MealDelivery = require('./api/models/mealDeliveryModel');
const MealCancellation = require('./api/models/mealcancellation');
const Holiday = require('./api/models/holidayModel');
const { loadAllPlans } = require('./api/utils/planCatalog');
const { parseCalendarDate, calendarDateKey, addCalendarDays } = require('./api/utils/dateUtils');

const MONGODB_URL = process.env.MONGODB_URL;
const args = process.argv.slice(2);
const isLive = args.includes('--live');
const MIN_BULK_SIZE = 50;
const BATCH = 500;
const MAX_DAYS = 400;

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

const parseFlagDate = (flag) => {
  const value = flagValue(flag);
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    console.error(`ERROR: ${flag} must be a date and time such as 2026-11-12T11:00:00+05:30, got "${value}"`);
    process.exit(1);
  }
  return date;
};

const detectBulkWindow = async () => {
  const minutes = await Subscription.aggregate([
    { $match: { status: { $in: ['completed', 'cancelled'] } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%dT%H:%M:00.000Z', date: '$updatedAt' } }, total: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: 1 }
  ]);
  const top = minutes[0];
  if (!top || top.total < MIN_BULK_SIZE) return null;
  const start = new Date(top._id);
  return { start: new Date(start.getTime() - 60 * 1000), end: new Date(start.getTime() + 2 * 60 * 1000) };
};

const atIstTime = (calendarDate, hours, minutes) => {
  const date = new Date(calendarDate);
  date.setUTCHours(hours, minutes, 0, 0);
  return new Date(date.getTime() - 330 * 60 * 1000);
};

const estimateEnd = (sub, { plansByName, holidayKeys, cancellationsByUser }) => {
  const start = sub.subscriptionStartDate ? parseCalendarDate(sub.subscriptionStartDate) : parseCalendarDate(sub.createdAt);
  const plan = plansByName.get(sub.plan);
  const perDay = plan && sub.totalMeals === plan.meals * 2 ? 2 : 1;
  const daysNeeded = Math.max(1, Math.ceil((sub.totalMeals || 1) / perDay));
  const cancellations = cancellationsByUser.get(String(sub.userId)) || [];
  const cancelledOn = (key) => cancellations.some((range) => key >= range.from && key <= range.to);

  let counted = 0;
  let day = start;
  for (let step = 0; step < MAX_DAYS; step += 1) {
    const key = calendarDateKey(day);
    const deliveryDay = day.getUTCDay() !== 0 && !holidayKeys.has(key) && !cancelledOn(key);
    if (deliveryDay) {
      counted += 1;
      if (counted >= daysNeeded) break;
    }
    day = addCalendarDays(day, 1);
  }
  return perDay === 2 ? atIstTime(day, 16, 45) : atIstTime(day, 10, 45);
};

async function run() {
  console.log(`Connecting... (${isLive ? 'LIVE run - will write changes' : 'DRY RUN - nothing will be written'})`);
  await mongoose.connect(MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log(`Connected to database "${mongoose.connection.name}" on ${mongoose.connection.host}.\n`);

  const targets = await Subscription.find(
    { status: { $in: ['completed', 'cancelled'] }, endedAt: null },
    '_id userId plan status totalMeals subscriptionStartDate createdAt updatedAt'
  ).lean();
  console.log(`Completed or cancelled subscriptions without an end date: ${targets.length}`);
  if (targets.length === 0) {
    await mongoose.disconnect();
    return;
  }

  let windowStart = parseFlagDate('--from');
  let windowEnd = parseFlagDate('--to');
  if (!windowStart || !windowEnd) {
    const detected = await detectBulkWindow();
    windowStart = detected ? detected.start : null;
    windowEnd = detected ? detected.end : null;
  }
  const inBulkWindow = (date) => Boolean(windowStart && windowEnd && date >= windowStart && date <= windowEnd);
  console.log(windowStart ? `Bulk-change window ignored as an end date: ${windowStart.toISOString()} to ${windowEnd.toISOString()} (UTC)` : 'No bulk-change window found.');

  const lastDelivery = new Map();
  for (let index = 0; index < targets.length; index += BATCH) {
    const ids = targets.slice(index, index + BATCH).map((sub) => sub._id);
    const rows = await MealDelivery.aggregate([
      { $match: { subscriptionId: { $in: ids } } },
      { $group: { _id: '$subscriptionId', last: { $max: '$createdAt' } } }
    ]);
    rows.forEach((row) => lastDelivery.set(String(row._id), row.last));
  }

  const needEstimate = targets.filter(
    (sub) => !(sub.status === 'completed' && lastDelivery.has(String(sub._id))) && inBulkWindow(new Date(sub.updatedAt))
  );

  const plansByName = new Map((await loadAllPlans()).map((plan) => [plan.name, plan]));
  const holidayKeys = new Set((await Holiday.find({}, 'date').lean()).map((holiday) => calendarDateKey(parseCalendarDate(holiday.date))));
  const cancellationsByUser = new Map();
  if (needEstimate.length > 0) {
    const userIds = [...new Set(needEstimate.map((sub) => String(sub.userId)))].map((id) => new mongoose.Types.ObjectId(id));
    const cancellations = await MealCancellation.find({ userId: { $in: userIds } }, 'userId startDate endDate').lean();
    cancellations.forEach((row) => {
      if (!row.startDate || !row.endDate) return;
      const key = String(row.userId);
      cancellationsByUser.set(key, [
        ...(cancellationsByUser.get(key) || []),
        { from: calendarDateKey(parseCalendarDate(row.startDate)), to: calendarDateKey(parseCalendarDate(row.endDate)) }
      ]);
    });
  }

  const counts = { delivery: 0, recorded: 0, estimated: 0 };
  const samples = { delivery: [], recorded: [], estimated: [] };
  const operations = targets.map((sub) => {
    let endedAt;
    let estimated = false;
    let source;
    const updatedAt = new Date(sub.updatedAt);
    if (sub.status === 'completed' && lastDelivery.has(String(sub._id))) {
      endedAt = new Date(lastDelivery.get(String(sub._id)));
      source = 'delivery';
    } else if (!inBulkWindow(updatedAt)) {
      endedAt = updatedAt;
      source = 'recorded';
    } else {
      endedAt = sub.status === 'cancelled' ? new Date(sub.createdAt) : estimateEnd(sub, { plansByName, holidayKeys, cancellationsByUser });
      if (windowStart && endedAt > windowStart) endedAt = windowStart;
      estimated = true;
      source = 'estimated';
    }
    counts[source] += 1;
    if (samples[source].length < 3) samples[source].push(`${sub._id} (${sub.plan}, bought ${new Date(sub.createdAt).toISOString().slice(0, 10)}) -> ${endedAt.toISOString().slice(0, 10)}`);
    return { updateOne: { filter: { _id: sub._id, endedAt: null }, update: { $set: { endedAt, endedAtEstimated: estimated } } } };
  });

  console.log(`\n  From the last meal delivery record      : ${counts.delivery}`);
  console.log(`  From the time it was marked ended       : ${counts.recorded}`);
  console.log(`  Estimated (start date + meals, skipping Sundays, holidays and the customer's cancellations): ${counts.estimated}`);
  Object.entries(samples).forEach(([source, lines]) => {
    if (lines.length) {
      console.log(`  Examples (${source}):`);
      lines.forEach((line) => console.log(`    ${line}`));
    }
  });

  if (isLive) {
    let written = 0;
    for (let index = 0; index < operations.length; index += BATCH) {
      const result = await Subscription.collection.bulkWrite(operations.slice(index, index + BATCH), { ordered: false });
      written += result.modifiedCount ?? result.nModified ?? 0;
    }
    console.log(`\nSaved an end date on ${written} subscriptions.`);
  }

  console.log('\n-------------------------------------');
  console.log(`Mode: ${isLive ? 'LIVE (changes written)' : 'DRY RUN (nothing written, re-run with --live to apply)'}`);
  console.log('-------------------------------------\n');
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
