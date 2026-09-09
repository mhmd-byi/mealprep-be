const ExpenseCategory = require('../models/expenseCategoryModel');
const { requireAdmin } = require('../utils/requireAdmin');

const getCategories = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const categories = await ExpenseCategory.find().sort({ name: 1 });
    res.json(categories);
  } catch (error) {
    console.error('Error fetching expense categories:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const createCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { name, color } = req.body;
    if (!name || !name.trim() || !color) {
      return res.status(400).json({ message: 'name and color are required.' });
    }

    const existing = await ExpenseCategory.findOne({ name: name.trim() });
    if (existing) {
      return res.status(400).json({ message: 'A category with this name already exists.' });
    }

    const category = await ExpenseCategory.create({ name: name.trim(), color, subcategories: [] });
    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating expense category:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const updateCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { categoryId } = req.params;
    const { name, color } = req.body;
    const updates = {};

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ message: 'name cannot be empty.' });
      }
      const existing = await ExpenseCategory.findOne({ name: name.trim(), _id: { $ne: categoryId } });
      if (existing) {
        return res.status(400).json({ message: 'A category with this name already exists.' });
      }
      updates.name = name.trim();
    }
    if (color !== undefined) updates.color = color;

    const updated = await ExpenseCategory.findByIdAndUpdate(categoryId, updates, { new: true, runValidators: true });
    if (!updated) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    res.json(updated);
  } catch (error) {
    console.error('Error updating expense category:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Categories/subcategories are referenced by name (not id) on Expense records,
// same as the rest of this app's simple string-based fields — deleting a
// category here removes it from the picklist only, existing expense records
// keep their old category/subcategory text untouched.
const deleteCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { categoryId } = req.params;
    const deleted = await ExpenseCategory.findByIdAndDelete(categoryId);
    if (!deleted) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    res.json({ message: 'Category deleted successfully.' });
  } catch (error) {
    console.error('Error deleting expense category:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const addSubcategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { categoryId } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'name is required.' });
    }

    const category = await ExpenseCategory.findById(categoryId);
    if (!category) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    const trimmed = name.trim();
    if (category.subcategories.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      return res.status(400).json({ message: 'A subcategory with this name already exists.' });
    }

    category.subcategories.push({ name: trimmed });
    await category.save();
    res.status(201).json(category);
  } catch (error) {
    console.error('Error adding subcategory:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const updateSubcategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { categoryId, subcategoryId } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'name is required.' });
    }

    const category = await ExpenseCategory.findById(categoryId);
    if (!category) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    const sub = category.subcategories.id(subcategoryId);
    if (!sub) {
      return res.status(404).json({ message: 'Subcategory not found.' });
    }

    const trimmed = name.trim();
    const duplicate = category.subcategories.some(
      (s) => s._id.toString() !== subcategoryId && s.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      return res.status(400).json({ message: 'A subcategory with this name already exists.' });
    }

    sub.name = trimmed;
    await category.save();
    res.json(category);
  } catch (error) {
    console.error('Error updating subcategory:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const deleteSubcategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { categoryId, subcategoryId } = req.params;
    const category = await ExpenseCategory.findById(categoryId);
    if (!category) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    const sub = category.subcategories.id(subcategoryId);
    if (!sub) {
      return res.status(404).json({ message: 'Subcategory not found.' });
    }

    category.subcategories.pull(subcategoryId);
    await category.save();
    res.json(category);
  } catch (error) {
    console.error('Error deleting subcategory:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  addSubcategory,
  updateSubcategory,
  deleteSubcategory
};
