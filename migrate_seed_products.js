require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('./api/models/productModel');
const ProductCategory = require('./api/models/productCategoryModel');
const { isConfigured, uploadImage } = require('./api/utils/s3Storage');

const MONGODB_URL = process.env.MONGODB_URL;
const isLive = process.argv.includes('--live');
const skipImages = process.argv.includes('--no-images');
const imagesArg = process.argv.find((arg) => arg.startsWith('--images-dir='));
const IMAGES_DIR = imagesArg ? path.resolve(imagesArg.slice('--images-dir='.length)) : path.resolve(__dirname, '..', 'website', 'public', 'images');
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

if (!MONGODB_URL) {
  console.error('ERROR: MONGODB_URL is not set in .env');
  process.exit(1);
}

const CATEGORY = 'Sandwiches & Wraps';

const SEED_PRODUCTS = [
  { name: 'Avocado Sandwich', description: 'Made with fresh Avocado & vegetables, perfect for a light meal', price: 249, dietType: 'veg', image: 'avocado-sandwich.jpg' },
  { name: 'Quesadilla', description: 'Satisfy Your Cravings, Mealprep Is the Place for authentic Mexican flavours.', price: 199, dietType: 'veg', image: 'quesadilla.jpg' },
  { name: 'Veg Sandwich', description: 'High Protein sandwich, made for a better taste', price: 199, dietType: 'veg', image: 'veg-sandwich.jpg' },
  { name: 'Non-veg Sandwich', description: 'Join Chicken Sandwich Revolution & Take Your Taste Buds to New Heights', price: 199, dietType: 'non-veg', image: 'non-veg-sandwich.jpg' },
  { name: 'Veg Wrap', description: 'Mouthwatering high protein vegetarian wraps at Mealprep', price: 199, dietType: 'veg', image: 'veg-wrap.jpg' },
  { name: 'Non-veg Wrap', description: 'Crunch the Hunger, Fuel the Strength with high protein wraps', price: 199, dietType: 'non-veg', image: 'non-veg-wrap.jpg' },
  { name: 'Open Toast Veg Sandwich', description: 'Savor the high fiber Sandwich Sensation with Mealprep', price: 199, dietType: 'veg', image: 'open-toast-veg-sandwich.jpg' },
  { name: 'Open Toast Non-veg Sandwich', description: 'The Perfect Combination of Freshness and Flavor', price: 199, dietType: 'non-veg', image: 'open-toast-non-veg-sandwich.jpg' }
];

const imagePathFor = (seed) => path.join(IMAGES_DIR, seed.image);

const checkImage = (seed) => {
  if (skipImages) return null;
  const file = imagePathFor(seed);
  if (!fs.existsSync(file)) return `image file not found: ${file}`;
  if (fs.statSync(file).size > MAX_IMAGE_BYTES) return 'image is larger than 1.5 MB';
  return null;
};

async function run() {
  console.log(`Connecting to MongoDB... (${isLive ? 'LIVE run - will write changes' : 'DRY RUN - no changes will be written'})\n`);
  await mongoose.connect(MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log(`Connected to database "${mongoose.connection.name}" on ${mongoose.connection.host}.\n`);

  if (!skipImages && !isConfigured()) {
    console.log('Image storage (S3_BUCKET_NAME, S3_REGION, S3_ACCESS_KEY, S3_SECRET_ACCESS_KEY) is not set in this environment.');
    console.log('Either run this where those are set, or add --no-images to create the products without photos and upload photos from the admin screen.\n');
    if (isLive) {
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  const collation = { locale: 'en', strength: 2 };
  let category = await ProductCategory.findOne({ name: CATEGORY }).collation(collation);
  if (category) {
    console.log(`  [skip] category "${CATEGORY}" already exists.`);
  } else {
    const last = await ProductCategory.findOne().sort({ sortOrder: -1 });
    const sortOrder = last ? (last.sortOrder || 0) + 1 : 1;
    console.log(`  [create] category "${CATEGORY}" (order ${sortOrder})`);
    if (isLive) category = await ProductCategory.create({ name: CATEGORY, sortOrder });
  }
  const categoryName = category ? category.name : CATEGORY;

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, seed] of SEED_PRODUCTS.entries()) {
    const existing = await Product.findOne({ name: seed.name }).collation(collation);
    if (existing) {
      console.log(`  [skip] "${seed.name}" already exists.`);
      skipped++;
      continue;
    }

    const problem = checkImage(seed);
    if (problem) {
      console.log(`  [FAILED] "${seed.name}": ${problem}`);
      failed++;
      continue;
    }

    console.log(`  [create] "${seed.name}" - Rs ${seed.price}, ${seed.dietType}, ${skipImages ? 'no photo' : seed.image}`);
    created++;
    if (!isLive) continue;

    try {
      const images = [];
      if (!skipImages) {
        const url = await uploadImage({
          buffer: fs.readFileSync(imagePathFor(seed)),
          contentType: 'image/jpeg',
          key: `product-${crypto.randomUUID()}.jpg`
        });
        images.push({ url });
      }
      await Product.create({
        name: seed.name,
        description: seed.description,
        price: seed.price,
        dietType: seed.dietType,
        category: categoryName,
        images,
        sortOrder: index + 1
      });
    } catch (error) {
      console.log(`  [FAILED] "${seed.name}": ${error.message}`);
      created--;
      failed++;
    }
  }

  console.log('\n-------------------------------------');
  console.log('Seed Summary:');
  console.log(`  Created : ${created}`);
  console.log(`  Skipped (already existed) : ${skipped}`);
  console.log(`  Failed  : ${failed}`);
  console.log(`  Mode    : ${isLive ? 'LIVE (changes written)' : 'DRY RUN (no changes written - re-run with --live to apply)'}`);
  console.log('-------------------------------------\n');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
