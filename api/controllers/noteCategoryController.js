const NoteCategory = require('../models/noteCategoryModel');
const Note = require('../models/noteModel');
const { requireAdmin } = require('../utils/requireAdmin');

const MAX_NAME_LENGTH = 40;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const ICON_PATTERN = /^[A-Za-z0-9]{1,40}$/;

const validateName = (name) => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return { error: 'name is required.' };
  if (trimmed.length > MAX_NAME_LENGTH) return { error: `name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  return { value: trimmed };
};

const findDuplicate = (name, excludeId) =>
  NoteCategory.findOne({ name, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .collation({ locale: 'en', strength: 2 });

const getNoteCategories = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const categories = await NoteCategory.find().sort({ sortOrder: 1, _id: 1 });
    res.json(categories);
  } catch (error) {
    console.error('Error fetching note categories:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const createNoteCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { name, color, icon } = req.body;
    const checked = validateName(name);
    if (checked.error) {
      return res.status(400).json({ message: checked.error });
    }
    if (!COLOR_PATTERN.test(color || '')) {
      return res.status(400).json({ message: 'color must be a hex value like #2a78d6.' });
    }
    if (icon && !ICON_PATTERN.test(icon)) {
      return res.status(400).json({ message: 'icon is not valid.' });
    }
    if (await findDuplicate(checked.value)) {
      return res.status(400).json({ message: 'A category with this name already exists.' });
    }

    const last = await NoteCategory.findOne().sort({ sortOrder: -1 });
    const category = await NoteCategory.create({
      name: checked.value,
      color,
      icon: icon || 'StickyNote',
      sortOrder: (last?.sortOrder || 0) + 1
    });
    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating note category:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const updateNoteCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const category = await NoteCategory.findById(req.params.categoryId);
    if (!category) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    const { name, color, icon } = req.body;
    const oldName = category.name;

    if (name !== undefined) {
      const checked = validateName(name);
      if (checked.error) {
        return res.status(400).json({ message: checked.error });
      }
      if (await findDuplicate(checked.value, category._id)) {
        return res.status(400).json({ message: 'A category with this name already exists.' });
      }
      category.name = checked.value;
    }
    if (color !== undefined) {
      if (!COLOR_PATTERN.test(color)) {
        return res.status(400).json({ message: 'color must be a hex value like #2a78d6.' });
      }
      category.color = color;
    }
    if (icon !== undefined) {
      if (!ICON_PATTERN.test(icon)) {
        return res.status(400).json({ message: 'icon is not valid.' });
      }
      category.icon = icon;
    }

    await category.save();

    if (category.name !== oldName) {
      await Note.updateMany({ category: oldName }, { $set: { category: category.name } }, { timestamps: false });
    }

    res.json(category);
  } catch (error) {
    console.error('Error updating note category:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const deleteNoteCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const deleted = await NoteCategory.findByIdAndDelete(req.params.categoryId);
    if (!deleted) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    res.json({ message: 'Category deleted successfully.' });
  } catch (error) {
    console.error('Error deleting note category:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  getNoteCategories,
  createNoteCategory,
  updateNoteCategory,
  deleteNoteCategory
};
