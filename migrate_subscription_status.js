/**
 * Migration Script: Backfill `status` field on Subscription documents
 *
 * Before this migration, subscriptions had no `status` field.
 * The new queued-subscription feature requires every document to have:
 *   status: 'active' | 'queued' | 'completed'
 *
 * Logic applied per user (grouped):
 *   - Skip any doc that already has a status (idempotent).
 *   - For each user's subscriptions sorted oldest → newest:
 *       • The LATEST subscription with meals > 0 → 'active'
 *       • All other subscriptions with meals > 0 that are older → 'completed'
 *         (edge case: shouldn't normally exist, but handled safely)
 *       • All subscriptions with no meals left → 'completed'
 *
 * Run with:
 *   node migrate_subscription_status.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Subscription = require('./api/models/subscriptionModel');

const MONGODB_URL = process.env.MONGODB_URL;

if (!MONGODB_URL) {
  console.error('ERROR: MONGODB_URL is not set in .env');
  process.exit(1);
}

const totalMealsOf = (sub) =>
  (sub.lunchMeals || 0) +
  (sub.dinnerMeals || 0) +
  (sub.nextDayLunchMeals || 0) +
  (sub.nextDayDinnerMeals || 0);

async function migrate() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('Connected.\n');

  // Only process documents that don't have a status yet
  const unmigratedDocs = await Subscription.find({
    status: { $exists: false },
  }).sort({ userId: 1, createdAt: 1, _id: 1 });

  if (unmigratedDocs.length === 0) {
    console.log('✅ All subscriptions already have a status field. Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${unmigratedDocs.length} subscription(s) without a status field.\n`);

  // Group by userId so we can decide which one gets 'active'
  const byUser = {};
  for (const sub of unmigratedDocs) {
    const uid = sub.userId.toString();
    if (!byUser[uid]) byUser[uid] = [];
    byUser[uid].push(sub);
  }

  const stats = { active: 0, completed: 0, skipped: 0 };
  const updates = []; // collect bulk write ops

  for (const [userId, subs] of Object.entries(byUser)) {
    // Subs are already sorted oldest → newest (createdAt ASC from query above)
    // Find the LAST (most recent) subscription that still has meals left
    let activeCandidateIndex = -1;
    for (let i = subs.length - 1; i >= 0; i--) {
      if (totalMealsOf(subs[i]) > 0) {
        activeCandidateIndex = i;
        break;
      }
    }

    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      const meals = totalMealsOf(sub);

      let newStatus;
      if (i === activeCandidateIndex) {
        // Most recent sub with meals remaining → active
        newStatus = 'active';
        stats.active++;
      } else if (meals > 0) {
        // Older sub still showing meals (shouldn't happen normally) → completed
        // (treat as historical, meals already consumed)
        newStatus = 'completed';
        stats.completed++;
        console.warn(
          `  ⚠️  User ${userId}: older sub ${sub._id} has ${meals} meals but is not the latest — marking completed.`
        );
      } else {
        // No meals left → completed
        newStatus = 'completed';
        stats.completed++;
      }

      updates.push({
        updateOne: {
          filter: { _id: sub._id },
          update: { $set: { status: newStatus } },
        },
      });

      console.log(
        `  Sub ${sub._id}  user=${userId}  meals=${meals}  → status='${newStatus}'`
      );
    }
  }

  if (updates.length > 0) {
    console.log(`\nApplying ${updates.length} update(s)...`);
    const result = await Subscription.bulkWrite(updates);
    console.log(`Bulk write complete: ${result.modifiedCount} document(s) modified.\n`);
  }

  console.log('─────────────────────────────────────');
  console.log(`Migration Summary:`);
  console.log(`  Marked active    : ${stats.active}`);
  console.log(`  Marked completed : ${stats.completed}`);
  console.log(`  Already had status (skipped): ${stats.skipped}`);
  console.log('─────────────────────────────────────');
  console.log('✅ Migration complete.\n');

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
