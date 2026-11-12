const mongoose = require('mongoose');
const CarbType = require('../models/carbTypeModel');
const Subscription = require('../models/subscriptionModel');
const { requireAdmin } = require('../utils/requireAdmin');
const { DEFAULT_CARB_TYPES, MACRO_KEYS, shapeCarbType, loadAllCarbTypes } = require('../utils/carbTypeCatalog');

const SLUG_PATTERN = /^[a-z0-9-]{2,40}$/;

const serverError = (res, label, error) => {
  console.error(`Error ${label}:`, error);
  res.status(500).json({ message: 'Internal Server Error', error: error.message });
};

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

const readMacro = (input, label) => {
  const blank = (value) => value === undefined || value === null || String(value).trim() === '';
  if (!input || blank(input.min)) {
    if (input && !blank(input.max)) return { error: `Enter the lowest ${label} value too.` };
    return { value: null };
  }
  const min = Number(input.min);
  if (!Number.isFinite(min) || min < 0 || min > 5000) return { error: `${label} must be a number from 0 to 5000.` };
  if (blank(input.max)) return { value: { min } };
  const max = Number(input.max);
  if (!Number.isFinite(max) || max < 0 || max > 5000) return { error: `${label} must be a number from 0 to 5000.` };
  if (max < min) return { error: `The highest ${label} value cannot be below the lowest.` };
  return { value: max === min ? { min } : { min, max } };
};

const MACRO_LABELS = { protein: 'protein', carbs: 'carbs', fat: 'fat', fiber: 'fibre', kcal: 'calories' };

const validateCarbTypeInput = (input = {}, { creating }) => {
  const name = text(input.name, 60);
  if (!name) return { error: 'A name is required.' };

  let slug;
  if (creating) {
    slug = text(input.slug, 40).toLowerCase() || slugify(name);
    if (!SLUG_PATTERN.test(slug)) return { error: 'Use letters or numbers in the name so an identifier can be made from it.' };
  }

  const shortCode = text(input.shortCode, 6).toUpperCase();
  if (shortCode && !/^[A-Z0-9]+$/.test(shortCode)) return { error: 'The short code can only use letters and numbers.' };

  const color = typeof input.color === 'string' && input.color ? input.color.trim() : '#6b7280';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: 'Choose a valid colour.' };

  const nutrition = {};
  const source = input.nutrition && typeof input.nutrition === 'object' ? input.nutrition : {};
  for (const key of MACRO_KEYS) {
    const macro = readMacro(source[key], MACRO_LABELS[key]);
    if (macro.error) return { error: macro.error };
    if (macro.value) nutrition[key] = macro.value;
  }

  const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 0;

  return {
    value: {
      ...(creating ? { slug } : {}),
      name,
      shortCode,
      color,
      nutrition,
      isActive: input.isActive === undefined ? true : Boolean(input.isActive),
      sortOrder,
      websiteName: text(input.websiteName, 60),
      websiteBlurb: text(input.websiteBlurb, 200),
      showOnWebsite: Boolean(input.showOnWebsite)
    }
  };
};

const getPublicCarbTypes = async (req, res) => {
  try {
    const all = await loadAllCarbTypes();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(all.map(shapeCarbType));
  } catch (error) {
    serverError(res, 'loading public carb types', error);
  }
};

const buildAdminList = async () => {
  const stored = await CarbType.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
  const counts = await Subscription.aggregate([
    { $group: { _id: '$carbType', total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } }
  ]);
  const bySlug = new Map(counts.map((row) => [row._id, row]));
  const source = stored.length > 0 ? stored : DEFAULT_CARB_TYPES;
  return {
    needsSetup: stored.length === 0,
    carbTypes: source.map((item) => ({
      ...shapeCarbType(item),
      subscriberCount: bySlug.get(item.slug)?.total || 0,
      activeCount: bySlug.get(item.slug)?.active || 0
    }))
  };
};

const listAdminCarbTypes = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.json(await buildAdminList());
  } catch (error) {
    serverError(res, 'listing carb types', error);
  }
};

const setupDefaultCarbTypes = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if ((await CarbType.estimatedDocumentCount()) > 0) {
      return res.status(409).json({ message: 'Carb types are already set up.' });
    }
    await CarbType.insertMany(DEFAULT_CARB_TYPES);
    res.status(201).json(await buildAdminList());
  } catch (error) {
    serverError(res, 'setting up the default carb types', error);
  }
};

const createCarbType = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const checked = validateCarbTypeInput(req.body, { creating: true });
    if (checked.error) return res.status(400).json({ message: checked.error });

    if ((await CarbType.estimatedDocumentCount()) === 0) {
      await CarbType.insertMany(DEFAULT_CARB_TYPES);
    }

    const duplicate = await CarbType.findOne({
      $or: [{ slug: checked.value.slug }, { name: checked.value.name }]
    }).collation({ locale: 'en', strength: 2 });
    if (duplicate) return res.status(400).json({ message: 'A carb type with this name already exists.' });

    const carbType = await CarbType.create(checked.value);
    res.status(201).json(shapeCarbType(carbType.toObject()));
  } catch (error) {
    serverError(res, 'creating a carb type', error);
  }
};

const updateCarbType = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.carbTypeId)) return res.status(404).json({ message: 'Carb type not found.' });

    const carbType = await CarbType.findById(req.params.carbTypeId);
    if (!carbType) return res.status(404).json({ message: 'Carb type not found.' });

    const checked = validateCarbTypeInput({ ...shapeCarbType(carbType.toObject()), ...req.body }, { creating: false });
    if (checked.error) return res.status(400).json({ message: checked.error });

    if (checked.value.name.toLowerCase() !== carbType.name.toLowerCase()) {
      const duplicate = await CarbType.findOne({ name: checked.value.name, _id: { $ne: carbType._id } }).collation({ locale: 'en', strength: 2 });
      if (duplicate) return res.status(400).json({ message: 'A carb type with this name already exists.' });
    }

    Object.assign(carbType, checked.value);
    carbType.markModified('nutrition');
    await carbType.save();
    res.json(shapeCarbType(carbType.toObject()));
  } catch (error) {
    serverError(res, 'updating a carb type', error);
  }
};

const setCarbTypeActive = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.carbTypeId)) return res.status(404).json({ message: 'Carb type not found.' });
    if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ message: 'isActive must be true or false.' });

    const carbType = await CarbType.findByIdAndUpdate(req.params.carbTypeId, { $set: { isActive: req.body.isActive } }, { new: true }).lean();
    if (!carbType) return res.status(404).json({ message: 'Carb type not found.' });
    res.json(shapeCarbType(carbType));
  } catch (error) {
    serverError(res, 'changing a carb type', error);
  }
};

const deleteCarbType = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.carbTypeId)) return res.status(404).json({ message: 'Carb type not found.' });

    const carbType = await CarbType.findById(req.params.carbTypeId);
    if (!carbType) return res.status(404).json({ message: 'Carb type not found.' });
    if (await Subscription.exists({ carbType: carbType.slug })) {
      return res.status(409).json({ message: 'Customers have subscriptions with this carb type, so it cannot be deleted. Archive it instead.' });
    }

    await carbType.deleteOne();
    res.json({ message: 'Carb type deleted.' });
  } catch (error) {
    serverError(res, 'deleting a carb type', error);
  }
};

module.exports = {
  getPublicCarbTypes,
  listAdminCarbTypes,
  setupDefaultCarbTypes,
  createCarbType,
  updateCarbType,
  setCarbTypeActive,
  deleteCarbType
};
