const MealCategory = require('../models/mealCategoryModel');
const MealLibraryItem = require('../models/mealLibraryItemModel');
const { requireAdmin } = require('../utils/requireAdmin');

const getMealCategories = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const categories = await MealCategory.find().sort({ name: 1 });
    res.json(categories);
  } catch (error) {
    console.error('Error fetching meal categories:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const createMealCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { name, color } = req.body;
    if (!name || !name.trim() || !color) {
      return res.status(400).json({ message: 'name and color are required.' });
    }

    const existing = await MealCategory.findOne({ name: name.trim() });
    if (existing) {
      return res.status(400).json({ message: 'A category with this name already exists.' });
    }

    const category = await MealCategory.create({ name: name.trim(), color });
    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating meal category:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const updateMealCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { categoryId } = req.params;
    const { name, color } = req.body;

    const existingCategory = await MealCategory.findById(categoryId);
    if (!existingCategory) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    const oldName = existingCategory.name;

    const updates = {};
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ message: 'name cannot be empty.' });
      }
      const duplicate = await MealCategory.findOne({ name: name.trim(), _id: { $ne: categoryId } });
      if (duplicate) {
        return res.status(400).json({ message: 'A category with this name already exists.' });
      }
      updates.name = name.trim();
    }
    if (color !== undefined) updates.color = color;

    const updated = await MealCategory.findByIdAndUpdate(categoryId, updates, { new: true, runValidators: true });

    if (updates.name && updates.name !== oldName) {
      await MealLibraryItem.updateMany({ category: oldName }, { $set: { category: updates.name } });
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating meal category:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Deleting a category only removes it from the picklist — existing meal
// library items keep their old category text, same convention as
// ExpenseCategory.
const deleteMealCategory = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { categoryId } = req.params;
    const deleted = await MealCategory.findByIdAndDelete(categoryId);
    if (!deleted) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    res.json({ message: 'Category deleted successfully.' });
  } catch (error) {
    console.error('Error deleting meal category:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  getMealCategories,
  createMealCategory,
  updateMealCategory,
  deleteMealCategory
};
