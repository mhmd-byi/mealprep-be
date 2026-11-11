const { DateTime } = require('luxon');
const { IST_ZONE } = require('./dateUtils');

const SLOT_LABELS = {
  morning: '8:00 AM – 12:00 PM',
  midday: '12:00 PM – 4:00 PM',
  evening: '4:00 PM – 7:00 PM'
};
const SLOT_KEYS = Object.keys(SLOT_LABELS);

const MAX_QUANTITY = 20;
const MAX_LINES = 20;
const MAX_IMAGES = 5;
const DELIVERY_DAYS_AHEAD = 14;
const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6];
const PENDING_PAYMENT_MINUTES = 20;

const FORWARD_STATUSES = {
  placed: ['confirmed', 'out_for_delivery', 'delivered'],
  confirmed: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: []
};

const roundMoney = (value) => Math.round(value * 100) / 100;

const slotsWithFees = (middayFee) =>
  SLOT_KEYS.map((key) => ({ key, label: SLOT_LABELS[key], fee: key === 'midday' ? roundMoney(middayFee || 0) : 0 }));

const feeForSlot = (slot, middayFee) => (slot === 'midday' ? roundMoney(middayFee || 0) : 0);

const weekdayOf = (dateKey) => DateTime.fromISO(dateKey, { zone: 'utc' }).weekday % 7;

const cutoffMoment = (product, dateKey) => {
  const [hours, minutes] = String(product.cutoffTime || '18:00')
    .split(':')
    .map(Number);
  return DateTime.fromISO(dateKey, { zone: IST_ZONE })
    .minus({ days: Number.isFinite(product.cutoffDaysBefore) ? product.cutoffDaysBefore : 1 })
    .set({ hour: hours || 0, minute: minutes || 0, second: 0, millisecond: 0 });
};

const unavailableReason = (product, dateKey, now, holidayKeys) => {
  const weekday = weekdayOf(dateKey);
  if (weekday === 0) return 'we are closed on Sundays';
  if (holidayKeys.has(dateKey)) return 'we are closed that day';
  const days = Array.isArray(product.availableDays) && product.availableDays.length ? product.availableDays : DEFAULT_DAYS;
  if (!days.includes(weekday)) return 'it is not available on that day';
  if (now >= cutoffMoment(product, dateKey)) return 'the order time for that day has passed';
  return '';
};

const deliveryDateOptions = (products, now, holidayKeys, daysAhead = DELIVERY_DAYS_AHEAD) => {
  const dates = [];
  const start = now.setZone(IST_ZONE).startOf('day');
  for (let offset = 0; offset <= daysAhead; offset += 1) {
    const dateKey = start.plus({ days: offset }).toFormat('yyyy-MM-dd');
    const blocked = products.some((product) => unavailableReason(product, dateKey, now, holidayKeys));
    if (!blocked) dates.push(dateKey);
  }
  return dates;
};

const isStockShort = (product, quantity) => Boolean(product.trackStock) && product.stock < quantity;

const priceLines = (products, requested) => {
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const lines = [];
  const problems = [];
  const seen = new Set();

  if (!Array.isArray(requested) || requested.length === 0) {
    return { lines, subtotal: 0, problems: ['Your cart is empty.'] };
  }
  if (requested.length > MAX_LINES) {
    return { lines, subtotal: 0, problems: ['There are too many different items in your cart.'] };
  }

  requested.forEach((entry) => {
    const productId = String(entry && entry.productId);
    const quantity = Number(entry && entry.quantity);
    const product = byId.get(productId);
    if (!product || !product.isActive) {
      problems.push('One of the items in your cart is no longer available.');
      return;
    }
    if (seen.has(productId)) {
      problems.push(`${product.name} is in your cart twice.`);
      return;
    }
    seen.add(productId);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      problems.push(`Choose between 1 and ${MAX_QUANTITY} of ${product.name}.`);
      return;
    }
    if (product.trackStock && product.stock <= 0) {
      problems.push(`${product.name} is sold out.`);
      return;
    }
    if (isStockShort(product, quantity)) {
      problems.push(`Only ${product.stock} of ${product.name} left.`);
      return;
    }
    lines.push({
      productId: product._id,
      name: product.name,
      image: product.images && product.images[0] ? product.images[0].url : '',
      dietType: product.dietType,
      unitPrice: roundMoney(product.price),
      compareAtPrice: product.compareAtPrice ? roundMoney(product.compareAtPrice) : null,
      quantity,
      trackedStock: Boolean(product.trackStock)
    });
  });

  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
  return { lines, subtotal, problems };
};

const ORDER_NUMBER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const generateOrderNumber = (now = DateTime.now().setZone(IST_ZONE), random = Math.random) => {
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += ORDER_NUMBER_CHARS[Math.floor(random() * ORDER_NUMBER_CHARS.length)];
  return `AC-${now.toFormat('yyMMdd')}-${suffix}`;
};

const nextStatusAllowed = (from, to) => Boolean(FORWARD_STATUSES[from] && FORWARD_STATUSES[from].includes(to));

module.exports = {
  SLOT_KEYS,
  SLOT_LABELS,
  MAX_QUANTITY,
  MAX_LINES,
  MAX_IMAGES,
  DELIVERY_DAYS_AHEAD,
  DEFAULT_DAYS,
  PENDING_PAYMENT_MINUTES,
  roundMoney,
  slotsWithFees,
  feeForSlot,
  weekdayOf,
  cutoffMoment,
  unavailableReason,
  deliveryDateOptions,
  priceLines,
  generateOrderNumber,
  nextStatusAllowed
};
