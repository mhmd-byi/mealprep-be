const { DateTime } = require('luxon');
const AlacarteOrder = require('../models/alacarteOrderModel');

const EVENT_STATUSES = ['placed', 'confirmed', 'out_for_delivery', 'delivered'];
const STATUS_TEXT = { confirmed: 'confirmed', out_for_delivery: 'out for delivery', delivered: 'delivered' };

const describeEvent = (order, status) => {
  if (status !== 'placed') return `Order ${order.orderNumber} ${STATUS_TEXT[status]}`;
  const count = (order.items || []).reduce((sum, item) => sum + item.quantity, 0);
  const deliverOn = DateTime.fromJSDate(order.deliveryDate, { zone: 'utc' }).toFormat('d LLL');
  return `New order ${order.orderNumber}: ${count} ${count === 1 ? 'item' : 'items'}, ₹${order.total}, delivery ${deliverOn}`;
};

const loadAlacarteActivity = async (since, limit) => {
  const orders = await AlacarteOrder.find({
    statusHistory: { $elemMatch: { at: { $gte: since }, status: { $in: EVENT_STATUSES } } }
  })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  const events = [];
  orders.forEach((order) => {
    (order.statusHistory || []).forEach((entry) => {
      const at = new Date(entry.at);
      if (!EVENT_STATUSES.includes(entry.status) || at < since) return;
      events.push({
        _id: `${order._id}:${entry.status}`,
        userId: order.userId,
        category: 'alacarte',
        description: describeEvent(order, entry.status),
        createdAt: at,
        status: entry.status,
        needsAttention: entry.status === 'placed' && Boolean(order.needsAttention),
        displayName: order.customerName,
        displayMobile: order.mobile
      });
    });
  });

  return events.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
};

module.exports = { loadAlacarteActivity, EVENT_STATUSES };
