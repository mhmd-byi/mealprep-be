/**
 * Optional one-time seed: creates the starting Notes & Tasks categories
 * (names, colors and icons from the Notes screen design). After this, admin
 * can add/rename/recolor/delete them from the Notes page — nothing is
 * hardcoded in the app. You can also skip this and add them by hand there.
 *
 * Safe to re-run: skips any category name that already exists.
 *
 * Run in dry-run mode first (default) to review exactly what would be created:
 *   node migrate_seed_note_categories.js
 * Then apply for real:
 *   node migrate_seed_note_categories.js --live
 */

require('dotenv').config();
const mongoose = require('mongoose');
const NoteCategory = require('./api/models/noteCategoryModel');

const MONGODB_URL = process.env.MONGODB_URL;
const isLive = process.argv.includes('--live');

if (!MONGODB_URL) {
  console.error('ERROR: MONGODB_URL is not set in .env');
  process.exit(1);
}

const SEED_CATEGORIES = [
  { name: 'Daily Operations', color: '#f59e0b', icon: 'Sun' },
  { name: 'Kitchen / Production', color: '#16a34a', icon: 'ChefHat' },
  { name: 'Inventory', color: '#2563eb', icon: 'Package' },
  { name: 'Delivery & Logistics', color: '#7c3aed', icon: 'Truck' },
  { name: 'Finance & Billing', color: '#e11d48', icon: 'IndianRupee' },
  { name: 'Customer Support', color: '#0d9488', icon: 'Headset' },
  { name: 'General / Others', color: '#6b7280', icon: 'MoreHorizontal' }
];

async function run() {
  console.log(`Connecting to MongoDB... (${isLive ? 'LIVE run — will write changes' : 'DRY RUN — no changes will be written'})\n`);
  await mongoose.connect(MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected.\n');

  const existing = await NoteCategory.find();
  const existingNames = new Set(existing.map((category) => category.name.toLowerCase()));
  let nextOrder = existing.reduce((max, category) => Math.max(max, category.sortOrder || 0), 0);

  let created = 0;
  let skipped = 0;

  for (const seed of SEED_CATEGORIES) {
    if (existingNames.has(seed.name.toLowerCase())) {
      console.log(`  [skip] "${seed.name}" already exists.`);
      skipped++;
      continue;
    }
    nextOrder++;
    console.log(`  [create] "${seed.name}" — ${seed.color}, icon ${seed.icon} (order ${nextOrder})`);
    created++;
    if (isLive) {
      await NoteCategory.create({ ...seed, sortOrder: nextOrder });
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
