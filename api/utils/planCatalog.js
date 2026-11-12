const Plan = require('../models/planModel');
const Subscription = require('../models/subscriptionModel');

const LUNCH_DINNER_VALUES = ['lunch', 'dinner', 'lunchAndDinner'];

const DEFAULT_PLANS = [
  {
    name: 'Trial Meal Pack',
    price: 349,
    meals: 1,
    period: 'Only',
    description: 'Best to know us',
    features: [
      'Assorted Meal Box',
      'Both Veg & Non Veg Available',
      'Just heat and eat, and CRUSH your goals',
      'Real food, real ingredients',
      'Meals will be delivered from Monday To Saturday only.'
    ],
    color: '#d97706',
    sortOrder: 1,
    websiteTitle: 'Taste & Try Pack',
    validityText: 'Valid for 7 days'
  },
  {
    name: 'Weekly Plan',
    price: 1699,
    meals: 6,
    period: 'Weekly',
    description: 'Perfect to try out weeks recipe',
    features: [
      '6 Days Plan',
      'Try New Recipe everyday',
      'Signature Meals',
      'Order now and save time',
      'Meals will be delivered from Monday To Saturday only.'
    ],
    color: '#16a34a',
    sortOrder: 2,
    websiteTitle: 'Smart Weekly Fuel',
    validityText: 'Valid for 7 days'
  },
  {
    name: 'Monthly Plan',
    price: 5999,
    meals: 26,
    period: 'Monthly',
    description: 'Go healthy for a month',
    features: [
      '26 Days Meal Plan',
      'Never be bored with our monthly rotating menus!',
      'Dietician recommended meals.',
      'Both Veg & Non veg plan available',
      'Real food, real ingredients',
      'Meals will be delivered from Monday To Saturday only.'
    ],
    color: '#2563eb',
    sortOrder: 3,
    websiteTitle: 'Commit To Monthly Fit Plan',
    validityText: 'Valid for 26 days'
  }
];

const shapePlan = (plan) => ({
  _id: plan._id || null,
  name: plan.name,
  price: plan.price,
  meals: plan.meals,
  period: plan.period || '',
  description: plan.description || '',
  features: plan.features || [],
  color: plan.color || '#6b7280',
  isActive: plan.isActive !== false,
  sortOrder: plan.sortOrder || 0,
  websiteTitle: plan.websiteTitle || '',
  validityText: plan.validityText || '',
  imageUrl: plan.imageUrl || ''
});

const loadAllPlans = async () => {
  const stored = await Plan.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
  return stored.length > 0 ? stored : DEFAULT_PLANS;
};

const loadActivePlans = async () => (await loadAllPlans()).filter((plan) => plan.isActive !== false);

const findPlanByName = async (name, { activeOnly = false } = {}) => {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  const plans = activeOnly ? await loadActivePlans() : await loadAllPlans();
  return plans.find((plan) => plan.name.toLowerCase() === wanted) || null;
};

const quotePlan = (plan, lunchDinner) => {
  const multiplier = lunchDinner === 'lunchAndDinner' ? 2 : 1;
  return { price: plan.price * multiplier, meals: plan.meals * multiplier };
};

const pricePerMealOfPlan = (plan) => plan.price / plan.meals;

const backfillPricePerMeal = (planName, price, meals) =>
  Subscription.updateMany(
    { plan: planName, $or: [{ pricePerMeal: { $exists: false } }, { pricePerMeal: null }] },
    { $set: { pricePerMeal: price / meals } }
  );

module.exports = {
  LUNCH_DINNER_VALUES,
  DEFAULT_PLANS,
  shapePlan,
  loadAllPlans,
  loadActivePlans,
  findPlanByName,
  quotePlan,
  pricePerMealOfPlan,
  backfillPricePerMeal
};
