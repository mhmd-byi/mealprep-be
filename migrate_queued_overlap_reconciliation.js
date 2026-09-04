/**
 * One-time reconciliation: promote existing QUEUED subscriptions that no
 * longer need to queue under the new overlap rule.
 *
 * Context: previously, ANY purchase made while a user had an active
 * subscription was queued, regardless of meal type. We changed that so a
 * purchase only queues if it actually shares a meal-type track with an
 * active plan (e.g. buying dinner while only lunch is active now activates
 * immediately instead of queuing). That change only affects NEW purchases
 * going forward — it does not touch subscriptions that were already queued
 * under the old rule. This script finds any such subscription that would now
 * qualify as non-overlapping and activates it, using the exact same
 * meal-split logic as activateNextQueuedPlan() in api/jobs/mealJobs.js
 * (time-of-day cutoff -> current vs next-day buckets).
 *
 * Safe to re-run: only touches documents with status: 'queued', and once
 * promoted to 'active' they're no longer matched by the query.
 *
 * Run in dry-run mode first (default) to review exactly what would change:
 *   node migrate_queued_overlap_reconciliation.js
 * Then apply for real:
 *   node migrate_queued_overlap_reconciliation.js --live
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Subscription = require('./api/models/subscriptionModel');
const {
  todayCalendarDateUTC,
  currentISTMinutesSinceMidnight,
} = require('./api/utils/dateUtils');

const MONGODB_URL = process.env.MONGODB_URL;
const isLive = process.argv.includes('--live');

if (!MONGODB_URL) {
  console.error('ERROR: MONGODB_URL is not set in .env');
  process.exit(1);
}

const LUNCH_CUTOFF_MINUTES = 10.5 * 60; // 10:30 AM
const DINNER_CUTOFF_MINUTES = 16 * 60; // 4:00 PM

const getMealCoverage = (sub) => ({
  lunch: (sub.lunchMeals || 0) + (sub.nextDayLunchMeals || 0) > 0,
  dinner: (sub.dinnerMeals || 0) + (sub.nextDayDinnerMeals || 0) > 0,
});

async function reconcile() {
  console.log(`Connecting to MongoDB... (${isLive ? 'LIVE run — will write changes' : 'DRY RUN — no changes will be written'})\n`);
  await mongoose.connect(MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected.\n');

  const queuedSubs = await Subscription.find({ status: 'queued' }).sort({ createdAt: 1, _id: 1 });

  if (queuedSubs.length === 0) {
    console.log('No queued subscriptions found. Nothing to reconcile.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${queuedSubs.length} queued subscription(s) to evaluate.\n`);

  const currentTimeInMinutes = currentISTMinutesSinceMidnight();
  const today = todayCalendarDateUTC();

  let promoted = 0;
  let leftQueued = 0;

  for (const queuedSub of queuedSubs) {
    // Re-fetch fresh each time — an earlier promotion in this same run could
    // change what counts as "active" for the same user.
    const activeSubs = await Subscription.find({ userId: queuedSub.userId, status: 'active' });
    const queuedCoverage = getMealCoverage(queuedSub);
    const activeLunch = activeSubs.some((s) => getMealCoverage(s).lunch);
    const activeDinner = activeSubs.some((s) => getMealCoverage(s).dinner);
    const overlaps = (queuedCoverage.lunch && activeLunch) || (queuedCoverage.dinner && activeDinner);

    if (overlaps) {
      leftQueued++;
      console.log(`  [leave queued] sub=${queuedSub._id} user=${queuedSub.userId} plan=${queuedSub.plan} — still overlaps an active plan.`);
      continue;
    }

    // Non-overlapping — activate it now, applying the same time-of-day split
    // activateNextQueuedPlan() uses.
    const rawLunch = queuedSub.lunchMeals || 0;
    const rawDinner = queuedSub.dinnerMeals || 0;

    let lunchMeals = rawLunch;
    let dinnerMeals = rawDinner;
    let nextDayLunchMeals = 0;
    let nextDayDinnerMeals = 0;

    if (currentTimeInMinutes > LUNCH_CUTOFF_MINUTES && lunchMeals > 0) {
      nextDayLunchMeals = lunchMeals;
      lunchMeals = 0;
    }
    if (currentTimeInMinutes > DINNER_CUTOFF_MINUTES && dinnerMeals > 0) {
      nextDayDinnerMeals = dinnerMeals;
      dinnerMeals = 0;
    }

    console.log(
      `  [PROMOTE to active] sub=${queuedSub._id} user=${queuedSub.userId} plan=${queuedSub.plan} — ` +
      `lunch=${lunchMeals} dinner=${dinnerMeals} nextDayLunch=${nextDayLunchMeals} nextDayDinner=${nextDayDinnerMeals}`
    );
    promoted++;

    if (isLive) {
      await Subscription.findByIdAndUpdate(queuedSub._id, {
        status: 'active',
        subscriptionStartDate: today,
        lunchMeals,
        dinnerMeals,
        nextDayLunchMeals,
        nextDayDinnerMeals,
      });
    }
  }

  console.log('\n─────────────────────────────────────');
  console.log('Reconciliation Summary:');
  console.log(`  Promoted to active : ${promoted}`);
  console.log(`  Left queued        : ${leftQueued}`);
  console.log(`  Mode               : ${isLive ? 'LIVE (changes written)' : 'DRY RUN (no changes written — re-run with --live to apply)'}`);
  console.log('─────────────────────────────────────\n');

  await mongoose.disconnect();
}

reconcile().catch((err) => {
  console.error('Reconciliation failed:', err);
  process.exit(1);
});
