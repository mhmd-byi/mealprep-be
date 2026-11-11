const crypto = require('crypto');
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const Product = require('../models/productModel');
const AlacarteOrder = require('../models/alacarteOrderModel');
const AlacarteSetting = require('../models/alacarteSettingModel');
const { requireAuth } = require('../utils/requireAuth');
const { requireAdmin } = require('../utils/requireAdmin');
const { loadHolidayKeys } = require('../utils/planProjection');
const { IST_ZONE, parseCalendarDate, calendarDateKey } = require('../utils/dateUtils');
const { createOrder, markPaid, changeStatus, getSettings } = require('../utils/alacarteService');
const {
  SLOT_LABELS,
  DELIVERY_DAYS_AHEAD,
  roundMoney,
  slotsWithFees,
  deliveryDateOptions,
  priceLines,
  nextStatusAllowed
} = require('../utils/alacarteRules');

const serverError = (res, label, error) => {
  console.error(`Error ${label}:`, error);
  res.status(500).json({ message: 'Internal Server Error', error: error.message });
};

const shapeOrder = (order) => ({
  _id: order._id,
  orderNumber: order.orderNumber,
  customerName: order.customerName,
  mobile: order.mobile,
  address: order.address,
  note: order.note,
  items: order.items.map((item) => ({
    productId: item.productId,
    name: item.name,
    image: item.image,
    dietType: item.dietType,
    unitPrice: item.unitPrice,
    compareAtPrice: item.compareAtPrice,
    quantity: item.quantity
  })),
  subtotal: order.subtotal,
  deliveryFee: order.deliveryFee,
  total: order.total,
  deliveryDate: calendarDateKey(order.deliveryDate),
  deliverySlot: order.deliverySlot,
  slotLabel: SLOT_LABELS[order.deliverySlot],
  status: order.status,
  needsAttention: Boolean(order.needsAttention),
  paymentId: order.paymentId || '',
  paidAt: order.paidAt || null,
  createdAt: order.createdAt,
  history: (order.statusHistory || []).map((entry) => ({ status: entry.status, at: entry.at, byName: entry.byName }))
});

const getConfig = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const settings = await getSettings();
    res.json({
      slots: slotsWithFees(settings.middayFee),
      address: user.postalAddress || '',
      mobile: user.mobile || ''
    });
  } catch (error) {
    serverError(res, 'loading the à la carte settings', error);
  }
};

const quoteCart = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const requested = Array.isArray(req.body.items) ? req.body.items : [];
    const ids = requested.map((entry) => entry && entry.productId).filter((id) => mongoose.Types.ObjectId.isValid(id));
    const products = await Product.find({ _id: { $in: ids } });
    const priced = priceLines(products, requested);
    if (priced.problems.length > 0) {
      return res.status(400).json({ message: priced.problems[0], problems: priced.problems });
    }

    const cartProducts = products.filter((product) => priced.lines.some((line) => String(line.productId) === String(product._id)));
    const now = DateTime.now().setZone(IST_ZONE);
    const holidayKeys = await loadHolidayKeys(DELIVERY_DAYS_AHEAD + 2);
    const dates = deliveryDateOptions(cartProducts, now, holidayKeys).map((date) => ({
      date,
      label: DateTime.fromISO(date, { zone: 'utc' }).toFormat('ccc, d LLL')
    }));
    const settings = await getSettings();

    res.json({
      lines: priced.lines,
      subtotal: priced.subtotal,
      dates,
      slots: slotsWithFees(settings.middayFee)
    });
  } catch (error) {
    serverError(res, 'pricing the cart', error);
  }
};

const placeOrder = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const result = await createOrder({
      user,
      items: req.body.items,
      deliveryDate: req.body.deliveryDate,
      slot: req.body.slot,
      address: req.body.address,
      note: req.body.note
    });
    if (result.error) return res.status(result.error.status).json({ message: result.error.message });

    res.status(201).json({
      orderId: result.order._id,
      orderNumber: result.order.orderNumber,
      razorpayOrderId: result.razorpayOrder.id,
      amount: result.razorpayOrder.amount,
      currency: result.razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      total: result.order.total
    });
  } catch (error) {
    serverError(res, 'placing an à la carte order', error);
  }
};

const verifyOrderPayment = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
    if (!orderId || !paymentId || !signature) return res.status(400).json({ message: 'Payment details are missing.' });

    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    if (expected !== signature) return res.status(400).json({ message: 'Payment could not be verified.' });

    const order = await AlacarteOrder.findOne({ razorpayOrderId: orderId, userId: user._id });
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    const paid = await markPaid(order._id, paymentId);
    res.json(shapeOrder(paid));
  } catch (error) {
    serverError(res, 'verifying an à la carte payment', error);
  }
};

const myOrders = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const orders = await AlacarteOrder.find({ userId: user._id, status: { $nin: ['pending_payment', 'expired'] } })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(orders.map(shapeOrder));
  } catch (error) {
    serverError(res, 'loading your orders', error);
  }
};

const OPEN_STATUSES = ['placed', 'confirmed', 'out_for_delivery'];

const listAdminOrders = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = {};

    if (req.query.status === 'open') filter.status = { $in: OPEN_STATUSES };
    else if (['placed', 'confirmed', 'out_for_delivery', 'delivered'].includes(req.query.status)) filter.status = req.query.status;
    else filter.status = { $nin: ['pending_payment', 'expired'] };

    if (typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
      filter.deliveryDate = parseCalendarDate(req.query.date);
    }
    if (req.query.attention === '1') filter.needsAttention = true;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 60) : '';
    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ orderNumber: pattern }, { customerName: pattern }, { mobile: pattern }];
    }

    const [orders, total, totals] = await Promise.all([
      AlacarteOrder.find(filter).sort({ deliveryDate: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      AlacarteOrder.countDocuments(filter),
      AlacarteOrder.aggregate([{ $match: filter }, { $group: { _id: null, amount: { $sum: '$total' } } }])
    ]);

    res.json({ orders: orders.map(shapeOrder), total, page, limit, amount: roundMoney(totals[0] ? totals[0].amount : 0) });
  } catch (error) {
    serverError(res, 'listing à la carte orders', error);
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.orderId)) return res.status(404).json({ message: 'Order not found.' });

    const order = await AlacarteOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    const status = req.body.status;
    if (!nextStatusAllowed(order.status, status)) {
      return res.status(400).json({ message: 'That status change is not allowed for this order.' });
    }
    const updated = await changeStatus(order, status, `${admin.firstName || ''} ${admin.lastName || ''}`.trim() || 'Admin');
    if (!updated) return res.status(409).json({ message: 'This order was just changed by someone else. Refresh and try again.' });
    res.json(shapeOrder(updated));
  } catch (error) {
    serverError(res, 'updating an order status', error);
  }
};

const clearAttention = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.orderId)) return res.status(404).json({ message: 'Order not found.' });
    const order = await AlacarteOrder.findByIdAndUpdate(req.params.orderId, { $set: { needsAttention: false } }, { new: true });
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    res.json(shapeOrder(order));
  } catch (error) {
    serverError(res, 'clearing an order flag', error);
  }
};

const getAdminSettings = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.json(await getSettings());
  } catch (error) {
    serverError(res, 'loading the à la carte settings', error);
  }
};

const updateAdminSettings = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const middayFee = Number(req.body.middayFee);
    if (!Number.isFinite(middayFee) || middayFee < 0 || middayFee > 5000) {
      return res.status(400).json({ message: 'Enter a delivery fee between 0 and 5000.' });
    }
    await AlacarteSetting.findOneAndUpdate({ key: 'main' }, { $set: { middayFee: roundMoney(middayFee) } }, { upsert: true });
    res.json(await getSettings());
  } catch (error) {
    serverError(res, 'saving the à la carte settings', error);
  }
};

module.exports = {
  getConfig,
  quoteCart,
  placeOrder,
  verifyOrderPayment,
  myOrders,
  listAdminOrders,
  updateOrderStatus,
  clearAttention,
  getAdminSettings,
  updateAdminSettings
};
