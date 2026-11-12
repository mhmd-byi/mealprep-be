require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./api/models/userModel');
const Subscription = require('./api/models/subscriptionModel');
const MealDelivery = require('./api/models/mealDeliveryModel');

const MONGODB_URL = process.env.MONGODB_URL;

if (!MONGODB_URL) {
  console.error('ERROR: MONGODB_URL is not set in .env');
  process.exit(1);
}

const mealsLeftExpression = {
  $add: [
    { $ifNull: ['$lunchMeals', 0] },
    { $ifNull: ['$dinnerMeals', 0] },
    { $ifNull: ['$nextDayLunchMeals', 0] },
    { $ifNull: ['$nextDayDinnerMeals', 0] }
  ]
};

const show = (value) => (value === null || value === undefined || value === '' ? '(missing)' : String(value));

async function run() {
  await mongoose.connect(MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log(`Read-only check. Connected to database "${mongoose.connection.name}" on ${mongoose.connection.host}.\n`);

  const customers = await User.countDocuments({ role: 'user' });
  const totalSubs = await Subscription.countDocuments({});
  console.log(`Customers: ${customers}`);
  console.log(`Subscriptions: ${totalSubs}\n`);

  const byStatus = await Subscription.aggregate([{ $group: { _id: '$status', total: { $sum: 1 } } }, { $sort: { total: -1 } }]);
  console.log('Subscriptions by status:');
  byStatus.forEach((row) => console.log(`  ${show(row._id).padEnd(12)} ${row.total}`));

  const activeBreakdown = await Subscription.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: { $gt: [mealsLeftExpression, 0] }, total: { $sum: 1 } } }
  ]);
  const activeWithMeals = (activeBreakdown.find((row) => row._id === true) || { total: 0 }).total;
  const activeEmpty = (activeBreakdown.find((row) => row._id === false) || { total: 0 }).total;
  console.log(`\nActive subscriptions with meals left : ${activeWithMeals}`);
  console.log(`Active subscriptions with 0 meals    : ${activeEmpty} (these become "completed" at the next 10:45 / 16:45 check)`);

  const usersWithMeals = await Subscription.aggregate([
    { $match: { status: 'active' } },
    { $addFields: { left: mealsLeftExpression } },
    { $match: { left: { $gt: 0 } } },
    { $group: { _id: '$userId' } },
    { $count: 'users' }
  ]);
  console.log(`Customers with at least one active plan and meals left: ${usersWithMeals[0] ? usersWithMeals[0].users : 0}`);

  const byPlan = await Subscription.aggregate([{ $group: { _id: '$plan', total: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 12 }]);
  console.log('\nTop plan values:');
  byPlan.forEach((row) => console.log(`  ${show(row._id).padEnd(28)} ${row.total}`));

  console.log('\nMost recent 5 subscriptions:');
  const recent = await Subscription.find({}, 'userId plan status subscriptionStartDate createdAt lunchMeals dinnerMeals nextDayLunchMeals nextDayDinnerMeals totalMeals')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  recent.forEach((sub) => {
    const left = (sub.lunchMeals || 0) + (sub.dinnerMeals || 0) + (sub.nextDayLunchMeals || 0) + (sub.nextDayDinnerMeals || 0);
    console.log(
      `  ${new Date(sub.createdAt).toISOString().slice(0, 10)}  ${show(sub.plan).padEnd(18)} status=${show(sub.status).padEnd(10)} meals left ${left} of ${show(sub.totalMeals)}  user ${sub.userId}`
    );
  });

  const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const perDay = await MealDelivery.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, mealType: '$mealType' }, total: { $sum: 1 } } },
    { $sort: { '_id.day': -1, '_id.mealType': 1 } }
  ]);
  console.log('\nMeals deducted (delivery records) in the last 10 days, India time:');
  if (perDay.length === 0) console.log('  none');
  perDay.forEach((row) => console.log(`  ${row._id.day}  ${row._id.mealType.padEnd(7)} ${row.total}`));

  const duplicates = await MealDelivery.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { sub: '$subscriptionId', mealType: '$mealType', day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } } }, total: { $sum: 1 } } },
    { $match: { total: { $gt: 1 } } },
    { $count: 'groups' }
  ]);
  const duplicateGroups = duplicates[0] ? duplicates[0].groups : 0;
  console.log(
    `\nSame meal deducted more than once on one day (a sign that two servers were running against this database): ${duplicateGroups}`
  );

  console.log('\nNothing was changed.');
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error('Check failed:', error);
  process.exit(1);
});
