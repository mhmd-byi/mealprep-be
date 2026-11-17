const mongoose = require('mongoose');
const Subscription = require('../models/subscriptionModel');
const MealDelivery = require('../models/mealDeliveryModel');
const MealCancellation = require('../models/mealcancellation');
const Holiday = require('../models/holidayModel');
const { requireAuth } = require('../utils/requireAuth');
const { parseCalendarDate, addCalendarDays } = require('../utils/dateUtils');
const { MONTH_KEY, currentMonthKey, monthBounds, buildTrackingSummary } = require('../utils/mealTrackingSummary');

const getTrackingSummary = async (req, res) => {
  try {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(404).json({ message: 'User not found.' });
    if (caller.role !== 'admin' && String(caller._id) !== userId) {
      return res.status(403).json({ message: 'You can only view your own meal tracking.' });
    }

    const monthKey = req.query.month ? String(req.query.month) : currentMonthKey();
    if (!MONTH_KEY.test(monthKey)) return res.status(400).json({ message: 'Month must look like 2026-11.' });

    const bounds = monthBounds(monthKey);
    const firstDay = parseCalendarDate(bounds.firstKey);
    const dayAfterLast = addCalendarDays(parseCalendarDate(bounds.lastKey), 1);
    const ownerId = mongoose.Types.ObjectId(userId);

    const [subscriptions, deliveries, cancellations, holidays, firstDelivery, logged] = await Promise.all([
      Subscription.find({ userId: ownerId }).lean(),
      MealDelivery.find({ userId: ownerId, date: { $gte: bounds.from, $lte: bounds.to } }, 'mealType').lean(),
      MealCancellation.find({ userId: ownerId, startDate: { $lt: dayAfterLast }, endDate: { $gte: firstDay } }).lean(),
      Holiday.find({ date: { $gte: firstDay, $lt: dayAfterLast } }).lean(),
      MealDelivery.findOne({}, 'date').sort({ date: 1 }).lean(),
      MealDelivery.aggregate([{ $match: { userId: ownerId } }, { $group: { _id: '$subscriptionId', count: { $sum: 1 } } }])
    ]);

    const loggedDeliveries = new Map(logged.map((row) => [String(row._id), row.count]));

    res.json(
      buildTrackingSummary({
        monthKey,
        subscriptions,
        deliveries,
        cancellations,
        holidays,
        loggedDeliveries,
        trackingStart: firstDelivery ? firstDelivery.date : null
      })
    );
  } catch (error) {
    console.error('Error building meal tracking summary:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = { getTrackingSummary };
