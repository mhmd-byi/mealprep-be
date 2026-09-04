const Subscription = require('../models/subscriptionModel');
const User = require('../models/userModel');
const SubscriptionAuditLog = require('../models/subscriptionAuditLogModel');
const { requireAdmin } = require('../utils/requireAdmin');
const { parseCalendarDate } = require('../utils/dateUtils');
const {
  adjustMealCountsForTime,
  purchaseOverlapsActiveSubs
} = require('./subscriptionController');

const VALID_PLANS = ['Trial Meal Pack', 'Weekly Plan', 'Monthly Plan'];
const VALID_LUNCH_DINNER = ['lunch', 'dinner', 'lunchAndDinner'];
const VALID_MEAL_TYPES = ['veg', 'non-veg', 'both'];
const VALID_STATUSES = ['active', 'queued', 'completed', 'cancelled'];
const MEAL_COUNT_FIELDS = ['lunchMeals', 'dinnerMeals', 'nextDayLunchMeals', 'nextDayDinnerMeals'];

const snapshot = (sub) => ({
  plan: sub.plan,
  status: sub.status,
  mealType: sub.mealType,
  carbType: sub.carbType,
  allergy: sub.allergy,
  lunchMeals: sub.lunchMeals,
  dinnerMeals: sub.dinnerMeals,
  nextDayLunchMeals: sub.nextDayLunchMeals,
  nextDayDinnerMeals: sub.nextDayDinnerMeals,
  totalMeals: sub.totalMeals,
  subscriptionStartDate: sub.subscriptionStartDate,
  mealStartDate: sub.mealStartDate
});

const logAction = ({ admin, userId, subscriptionId, action, reason, before, after }) =>
  SubscriptionAuditLog.create({
    adminId: admin._id,
    adminName: `${admin.firstName} ${admin.lastName}`,
    adminEmail: admin.email,
    userId,
    subscriptionId,
    action,
    reason,
    before,
    after
  });

// Admin-authorized subscription creation — bypasses payment. Active-vs-queued
// is decided by the same overlap rule customer checkout uses (see
// purchaseOverlapsActiveSubs in subscriptionController.js) so admin-created
// subscriptions can't produce a state the normal purchase flow wouldn't.
const createAdminSubscription = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const {
      userId, plan, totalMeals, lunchDinner, mealType, carbType,
      subscriptionStartDate, mealStartDate, allergy, paymentId, reason
    } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'A reason is required for this action.' });
    }
    if (!userId || !plan || !totalMeals || !lunchDinner || !mealType || !carbType || !subscriptionStartDate) {
      return res.status(400).json({
        message: 'userId, plan, totalMeals, lunchDinner, mealType, carbType and subscriptionStartDate are required.'
      });
    }
    if (!VALID_PLANS.includes(plan)) {
      return res.status(400).json({ message: `plan must be one of: ${VALID_PLANS.join(', ')}` });
    }
    if (!VALID_LUNCH_DINNER.includes(lunchDinner)) {
      return res.status(400).json({ message: `lunchDinner must be one of: ${VALID_LUNCH_DINNER.join(', ')}` });
    }
    if (!VALID_MEAL_TYPES.includes(mealType)) {
      return res.status(400).json({ message: `mealType must be one of: ${VALID_MEAL_TYPES.join(', ')}` });
    }
    const mealCount = Number(totalMeals);
    if (!Number.isFinite(mealCount) || mealCount <= 0) {
      return res.status(400).json({ message: 'totalMeals must be a positive number.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const activeSubs = await Subscription.find({ userId, status: 'active' });
    const overlapsActive = purchaseOverlapsActiveSubs(lunchDinner, activeSubs);
    const status = overlapsActive ? 'queued' : 'active';

    let lunchMeals = 0, dinnerMeals = 0, nextDayLunchMeals = 0, nextDayDinnerMeals = 0;

    if (status === 'active') {
      const mealAdjustment = adjustMealCountsForTime(mealCount, lunchDinner, parseCalendarDate(subscriptionStartDate));
      lunchMeals = mealAdjustment.lunchMeals;
      dinnerMeals = mealAdjustment.dinnerMeals;
      nextDayLunchMeals = mealAdjustment.nextDayLunchMeals;
      nextDayDinnerMeals = mealAdjustment.nextDayDinnerMeals;
    } else {
      // Queued: raw counts stored; activation cron redistributes them later
      if (lunchDinner === 'lunch') {
        lunchMeals = mealCount;
      } else if (lunchDinner === 'dinner') {
        dinnerMeals = mealCount;
      } else {
        lunchMeals = mealCount / 2;
        dinnerMeals = mealCount / 2;
      }
    }

    const subscription = new Subscription({
      userId,
      plan,
      lunchMeals,
      dinnerMeals,
      nextDayLunchMeals,
      nextDayDinnerMeals,
      totalMeals: mealCount,
      mealType,
      carbType,
      subscriptionStartDate: parseCalendarDate(subscriptionStartDate),
      mealStartDate: mealStartDate || subscriptionStartDate,
      allergy: allergy || '',
      paymentId: paymentId || '',
      status
    });

    await subscription.save();

    await logAction({
      admin,
      userId,
      subscriptionId: subscription._id,
      action: 'create',
      reason,
      before: null,
      after: snapshot(subscription)
    });

    res.status(201).json(subscription);
  } catch (error) {
    console.error('Error creating admin subscription:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Edit an existing subscription's core fields and/or nudge its meal counts
// (delta-based add/subtract, clamped at 0). Every call is logged with a
// required reason and a before/after snapshot.
const updateAdminSubscription = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { subscriptionId } = req.params;
    const { reason, fieldUpdates = {}, mealDeltas = {} } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'A reason is required for this action.' });
    }

    const sub = await Subscription.findById(subscriptionId);
    if (!sub) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    if (fieldUpdates.plan !== undefined && !VALID_PLANS.includes(fieldUpdates.plan)) {
      return res.status(400).json({ message: `plan must be one of: ${VALID_PLANS.join(', ')}` });
    }
    if (fieldUpdates.mealType !== undefined && !VALID_MEAL_TYPES.includes(fieldUpdates.mealType)) {
      return res.status(400).json({ message: `mealType must be one of: ${VALID_MEAL_TYPES.join(', ')}` });
    }
    if (fieldUpdates.status !== undefined && !VALID_STATUSES.includes(fieldUpdates.status)) {
      return res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const before = snapshot(sub);

    if (fieldUpdates.plan !== undefined) sub.plan = fieldUpdates.plan;
    if (fieldUpdates.carbType !== undefined) sub.carbType = fieldUpdates.carbType;
    if (fieldUpdates.mealType !== undefined) sub.mealType = fieldUpdates.mealType;
    if (fieldUpdates.allergy !== undefined) sub.allergy = fieldUpdates.allergy;

    // Meal count deltas (+/-), clamped so a subtract can never go negative
    let netDelta = 0;
    MEAL_COUNT_FIELDS.forEach((field) => {
      const delta = Number(mealDeltas[field]);
      if (delta) {
        const before2 = sub[field] || 0;
        sub[field] = Math.max(0, before2 + delta);
        netDelta += sub[field] - before2;
      }
    });
    if (netDelta !== 0) {
      sub.totalMeals = Math.max(0, (sub.totalMeals || 0) + netDelta);
    }

    if (fieldUpdates.status !== undefined && fieldUpdates.status !== sub.status) {
      const wasActive = sub.status === 'active';
      sub.status = fieldUpdates.status;

      // Moving an active plan to cancelled/completed: zero its meals so the
      // next scheduled meal-exhaustion check promotes any queued plan for
      // this user, reusing that exact tested activation path instead of
      // duplicating it here.
      if (wasActive && ['cancelled', 'completed'].includes(sub.status)) {
        sub.lunchMeals = 0;
        sub.dinnerMeals = 0;
        sub.nextDayLunchMeals = 0;
        sub.nextDayDinnerMeals = 0;
      }
    }

    await sub.save();

    await logAction({
      admin,
      userId: sub.userId,
      subscriptionId: sub._id,
      action: 'update',
      reason,
      before,
      after: snapshot(sub)
    });

    res.json(sub);
  } catch (error) {
    console.error('Error updating admin subscription:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const getSubscriptionAuditLogs = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { userId, subscriptionId, adminId, page = 1, limit = 50 } = req.query;
    const query = {};
    if (userId) query.userId = userId;
    if (subscriptionId) query.subscriptionId = subscriptionId;
    if (adminId) query.adminId = adminId;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      SubscriptionAuditLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      SubscriptionAuditLog.countDocuments(query)
    ]);

    res.json({ logs, total, page: pageNum, limit: limitNum });
  } catch (error) {
    console.error('Error fetching subscription audit logs:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  createAdminSubscription,
  updateAdminSubscription,
  getSubscriptionAuditLogs
};
