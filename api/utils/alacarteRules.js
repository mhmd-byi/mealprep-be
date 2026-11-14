const crypto = require('crypto');
const { DateTime } = require('luxon');
const { IST_ZONE } = require('./dateUtils');

const SLOT_LABELS = {
  morning: '8:00 AM – 12:00 PM',
  midday: '12:00 PM – 4:00 PM',
  evening: '4:00 PM – 7:00 PM'
};
const DEFAULT_SLOT_TIMES = [
  { key: 'morning', startTime: '08:00', endTime: '12:00' },
  { key: 'midday', startTime: '12:00', endTime: '16:00' },
  { key: 'evening', startTime: '16:00', endTime: '19:00' }
];
const MAX_SLOTS = 10;
const MAX_SLOT_FEE = 5000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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

const formatSlotTime = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
};

const slotLabel = (slot) => `${formatSlotTime(slot.startTime)} – ${formatSlotTime(slot.endTime)}`;

const defaultSlots = (middayFee) =>
  DEFAULT_SLOT_TIMES.map((slot) => ({ ...slot, fee: slot.key === 'midday' ? roundMoney(middayFee || 0) : 0 }));

const labelledSlots = (slots) =>
  slots.map((slot) => ({
    key: slot.key,
    startTime: slot.startTime,
    endTime: slot.endTime,
    fee: roundMoney(slot.fee || 0),
    label: slotLabel(slot)
  }));

const publicSlots = (slots) => slots.map(({ key, label, fee }) => ({ key, label, fee }));

const orderSlotLabel = (order) => order.deliverySlotLabel || SLOT_LABELS[order.deliverySlot] || order.deliverySlot || '';

const generateSlotKey = () => `slot_${crypto.randomBytes(4).toString('hex')}`;

const validateSlots = (input) => {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Keep at least one delivery slot.' };
  if (input.length > MAX_SLOTS) return { error: `You can have at most ${MAX_SLOTS} delivery slots.` };

  const slots = [];
  const keys = new Set();
  const times = new Set();
  for (const entry of input) {
    const startTime = String((entry && entry.startTime) || '');
    const endTime = String((entry && entry.endTime) || '');
    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) return { error: 'Every slot needs a start and an end time.' };
    if (endTime <= startTime) return { error: 'A slot must end after it starts.' };

    const fee = Number(entry.fee);
    if (!Number.isFinite(fee) || fee < 0 || fee > MAX_SLOT_FEE) return { error: `Enter a fee between 0 and ${MAX_SLOT_FEE} for every slot.` };

    const timeKey = `${startTime}-${endTime}`;
    if (times.has(timeKey)) return { error: 'Two slots have the same time.' };
    times.add(timeKey);

    let key = typeof entry.key === 'string' && /^[a-z0-9_]{1,30}$/.test(entry.key) ? entry.key : '';
    if (key && keys.has(key)) return { error: 'Reload the page and try again.' };
    while (!key || keys.has(key)) key = generateSlotKey();
    keys.add(key);

    slots.push({ key, startTime, endTime, fee: roundMoney(fee) });
  }

  slots.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
  return { slots };
};

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
  SLOT_LABELS,
  MAX_SLOTS,
  MAX_SLOT_FEE,
  MAX_QUANTITY,
  MAX_LINES,
  MAX_IMAGES,
  DELIVERY_DAYS_AHEAD,
  DEFAULT_DAYS,
  PENDING_PAYMENT_MINUTES,
  roundMoney,
  slotLabel,
  defaultSlots,
  labelledSlots,
  publicSlots,
  orderSlotLabel,
  validateSlots,
  weekdayOf,
  cutoffMoment,
  unavailableReason,
  deliveryDateOptions,
  priceLines,
  generateOrderNumber,
  nextStatusAllowed
};
