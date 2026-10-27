/**
 * Optional one-time seed: creates the starting taste-preference options the
 * client supplied (spice levels and flavour preferences). After this, admin
 * can add/rename/delete them from the "Taste Preferences" page — nothing is
 * hardcoded in the app. You can also skip this and enter them by hand there.
 *
 * Safe to re-run: skips any option that already exists in its group.
 *
 * Run in dry-run mode first (default) to review exactly what would be created:
 *   node migrate_seed_taste_options.js
 * Then apply for real:
 *   node migrate_seed_taste_options.js --live
 */

require('dotenv').config();
const mongoose = require('mongoose');
const TasteOption = require('./api/models/tasteOptionModel');

const MONGODB_URL = process.env.MONGODB_URL;
const isLive = process.argv.includes('--live');

if (!MONGODB_URL) {
  console.error('ERROR: MONGODB_URL is not set in .env');
  process.exit(1);
}

const SEED_OPTIONS = {
  spice: ['No spices', 'Mild', 'Medium', 'Spicy'],
  flavour: ['Indian', 'Asian', 'Continental', 'Chinese', 'Grilled', 'BBQ', 'Lebanese', 'Middle Eastern']
};

async function run() {
  console.log(`Connecting to MongoDB... (${isLive ? 'LIVE run — will write changes' : 'DRY RUN — no changes will be written'})\n`);
  await mongoose.connect(MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected.\n');

  let created = 0;
  let skipped = 0;

  for (const group of Object.keys(SEED_OPTIONS)) {
    const existing = await TasteOption.find({ group });
    const existingLabels = new Set(existing.map((option) => option.label.toLowerCase()));
    let nextOrder = existing.reduce((max, option) => Math.max(max, option.sortOrder || 0), 0);

    for (const label of SEED_OPTIONS[group]) {
      if (existingLabels.has(label.toLowerCase())) {
        console.log(`  [skip] ${group}: "${label}" already exists.`);
        skipped++;
        continue;
      }
      nextOrder++;
      console.log(`  [create] ${group}: "${label}" (order ${nextOrder})`);
      created++;
      if (isLive) {
        await TasteOption.create({ group, label, sortOrder: nextOrder });
      }
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
