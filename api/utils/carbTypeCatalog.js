const CarbType = require('../models/carbTypeModel');

const point = (value) => ({ min: value });
const range = (min, max) => ({ min, max });

const DEFAULT_CARB_TYPES = [
  {
    slug: 'low-carb-high-protein',
    name: 'Low Carb High Protein (LCHP)',
    shortCode: 'LCHP',
    color: '#1baf7a',
    nutrition: { protein: point(33), carbs: point(49), fat: point(16), fiber: point(7), kcal: point(472) },
    isActive: true,
    sortOrder: 1,
    websiteName: 'Low-Carb, High-Protein',
    websiteBlurb: 'Ideal for those focusing on lean muscle and controlled carb intake.',
    showOnWebsite: true
  },
  {
    slug: 'balanced-meal',
    name: 'Balanced Meal',
    shortCode: 'BAL',
    color: '#2a78d6',
    nutrition: { protein: point(39), carbs: point(55), fat: point(21), fiber: point(5), kcal: point(544) },
    isActive: true,
    sortOrder: 2,
    websiteName: 'Balanced Mealbox',
    websiteBlurb: 'A well-rounded meal for overall health and nourishment.',
    showOnWebsite: true
  },
  {
    slug: 'high-carb-high-protein',
    name: 'High Carb High Protein (HCHP)',
    shortCode: 'HCHP',
    color: '#eb6834',
    nutrition: { protein: point(37), carbs: point(97), fat: point(23), fiber: point(5), kcal: point(710) },
    isActive: true,
    sortOrder: 3,
    websiteName: 'Weight Gain Mealbox',
    websiteBlurb: 'High-energy meal designed for healthy weight gain.',
    showOnWebsite: true
  },
  {
    slug: 'zero-carb',
    name: 'Zero Carb Meal',
    shortCode: 'ZC',
    color: '#e87ba4',
    nutrition: { protein: range(33, 47), carbs: range(0, 6), fat: range(12, 18), kcal: range(265, 375) },
    isActive: true,
    sortOrder: 4,
    websiteName: '',
    websiteBlurb: '',
    showOnWebsite: false
  },
  {
    slug: 'keto-meal',
    name: 'Keto Meal',
    shortCode: 'KETO',
    color: '#4a3aa7',
    nutrition: { protein: range(25, 35), carbs: range(10, 15), fat: range(15, 40), kcal: range(275, 515) },
    isActive: true,
    sortOrder: 5,
    websiteName: '',
    websiteBlurb: '',
    showOnWebsite: false
  },
  {
    slug: 'regular',
    name: 'Regular (Legacy)',
    shortCode: 'REGU',
    color: '#c9a227',
    nutrition: {},
    isActive: false,
    sortOrder: 99,
    websiteName: '',
    websiteBlurb: '',
    showOnWebsite: false
  }
];

const MACRO_KEYS = ['protein', 'carbs', 'fat', 'fiber', 'kcal'];

const shapeMacro = (macro) => {
  if (!macro || !Number.isFinite(macro.min)) return null;
  return { min: macro.min, max: Number.isFinite(macro.max) && macro.max !== macro.min ? macro.max : null };
};

const shortCodeFor = (carbType) => carbType.shortCode || carbType.slug.replace(/-/g, '').slice(0, 4).toUpperCase();

const shapeCarbType = (carbType) => ({
  _id: carbType._id || null,
  slug: carbType.slug,
  name: carbType.name,
  shortCode: shortCodeFor(carbType),
  color: carbType.color || '#6b7280',
  nutrition: Object.fromEntries(MACRO_KEYS.map((key) => [key, shapeMacro(carbType.nutrition && carbType.nutrition[key])])),
  isActive: carbType.isActive !== false,
  sortOrder: carbType.sortOrder || 0,
  websiteName: carbType.websiteName || '',
  websiteBlurb: carbType.websiteBlurb || '',
  showOnWebsite: Boolean(carbType.showOnWebsite)
});

const loadAllCarbTypes = async () => {
  const stored = await CarbType.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
  return stored.length > 0 ? stored : DEFAULT_CARB_TYPES;
};

const findCarbType = async (slug, { activeOnly = false } = {}) => {
  const wanted = String(slug || '').trim().toLowerCase();
  if (!wanted) return null;
  const all = await loadAllCarbTypes();
  return all.find((item) => item.slug === wanted && (!activeOnly || item.isActive !== false)) || null;
};

module.exports = { DEFAULT_CARB_TYPES, MACRO_KEYS, shapeCarbType, loadAllCarbTypes, findCarbType };
