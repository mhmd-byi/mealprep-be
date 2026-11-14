const mongoose = require('mongoose');
const Subscription = require('../models/subscriptionModel');
const User = require('../models/userModel');
const { requireAuth } = require('../utils/requireAuth');
const { refreshPricing, hasRealPayment, computeGrossAmount } = require('../utils/planPricing');
const { findCarbType } = require('../utils/carbTypeCatalog');
const { buildInvoicePdf, invoiceNumber } = require('../utils/invoicePdf');

const HISTORY_LIMIT = 100;

const serverError = (res, label, error) => {
  console.error(`Error ${label}:`, error);
  res.status(500).json({ message: 'Internal Server Error', error: error.message });
};

const canAccess = (caller, ownerId) => caller.role === 'admin' || String(caller._id) === String(ownerId);

const billingInfo = (subscription) => {
  const amount = computeGrossAmount(subscription);
  const refunded = Boolean(subscription.refundId);
  return { amount, refunded, invoiceAvailable: hasRealPayment(subscription) && !refunded && amount > 0 };
};

const shapeHistoryItem = (subscription) => {
  const info = billingInfo(subscription);
  return {
    _id: subscription._id,
    plan: subscription.plan,
    status: subscription.status,
    mealType: subscription.mealType,
    carbType: subscription.carbType,
    totalMeals: subscription.totalMeals,
    subscriptionStartDate: subscription.subscriptionStartDate,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
    endedAt: subscription.endedAt || null,
    endedAtEstimated: Boolean(subscription.endedAtEstimated),
    amount: info.amount,
    refunded: info.refunded,
    paymentMethod: subscription.orderId ? 'Online' : subscription.paymentMethod || '',
    invoiceAvailable: info.invoiceAvailable,
    invoiceNumber: info.invoiceAvailable ? invoiceNumber(subscription) : ''
  };
};

const getSubscriptionHistory = async (req, res) => {
  try {
    const caller = await requireAuth(req, res);
    if (!caller) return;
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(404).json({ message: 'Customer not found.' });
    if (!canAccess(caller, userId)) return res.status(403).json({ message: 'You can only view your own billing history.' });

    await refreshPricing();
    const subscriptions = await Subscription.find({ userId }).sort({ createdAt: -1, _id: -1 }).limit(HISTORY_LIMIT).lean();
    res.json(subscriptions.map(shapeHistoryItem));
  } catch (error) {
    serverError(res, 'loading the subscription history', error);
  }
};

const downloadInvoice = async (req, res) => {
  try {
    const caller = await requireAuth(req, res);
    if (!caller) return;
    const { subscriptionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(subscriptionId)) return res.status(404).json({ message: 'Subscription not found.' });

    const subscription = await Subscription.findById(subscriptionId).lean();
    if (!subscription || !canAccess(caller, subscription.userId)) return res.status(404).json({ message: 'Subscription not found.' });

    await refreshPricing();
    const info = billingInfo(subscription);
    if (!info.invoiceAvailable) {
      return res.status(400).json({
        message: info.refunded ? 'This payment was refunded, so there is no invoice for it.' : 'There is no payment on record for this subscription.'
      });
    }

    const [customer, carb] = await Promise.all([User.findById(subscription.userId).lean(), findCarbType(subscription.carbType)]);
    const pdf = await buildInvoicePdf({
      subscription,
      customer: customer || {},
      amount: info.amount,
      carbLabel: carb ? carb.name : ''
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdf.length,
      'Content-Disposition': `attachment; filename="${invoiceNumber(subscription)}.pdf"`,
      'Cache-Control': 'private, no-store'
    });
    res.send(pdf);
  } catch (error) {
    serverError(res, 'creating the invoice', error);
  }
};

module.exports = { getSubscriptionHistory, downloadInvoice };
