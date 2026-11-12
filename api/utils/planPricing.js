const { loadAllPlans, DEFAULT_PLANS } = require('./planCatalog');

let pricingByName = Object.fromEntries(DEFAULT_PLANS.map((plan) => [plan.name, { price: plan.price, meals: plan.meals }]));

const refreshPricing = async () => {
  const plans = await loadAllPlans();
  pricingByName = Object.fromEntries(plans.map((plan) => [plan.name, { price: plan.price, meals: plan.meals }]));
};

const hasRealPayment = (sub) => Boolean(sub.orderId) || Boolean(sub.paymentMethod);

const pricePerMealFor = (sub) => {
  if (Number.isFinite(sub.pricePerMeal) && sub.pricePerMeal > 0) return sub.pricePerMeal;
  const pricing = pricingByName[sub.plan];
  return pricing ? pricing.price / pricing.meals : 0;
};

const computeGrossAmount = (sub) => {
  if (!sub.totalMeals) return 0;
  return Math.round(pricePerMealFor(sub) * sub.totalMeals);
};

const computeNetRevenue = (sub) => {
  if (!hasRealPayment(sub)) return 0;
  if (sub.refundId) return 0;
  return computeGrossAmount(sub);
};

module.exports = {
  refreshPricing,
  hasRealPayment,
  pricePerMealFor,
  computeGrossAmount,
  computeNetRevenue
};
