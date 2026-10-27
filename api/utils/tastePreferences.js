const TasteOption = require('../models/tasteOptionModel');

const toList = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []);

const loadTasteLabels = async () => {
  const options = await TasteOption.find({}, 'group label').sort({ sortOrder: 1, _id: 1 }).lean();
  const labelsFor = (group) => options.filter((option) => option.group === group).map((option) => option.label);
  return { spice: labelsFor('spice'), flavour: labelsFor('flavour') };
};

const cleanTastePreferences = async ({ spiceLevel, flavourPreferences } = {}) => {
  const valid = await loadTasteLabels();
  const requested = toList(flavourPreferences).map((item) => String(item).trim());
  return {
    spiceLevel: valid.spice.includes(spiceLevel) ? spiceLevel : '',
    flavourPreferences: valid.flavour.filter((label) => requested.includes(label))
  };
};

const describeTastePreferences = ({ spiceLevel, flavourPreferences }) => {
  const flavours = flavourPreferences.length ? flavourPreferences.join(', ') : 'none';
  return `Spice: ${spiceLevel || 'not set'}; Flavours: ${flavours}`;
};

module.exports = {
  cleanTastePreferences,
  describeTastePreferences
};
