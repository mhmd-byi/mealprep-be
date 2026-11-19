const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const CatalogChangeLog = require('../models/catalogChangeLogModel');
const { requireAdmin } = require('../utils/requireAdmin');
const { IST_ZONE, istDayBoundsUTC } = require('../utils/dateUtils');
const { formatValue } = require('../utils/catalogLog');

const { MODULES, ACTIONS } = CatalogChangeLog;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const EXPORT_LIMIT = 5000;

const MODULE_LABELS = {
  plan: 'Plan',
  product: 'À la carte product',
  category: 'Product category',
  slots: 'Delivery slots',
  'carb-type': 'Carb type'
};

const serverError = (res, label, error) => {
  console.error(`Error ${label}:`, error);
  res.status(500).json({ message: 'Internal Server Error', error: error.message });
};

const buildFilter = (query) => {
  const filter = {};

  const modules = String(query.module || '')
    .split(',')
    .filter((value) => MODULES.includes(value));
  if (modules.length > 0) filter.module = { $in: modules };

  if (ACTIONS.includes(query.action)) filter.action = query.action;
  if (mongoose.Types.ObjectId.isValid(query.adminId)) filter.adminId = mongoose.Types.ObjectId(query.adminId);
  if (mongoose.Types.ObjectId.isValid(query.itemId)) filter.itemId = mongoose.Types.ObjectId(query.itemId);
  if (query.priceOnly === '1') filter.priceChanged = true;

  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 60) : '';
  if (search) filter.itemName = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const range = {};
  if (typeof query.from === 'string' && DATE_KEY.test(query.from)) range.$gte = istDayBoundsUTC(query.from).start;
  if (typeof query.to === 'string' && DATE_KEY.test(query.to)) range.$lte = istDayBoundsUTC(query.to).end;
  if (range.$gte || range.$lte) filter.createdAt = range;

  return filter;
};

const listCatalogLog = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = buildFilter(req.query);

    const [entries, total, admins] = await Promise.all([
      CatalogChangeLog.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CatalogChangeLog.countDocuments(filter),
      CatalogChangeLog.aggregate([{ $group: { _id: '$adminId', name: { $last: '$adminName' } } }, { $sort: { name: 1 } }])
    ]);

    res.json({ entries, total, page, limit, admins: admins.map((row) => ({ adminId: row._id, name: row.name })) });
  } catch (error) {
    serverError(res, 'listing the catalogue log', error);
  }
};

const csvCell = (value) => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;

const csvRows = (entry) => {
  const when = DateTime.fromJSDate(entry.createdAt, { zone: IST_ZONE }).toFormat('dd LLL yyyy HH:mm');
  const base = [when, entry.adminName, MODULE_LABELS[entry.module] || entry.module, entry.action, entry.itemName];

  if (entry.changes && entry.changes.length > 0) {
    return entry.changes.map((change) => [
      ...base,
      change.label,
      formatValue(change.kind, change.before),
      formatValue(change.kind, change.after),
      change.percent === null || change.percent === undefined ? '' : `${change.percent}%`
    ]);
  }

  const snapshot = entry.snapshot || [];
  if (snapshot.length === 0) return [[...base, '', '', '', '']];
  return snapshot.map((item) => {
    const value = formatValue(item.kind, item.value);
    return [...base, item.label, entry.action === 'deleted' ? value : '', entry.action === 'deleted' ? '' : value, ''];
  });
};

const exportCatalogLog = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const entries = await CatalogChangeLog.find(buildFilter(req.query)).sort({ createdAt: -1, _id: -1 }).limit(EXPORT_LIMIT).lean();
    const lines = [
      ['Date (IST)', 'Admin', 'Area', 'Action', 'Item', 'Field', 'Before', 'After', 'Change'].map(csvCell).join(','),
      ...entries.flatMap(csvRows).map((row) => row.map(csvCell).join(','))
    ];

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="catalogue-log-${DateTime.now().setZone(IST_ZONE).toFormat('yyyy-LL-dd')}.csv"`);
    res.send(`﻿${lines.join('\n')}`);
  } catch (error) {
    serverError(res, 'exporting the catalogue log', error);
  }
};

module.exports = { listCatalogLog, exportCatalogLog };
