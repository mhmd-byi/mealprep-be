const ProfessionOption = require('../models/professionOptionModel');
const User = require('../models/userModel');
const { requireAdmin } = require('../utils/requireAdmin');
const { OTHER_PROFESSION } = require('../utils/profileFields');

const MAX_LABEL_LENGTH = 40;

const validateLabel = (label) => {
  const trimmed = typeof label === 'string' ? label.trim() : '';
  if (!trimmed) return { error: 'label is required.' };
  if (trimmed.length > MAX_LABEL_LENGTH) return { error: `label must be ${MAX_LABEL_LENGTH} characters or fewer.` };
  if (trimmed.toLowerCase() === OTHER_PROFESSION.toLowerCase()) {
    return { error: `"${OTHER_PROFESSION}" is added to the list automatically.` };
  }
  return { value: trimmed };
};

const findDuplicate = (label, excludeId) =>
  ProfessionOption.findOne({ label, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .collation({ locale: 'en', strength: 2 });

const getProfessionOptions = async (req, res) => {
  try {
    const options = await ProfessionOption.find().sort({ sortOrder: 1, _id: 1 }).lean();
    res.json(options.map(({ _id, label }) => ({ _id, label })));
  } catch (error) {
    console.error('Error fetching profession options:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const createProfessionOption = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const checked = validateLabel(req.body.label);
    if (checked.error) {
      return res.status(400).json({ message: checked.error });
    }
    if (await findDuplicate(checked.value)) {
      return res.status(400).json({ message: 'A profession with this name already exists.' });
    }

    const last = await ProfessionOption.findOne().sort({ sortOrder: -1 });
    const option = await ProfessionOption.create({
      label: checked.value,
      sortOrder: (last?.sortOrder || 0) + 1
    });
    res.status(201).json({ _id: option._id, label: option.label });
  } catch (error) {
    console.error('Error creating profession option:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const updateProfessionOption = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const option = await ProfessionOption.findById(req.params.optionId);
    if (!option) {
      return res.status(404).json({ message: 'Profession not found.' });
    }
    const checked = validateLabel(req.body.label);
    if (checked.error) {
      return res.status(400).json({ message: checked.error });
    }
    if (await findDuplicate(checked.value, option._id)) {
      return res.status(400).json({ message: 'A profession with this name already exists.' });
    }

    const oldLabel = option.label;
    option.label = checked.value;
    await option.save();

    if (oldLabel !== option.label) {
      await User.updateMany(
        { profession: oldLabel },
        { $set: { profession: option.label } },
        { timestamps: false }
      );
    }

    res.json({ _id: option._id, label: option.label });
  } catch (error) {
    console.error('Error updating profession option:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const deleteProfessionOption = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const deleted = await ProfessionOption.findByIdAndDelete(req.params.optionId);
    if (!deleted) {
      return res.status(404).json({ message: 'Profession not found.' });
    }
    res.json({ message: 'Profession deleted successfully.' });
  } catch (error) {
    console.error('Error deleting profession option:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  getProfessionOptions,
  createProfessionOption,
  updateProfessionOption,
  deleteProfessionOption
};
