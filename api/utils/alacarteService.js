const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const { DateTime } = require('luxon');
const { MailtrapClient } = require('mailtrap');
const Product = require('../models/productModel');
const AlacarteOrder = require('../models/alacarteOrderModel');
const AlacarteSetting = require('../models/alacarteSettingModel');
const Notification = require('../models/notificationModel');
const { deliverItems } = require('./notificationSender');
const { loadHolidayKeys } = require('./planProjection');
const { IST_ZONE, parseCalendarDate } = require('./dateUtils');
const {
  SLOT_KEYS,
  SLOT_LABELS,
  DELIVERY_DAYS_AHEAD,
  PENDING_PAYMENT_MINUTES,
  roundMoney,
  feeForSlot,
  unavailableReason,
  deliveryDateOptions,
  priceLines,
  generateOrderNumber
} = require('./alacarteRules');

const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || 'ermoinzafarsheikh@hotmail.com';

let razorpayClient = null;
const razorpay = () => {
  if (!razorpayClient) {
    razorpayClient = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  }
  return razorpayClient;
};

const fail = (status, message) => ({ error: { status, message } });

const getSettings = async () => {
  const stored = await AlacarteSetting.findOne({ key: 'main' }).lean();
  return { middayFee: stored ? stored.middayFee || 0 : 0 };
};

const reserveStock = async (items) => {
  const reserved = [];
  for (const item of items) {
    if (!item.trackedStock) continue;
    const updated = await Product.findOneAndUpdate(
      { _id: item.productId, trackStock: true, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
      { new: true }
    );
    if (updated) {
      reserved.push(item);
      continue;
    }
    const current = await Product.findById(item.productId, 'trackStock').lean();
    if (current && current.trackStock) {
      await Promise.all(
        reserved.map((done) => Product.updateOne({ _id: done.productId, trackStock: true }, { $inc: { stock: done.quantity } }))
      );
      return { ok: false, name: item.name };
    }
  }
  return { ok: true, reservedAny: reserved.length > 0 };
};

const releaseStock = async (order) => {
  const claimed = await AlacarteOrder.findOneAndUpdate({ _id: order._id, stockReserved: true }, { $set: { stockReserved: false } });
  if (!claimed) return;
  await Promise.all(
    order.items
      .filter((item) => item.trackedStock)
      .map((item) => Product.updateOne({ _id: item.productId, trackStock: true }, { $inc: { stock: item.quantity } }))
  );
};

const createOrder = async ({ user, items, deliveryDate, slot, address, note }) => {
  const dateKey = String(deliveryDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return fail(400, 'Choose a delivery date.');
  if (!SLOT_KEYS.includes(slot)) return fail(400, 'Choose a delivery time.');

  const cleanAddress = String(address || user.postalAddress || '').trim();
  if (!cleanAddress) return fail(400, 'Add a delivery address.');
  if (cleanAddress.length > 500) return fail(400, 'The delivery address is too long.');
  const cleanNote = String(note || '').trim().slice(0, 300);

  const requested = Array.isArray(items) ? items : [];
  const ids = requested.map((entry) => entry && entry.productId).filter((id) => mongoose.Types.ObjectId.isValid(id));
  const products = await Product.find({ _id: { $in: ids } });
  const priced = priceLines(products, requested);
  if (priced.problems.length > 0) return fail(400, priced.problems[0]);

  const cartProducts = products.filter((product) => priced.lines.some((line) => String(line.productId) === String(product._id)));
  const now = DateTime.now().setZone(IST_ZONE);
  const holidayKeys = await loadHolidayKeys(DELIVERY_DAYS_AHEAD + 2);
  const allowedDates = deliveryDateOptions(cartProducts, now, holidayKeys);
  if (!allowedDates.includes(dateKey)) {
    const blocker = cartProducts.map((product) => ({ product, reason: unavailableReason(product, dateKey, now, holidayKeys) })).find((entry) => entry.reason);
    return fail(400, blocker ? `${blocker.product.name} cannot be delivered on that date because ${blocker.reason}.` : 'Choose a delivery date within the next two weeks.');
  }

  const settings = await getSettings();
  const deliveryFee = feeForSlot(slot, settings.middayFee);
  const total = roundMoney(priced.subtotal + deliveryFee);

  const reservation = await reserveStock(priced.lines);
  if (!reservation.ok) return fail(409, `${reservation.name} just sold out. Please update your cart.`);

  let order = null;
  for (let attempt = 0; attempt < 5 && !order; attempt += 1) {
    try {
      order = await AlacarteOrder.create({
        orderNumber: generateOrderNumber(now),
        userId: user._id,
        customerName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        mobile: user.mobile || '',
        address: cleanAddress,
        note: cleanNote,
        items: priced.lines,
        subtotal: priced.subtotal,
        deliveryFee,
        total,
        deliveryDate: parseCalendarDate(dateKey),
        deliverySlot: slot,
        status: 'pending_payment',
        stockReserved: Boolean(reservation.reservedAny),
        statusHistory: [{ status: 'pending_payment', byName: 'Customer' }]
      });
    } catch (error) {
      if (error.code !== 11000) {
        await Promise.all(priced.lines.filter((line) => line.trackedStock).map((line) => Product.updateOne({ _id: line.productId, trackStock: true }, { $inc: { stock: line.quantity } })));
        throw error;
      }
    }
  }
  if (!order) {
    await Promise.all(priced.lines.filter((line) => line.trackedStock).map((line) => Product.updateOne({ _id: line.productId, trackStock: true }, { $inc: { stock: line.quantity } })));
    return fail(500, 'Could not place your order. Please try again.');
  }

  try {
    const razorpayOrder = await razorpay().orders.create({
      amount: Math.round(total * 100),
      currency: 'INR',
      receipt: order.orderNumber,
      notes: { type: 'alacarte', alacarteOrderId: String(order._id), userId: String(user._id) }
    });
    order.razorpayOrderId = razorpayOrder.id;
    await order.save();
    return { order, razorpayOrder };
  } catch (error) {
    console.error('Could not create the Razorpay order for an à la carte order:', error.message || error);
    await releaseStock(order);
    await AlacarteOrder.deleteOne({ _id: order._id });
    return fail(502, 'Could not start the payment. Please try again.');
  }
};

const shortDate = (date) => DateTime.fromJSDate(date, { zone: 'utc' }).toFormat('ccc, d LLL');

const NOTIFICATION_TEXT = {
  placed: (order) => ({
    title: 'Order placed',
    body: `Thank you! Order ${order.orderNumber} is placed for ${shortDate(order.deliveryDate)}, ${SLOT_LABELS[order.deliverySlot]}.`
  }),
  confirmed: (order) => ({
    title: 'Order confirmed',
    body: `Order ${order.orderNumber} is confirmed for ${shortDate(order.deliveryDate)}, ${SLOT_LABELS[order.deliverySlot]}.`
  }),
  out_for_delivery: (order) => ({
    title: 'Out for delivery',
    body: `Order ${order.orderNumber} is on its way to you.`
  }),
  delivered: (order) => ({
    title: 'Order delivered',
    body: `Order ${order.orderNumber} has been delivered. Enjoy!`
  })
};

const notifyOrderUpdate = async (order) => {
  const build = NOTIFICATION_TEXT[order.status];
  if (!build) return;
  try {
    const { title, body } = build(order);
    const dayKey = DateTime.now().setZone(IST_ZONE).toFormat('yyyy-MM-dd');
    const campaign = await Notification.findOneAndUpdate(
      { autoKey: `alacarte-orders:${dayKey}` },
      {
        $setOnInsert: {
          title: 'À la carte order updates',
          body: 'Updates about customers’ à la carte orders.',
          category: 'service',
          route: '/alacarte-orders',
          filter: {},
          audienceSummary: `Automatic: à la carte order updates · ${dayKey}`,
          source: 'auto',
          status: 'sent',
          sentAt: new Date()
        }
      },
      { upsert: true, new: true }
    );
    const result = await deliverItems(campaign, [{ userId: order.userId, title, body, dedupeKey: `alacarte:${order._id}:${order.status}` }]);
    await Notification.updateOne(
      { _id: campaign._id },
      {
        $inc: {
          'stats.recipients': result.recipients,
          'stats.pushSent': result.pushSent,
          'stats.pushFailed': result.pushFailed,
          'stats.noDevice': result.noDevice
        }
      }
    );
  } catch (error) {
    console.error('Could not send the à la carte order update:', error.message);
  }
};

const sendAdminOrderAlert = async (order) => {
  try {
    const client = new MailtrapClient({ token: process.env.MAILTRAP_API_TOKEN });
    const lines = order.items.map((item) => `${item.quantity} x ${item.name} (₹${item.unitPrice} each)`).join('\n');
    await client.send({
      from: { email: 'hello@app.mealprep.co.in', name: 'Mealprep' },
      to: [{ email: ADMIN_ALERT_EMAIL, name: 'Admin' }],
      subject: `New à la carte order ${order.orderNumber}: ₹${order.total}`,
      text:
        `A new à la carte order has been paid.\n\n` +
        `Order: ${order.orderNumber}\nCustomer: ${order.customerName}\nMobile: ${order.mobile}\n` +
        `Deliver on: ${shortDate(order.deliveryDate)}, ${SLOT_LABELS[order.deliverySlot]}\nAddress: ${order.address}\n` +
        (order.note ? `Note: ${order.note}\n` : '') +
        `\n--- ITEMS ---\n${lines}\n\nSubtotal: ₹${order.subtotal}\nDelivery fee: ₹${order.deliveryFee}\nTotal paid: ₹${order.total}\n` +
        `Payment ID: ${order.paymentId}\n` +
        (order.needsAttention ? `\nATTENTION: the stock ran short while this order was being paid. Please check it.\n` : '')
    });
  } catch (error) {
    console.error('À la carte admin alert failed:', error.message);
  }
};

const afterPaid = (order) => {
  notifyOrderUpdate(order);
  sendAdminOrderAlert(order);
};

const markPaid = async (orderId, paymentId) => {
  const historyEntry = { status: 'placed', at: new Date(), byName: 'Customer' };
  const placed = await AlacarteOrder.findOneAndUpdate(
    { _id: orderId, status: 'pending_payment' },
    { $set: { status: 'placed', paymentId, paidAt: new Date() }, $push: { statusHistory: historyEntry } },
    { new: true }
  );
  if (placed) {
    afterPaid(placed);
    return placed;
  }

  const current = await AlacarteOrder.findById(orderId);
  if (!current || current.status !== 'expired') return current;

  const reservation = await reserveStock(current.items);
  const revived = await AlacarteOrder.findOneAndUpdate(
    { _id: orderId, status: 'expired' },
    {
      $set: {
        status: 'placed',
        paymentId,
        paidAt: new Date(),
        stockReserved: Boolean(reservation.ok && reservation.reservedAny),
        needsAttention: !reservation.ok
      },
      $push: { statusHistory: historyEntry }
    },
    { new: true }
  );
  if (revived) afterPaid(revived);
  return revived || current;
};

const RECONCILE_AFTER_MINUTES = 2;

const reconcilePayment = async (order) => {
  if (!order || !order.razorpayOrderId || !['pending_payment', 'expired'].includes(order.status)) return { paid: false };
  const result = await razorpay().orders.fetchPayments(order.razorpayOrderId);
  const captured = (result.items || []).find((payment) => payment.status === 'captured');
  if (!captured) return { paid: false };
  const updated = await markPaid(order._id, captured.id);
  const paid = Boolean(updated) && !['pending_payment', 'expired'].includes(updated.status);
  return { paid, order: updated };
};

const expirePendingOrders = async () => {
  const reconcileCutoff = new Date(Date.now() - RECONCILE_AFTER_MINUTES * 60 * 1000);
  const waiting = await AlacarteOrder.find({ status: 'pending_payment', createdAt: { $lt: reconcileCutoff } });
  for (const order of waiting) {
    try {
      await reconcilePayment(order);
    } catch (error) {
      console.error(`Could not check the payment for à la carte order ${order.orderNumber}:`, error.message || error);
    }
  }

  const cutoff = new Date(Date.now() - PENDING_PAYMENT_MINUTES * 60 * 1000);
  const stale = await AlacarteOrder.find({ status: 'pending_payment', createdAt: { $lt: cutoff } });
  for (const order of stale) {
    const expired = await AlacarteOrder.findOneAndUpdate(
      { _id: order._id, status: 'pending_payment' },
      { $set: { status: 'expired' }, $push: { statusHistory: { status: 'expired', at: new Date(), byName: 'System' } } },
      { new: true }
    );
    if (expired) await releaseStock(expired);
  }
};

const changeStatus = async (order, status, adminName) => {
  const updated = await AlacarteOrder.findOneAndUpdate(
    { _id: order._id, status: order.status },
    { $set: { status }, $push: { statusHistory: { status, at: new Date(), byName: adminName } } },
    { new: true }
  );
  if (updated) notifyOrderUpdate(updated);
  return updated;
};

module.exports = {
  getSettings,
  createOrder,
  markPaid,
  reconcilePayment,
  expirePendingOrders,
  changeStatus,
  releaseStock
};
