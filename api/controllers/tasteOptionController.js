const TasteOption = require('../models/tasteOptionModel');
const Subscription = require('../models/subscriptionModel');
const { requireAuth } = require('../utils/requireAuth');
const { requireAdmin } = require('../utils/requireAdmin');

const GROUPS = ['spice', 'flavour'];
const MAX_LABEL_LENGTH = 24;

const validateLabel = (label) => {
  const trimmed = typeof label === 'string' ? label.trim() : '';
  if (!trimmed) return { error: 'label is required.' };
  if (trimmed.length > MAX_LABEL_LENGTH) return { error: `label must be ${MAX_LABEL_LENGTH} characters or fewer.` };
  if (trimmed.includes(',')) return { error: 'label cannot contain a comma.' };
  return { value: trimmed };
};

const findDuplicate = (group, label, excludeId) =>
  TasteOption.findOne({ group, label, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .collation({ locale: 'en', strength: 2 });

const getTasteOptions = async (req, res) => {
  try {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const options = await TasteOption.find().sort({ sortOrder: 1, _id: 1 }).lean();
    const forGroup = (group) =>
      options.filter((option) => option.group === group).map(({ _id, label }) => ({ _id, label }));

    res.json({ spice: forGroup('spice'), flavour: forGroup('flavour') });
  } catch (error) {
    console.error('Error fetching taste options:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const createTasteOption = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { group, label } = req.body;
    if (!GROUPS.includes(group)) {
      return res.status(400).json({ message: `group must be one of: ${GROUPS.join(', ')}` });
    }
    const checked = validateLabel(label);
    if (checked.error) {
      return res.status(400).json({ message: checked.error });
    }
    if (await findDuplicate(group, checked.value)) {
      return res.status(400).json({ message: 'An option with this name already exists.' });
    }

    const last = await TasteOption.findOne({ group }).sort({ sortOrder: -1 });
    const option = await TasteOption.create({
      group,
      label: checked.value,
      sortOrder: (last?.sortOrder || 0) + 1
    });
    res.status(201).json({ _id: option._id, label: option.label });
  } catch (error) {
    console.error('Error creating taste option:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const updateTasteOption = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const option = await TasteOption.findById(req.params.optionId);
    if (!option) {
      return res.status(404).json({ message: 'Option not found.' });
    }
    const checked = validateLabel(req.body.label);
    if (checked.error) {
      return res.status(400).json({ message: checked.error });
    }
    if (await findDuplicate(option.group, checked.value, option._id)) {
      return res.status(400).json({ message: 'An option with this name already exists.' });
    }

    const oldLabel = option.label;
    option.label = checked.value;
    await option.save();

    if (oldLabel !== option.label) {
      if (option.group === 'spice') {
        await Subscription.updateMany(
          { spiceLevel: oldLabel },
          { $set: { spiceLevel: option.label } },
          { timestamps: false }
        );
      } else {
        await Subscription.updateMany(
          { flavourPreferences: oldLabel },
          { $set: { 'flavourPreferences.$[item]': option.label } },
          { arrayFilters: [{ item: oldLabel }], timestamps: false }
        );
      }
    }

    res.json({ _id: option._id, label: option.label });
  } catch (error) {
    console.error('Error updating taste option:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const deleteTasteOption = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const deleted = await TasteOption.findByIdAndDelete(req.params.optionId);
    if (!deleted) {
      return res.status(404).json({ message: 'Option not found.' });
    }
    res.json({ message: 'Option deleted successfully.' });
  } catch (error) {
    console.error('Error deleting taste option:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  getTasteOptions,
  createTasteOption,
  updateTasteOption,
  deleteTasteOption
};
