// Mirrors mealprep-fe/src/pages/Plans/data.json — the only place plan prices
// are defined. There's no historical price tracking in this app, so revenue
// is computed retroactively using TODAY's price list; a subscription bought
// under an older price will be mis-valued if prices have changed since —
// an accepted approximation (explicit product decision).
const PLAN_PRICING = {
  'Trial Meal Pack': { price: 349, meals: 1 },
  'Weekly Plan': { price: 1699, meals: 6 },
  'Monthly Plan': { price: 5999, meals: 26 }
};

// A subscription only counts as real money if it was actually paid for —
// either a genuine Razorpay purchase (has an orderId) or an admin-recorded
// payment (has a paymentMethod). An admin-created subscription with neither
// is treated as complimentary/goodwill and contributes 0 revenue.
const hasRealPayment = (sub) => Boolean(sub.orderId) || Boolean(sub.paymentMethod);

// Derives what a subscription was paid for from its plan + totalMeals (price
// per meal of that plan x meals actually purchased) — handles a lunch+dinner
// "Both" purchase (2x meals) and admin meal-count edits proportionally,
// without needing to separately know the original lunchDinner choice.
const computeGrossAmount = (sub) => {
  const pricing = PLAN_PRICING[sub.plan];
  if (!pricing || !sub.totalMeals) return 0;
  const pricePerMeal = pricing.price / pricing.meals;
  return Math.round(pricePerMeal * sub.totalMeals);
};

// Net revenue: 0 if there's no real payment evidence; fully reversed if the
// subscription was refunded (every refund in this app is a full refund — see
// cancelQueuedPlan in subscriptionController.js, which never passes a
// partial amount to Razorpay, so there's no partial-refund case to net out).
const computeNetRevenue = (sub) => {
  if (!hasRealPayment(sub)) return 0;
  if (sub.refundId) return 0;
  return computeGrossAmount(sub);
};

module.exports = {
  PLAN_PRICING,
  hasRealPayment,
  computeGrossAmount,
  computeNetRevenue
};
