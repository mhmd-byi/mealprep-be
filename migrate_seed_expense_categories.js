/**
 * One-time seed: creates the ExpenseCategory master records that match the
 * categories/colors the Expenses module used to have hardcoded (see the old
 * EXPENSE_CATEGORIES / CATEGORY_COLORS in mealprep-fe's constants.js). Needed
 * because Expense.category is no longer schema-validated against a fixed
 * enum — it's validated dynamically against this collection instead, and
 * admin can add/rename/delete categories and subcategories from the UI.
 *
 * Safe to re-run: skips any category name that already exists.
 *
 * Run in dry-run mode first (default) to review exactly what would be created:
 *   node migrate_seed_expense_categories.js
 * Then apply for real:
 *   node migrate_seed_expense_categories.js --live
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ExpenseCategory = require('./api/models/expenseCategoryModel');

const MONGODB_URL = process.env.MONGODB_URL;
const isLive = process.argv.includes('--live');

if (!MONGODB_URL) {
  console.error('ERROR: MONGODB_URL is not set in .env');
  process.exit(1);
}

// Exact match of the old hardcoded EXPENSE_CATEGORIES / CATEGORY_COLORS —
// order and hex values preserved so the migration is a pure no-visual-change.
const SEED_CATEGORIES = [
  { name: 'Groceries', color: '#2a78d6' },
  { name: 'Supplies', color: '#eb6834' },
  { name: 'Utilities', color: '#1baf7a' },
  { name: 'Delivery', color: '#eda100' },
  { name: 'Salary', color: '#e87ba4' },
  { name: 'Rent', color: '#008300' },
  { name: 'Equipment/Maintenance', color: '#4a3aa7' },
  { name: 'Marketing', color: '#e34948' },
  { name: 'Other', color: '#898781' }
];

async function run() {
  console.log(`Connecting to MongoDB... (${isLive ? 'LIVE run — will write changes' : 'DRY RUN — no changes will be written'})\n`);
  await mongoose.connect(MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected.\n');

  const existing = await ExpenseCategory.find({ name: { $in: SEED_CATEGORIES.map((c) => c.name) } });
  const existingNames = new Set(existing.map((c) => c.name));

  let created = 0;
  let skipped = 0;

  for (const seed of SEED_CATEGORIES) {
    if (existingNames.has(seed.name)) {
      console.log(`  [skip] "${seed.name}" already exists.`);
      skipped++;
      continue;
    }
    console.log(`  [create] "${seed.name}" — ${seed.color}`);
    created++;
    if (isLive) {
      await ExpenseCategory.create({ name: seed.name, color: seed.color, subcategories: [] });
    }
  }

  console.log('\n─────────────────────────────────────');
  console.log('Seed Summary:');
  console.log(`  Created : ${created}`);
  console.log(`  Skipped (already existed) : ${skipped}`);
  console.log(`  Mode    : ${isLive ? 'LIVE (changes written)' : 'DRY RUN (no changes written — re-run with --live to apply)'}`);
  console.log('─────────────────────────────────────\n');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
