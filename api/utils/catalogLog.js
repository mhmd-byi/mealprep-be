const CatalogChangeLog = require('../models/catalogChangeLogModel');

const MACROS = [
  ['protein', 'Protein'],
  ['carbs', 'Carbs'],
  ['fat', 'Fat'],
  ['fiber', 'Fiber'],
  ['kcal', 'Calories']
];

const macroSpec = ([key, label]) => ({
  field: `nutrition.${key}`,
  label: `${label} range`,
  kind: 'range',
  read: (doc) => {
    const macro = doc && doc.nutrition && doc.nutrition[key];
    return macro && macro.min !== null && macro.min !== undefined ? { min: macro.min, max: macro.max === undefined ? null : macro.max } : null;
  }
});

const SPECS = {
  plan: [
    { field: 'name', label: 'Name' },
    { field: 'price', label: 'Price', kind: 'money', price: true },
    { field: 'meals', label: 'Meals', kind: 'number' },
    { field: 'period', label: 'Period' },
    { field: 'description', label: 'Description' },
    { field: 'features', label: 'Features', kind: 'list' },
    { field: 'color', label: 'Colour' },
    { field: 'isActive', label: 'Available to customers', kind: 'flag' },
    { field: 'sortOrder', label: 'Display order', kind: 'number' },
    { field: 'websiteTitle', label: 'Website title' },
    { field: 'validityText', label: 'Validity text' },
    { field: 'imageUrl', label: 'Image' }
  ],
  product: [
    { field: 'name', label: 'Name' },
    { field: 'price', label: 'Price', kind: 'money', price: true },
    { field: 'compareAtPrice', label: 'Compare-at price', kind: 'money', price: true },
    { field: 'description', label: 'Description' },
    { field: 'dietType', label: 'Diet' },
    { field: 'category', label: 'Category' },
    { field: 'isActive', label: 'Visible to customers', kind: 'flag' },
    { field: 'trackStock', label: 'Track stock', kind: 'flag' },
    { field: 'stock', label: 'Stock', kind: 'number' },
    { field: 'availableDays', label: 'Available days', kind: 'list' },
    { field: 'cutoffDaysBefore', label: 'Ordering closes (days before)', kind: 'number' },
    { field: 'cutoffTime', label: 'Cut-off time' },
    { field: 'sortOrder', label: 'Display order', kind: 'number' },
    { field: 'images', label: 'Images', kind: 'images', read: (doc) => ((doc && doc.images) || []).map((image) => image.url) }
  ],
  category: [
    { field: 'name', label: 'Name' },
    { field: 'sortOrder', label: 'Display order', kind: 'number' }
  ],
  'carb-type': [
    { field: 'name', label: 'Name' },
    { field: 'shortCode', label: 'Short code' },
    { field: 'color', label: 'Colour' },
    ...MACROS.map(macroSpec),
    { field: 'isActive', label: 'Available to customers', kind: 'flag' },
    { field: 'sortOrder', label: 'Display order', kind: 'number' },
    { field: 'websiteName', label: 'Website name' },
    { field: 'websiteBlurb', label: 'Description' },
    { field: 'showOnWebsite', label: 'Show on website', kind: 'flag' }
  ]
};

const SNAPSHOT_FIELDS = {
  plan: ['name', 'price', 'meals', 'period', 'description', 'isActive'],
  product: ['name', 'price', 'compareAtPrice', 'dietType', 'category', 'isActive', 'stock'],
  category: ['name', 'sortOrder'],
  'carb-type': ['name', 'shortCode', 'isActive']
};

const readField = (spec, doc) => {
  const value = spec.read ? spec.read(doc) : doc ? doc[spec.field] : null;
  return value === undefined ? null : value;
};

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const diffFields = (module, before, after) => {
  const changes = [];
  SPECS[module].forEach((spec) => {
    const from = readField(spec, before);
    const to = readField(spec, after);
    if (sameValue(from, to)) return;
    const entry = { field: spec.field, label: spec.label, kind: spec.kind || 'text', before: from, after: to };
    if (spec.kind === 'money' && typeof from === 'number' && from > 0 && typeof to === 'number') {
      entry.percent = Math.round(((to - from) / from) * 1000) / 10;
    }
    changes.push(entry);
  });
  return changes;
};

const hasPriceChange = (module, changes) => {
  const priceFields = new Set(SPECS[module].filter((spec) => spec.price).map((spec) => spec.field));
  return changes.some((change) => priceFields.has(change.field));
};

const snapshotOf = (module, doc) =>
  SPECS[module]
    .filter((spec) => SNAPSHOT_FIELDS[module].includes(spec.field))
    .map((spec) => ({ label: spec.label, kind: spec.kind || 'text', value: readField(spec, doc) }));

const adminFields = (admin) => ({
  adminId: admin._id,
  adminName: `${admin.firstName || ''} ${admin.lastName || ''}`.trim() || 'Admin',
  adminEmail: admin.email || ''
});

const write = async (entry) => {
  try {
    await CatalogChangeLog.create(entry);
  } catch (error) {
    console.error('Could not write the catalogue log entry:', error);
  }
};

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const logCreated = (admin, module, doc) => {
  const item = plain(doc);
  return write({
    ...adminFields(admin),
    module,
    action: 'created',
    itemId: item._id,
    itemName: item.name,
    priceChanged: SPECS[module].some((spec) => spec.price),
    snapshot: snapshotOf(module, item)
  });
};

const logDeleted = (admin, module, doc) => {
  const item = plain(doc);
  return write({
    ...adminFields(admin),
    module,
    action: 'deleted',
    itemId: item._id,
    itemName: item.name,
    priceChanged: false,
    snapshot: snapshotOf(module, item)
  });
};

const logUpdated = (admin, module, before, after) => {
  const previous = plain(before);
  const next = plain(after);
  const changes = diffFields(module, previous, next);
  if (changes.length === 0) return Promise.resolve();
  return write({
    ...adminFields(admin),
    module,
    action: 'updated',
    itemId: next._id,
    itemName: next.name,
    priceChanged: hasPriceChange(module, changes),
    changes
  });
};

const logActiveChange = (admin, module, before, after) => {
  const previous = plain(before);
  const next = plain(after);
  if (Boolean(previous.isActive) === Boolean(next.isActive)) return Promise.resolve();
  return write({
    ...adminFields(admin),
    module,
    action: next.isActive ? 'activated' : 'deactivated',
    itemId: next._id,
    itemName: next.name,
    changes: [{ field: 'isActive', label: module === 'product' ? 'Visible to customers' : 'Available to customers', kind: 'flag', before: Boolean(previous.isActive), after: Boolean(next.isActive) }]
  });
};

const logSetup = (admin, module, docs, label) =>
  write({
    ...adminFields(admin),
    module,
    action: 'setup',
    itemName: label,
    priceChanged: false,
    snapshot: docs.map((doc) => {
      const item = plain(doc);
      return module === 'plan'
        ? { label: item.name, kind: 'money', value: item.price }
        : { label: item.name, kind: 'text', value: item.shortCode || '' };
    })
  });

const slotRange = (slot) => `${slot.startTime}–${slot.endTime}`;

const slotChanges = (beforeSlots, afterSlots) => {
  const before = new Map(beforeSlots.map((slot) => [slot.key, slot]));
  const after = new Map(afterSlots.map((slot) => [slot.key, slot]));
  const changes = [];

  afterSlots.forEach((slot) => {
    const previous = before.get(slot.key);
    if (!previous) {
      changes.push({ field: `slot.${slot.key}`, label: 'Slot added', kind: 'text', before: null, after: `${slotRange(slot)}, fee ₹${slot.fee}` });
      return;
    }
    if (slotRange(previous) !== slotRange(slot)) {
      changes.push({ field: `slot.${slot.key}.time`, label: 'Slot time', kind: 'text', before: slotRange(previous), after: slotRange(slot) });
    }
    if (previous.fee !== slot.fee) {
      const entry = { field: `slot.${slot.key}.fee`, label: `Delivery fee (${slotRange(slot)})`, kind: 'money', before: previous.fee, after: slot.fee };
      if (previous.fee > 0) entry.percent = Math.round(((slot.fee - previous.fee) / previous.fee) * 1000) / 10;
      changes.push(entry);
    }
  });

  beforeSlots.forEach((slot) => {
    if (!after.has(slot.key)) {
      changes.push({ field: `slot.${slot.key}`, label: 'Slot removed', kind: 'text', before: `${slotRange(slot)}, fee ₹${slot.fee}`, after: null });
    }
  });

  return changes;
};

const logSlotsChange = (admin, beforeSlots, afterSlots) => {
  const changes = slotChanges(beforeSlots, afterSlots);
  if (changes.length === 0) return Promise.resolve();
  return write({
    ...adminFields(admin),
    module: 'slots',
    action: 'updated',
    itemName: 'Delivery slots',
    priceChanged: changes.some((change) => change.kind === 'money' || change.label !== 'Slot time'),
    changes
  });
};

const formatValue = (kind, value) => {
  if (value === null || value === undefined || value === '') return '';
  if (kind === 'flag') return value ? 'Yes' : 'No';
  if (kind === 'list') return Array.isArray(value) ? value.join('; ') : String(value);
  if (kind === 'images') return `${Array.isArray(value) ? value.length : 0} image(s)`;
  if (kind === 'range') return value.max === null || value.max === undefined ? `${value.min}` : `${value.min}–${value.max}`;
  return String(value);
};

module.exports = {
  logCreated,
  logDeleted,
  logUpdated,
  logActiveChange,
  logSetup,
  logSlotsChange,
  diffFields,
  slotChanges,
  formatValue
};
