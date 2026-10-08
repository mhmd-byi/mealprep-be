const MealLibraryItem = require('../models/mealLibraryItemModel');
const { requireAdmin } = require('../utils/requireAdmin');

const getMealLibraryItems = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { category, mealType, dietType, search } = req.query;
    const query = {};
    if (category) query.category = category;
    if (dietType) query.dietType = dietType;
    if (mealType) query.mealType = { $in: [mealType, 'both'] };
    if (search) query.name = { $regex: search, $options: 'i' };

    const items = await MealLibraryItem.find(query).sort({ category: 1, name: 1 });
    res.json(items);
  } catch (error) {
    console.error('Error fetching meal library items:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const REQUIRED_FIELDS = ['name', 'category', 'dietType', 'mealType'];

const createMealLibraryItem = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const missing = REQUIRED_FIELDS.filter((field) => !req.body[field]);
    if (missing.length > 0) {
      return res.status(400).json({ message: `Missing required fields: ${missing.join(', ')}` });
    }

    const item = await MealLibraryItem.create(req.body);
    res.status(201).json(item);
  } catch (error) {
    console.error('Error creating meal library item:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const updateMealLibraryItem = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { itemId } = req.params;
    const updated = await MealLibraryItem.findByIdAndUpdate(itemId, req.body, { new: true, runValidators: true });
    if (!updated) {
      return res.status(404).json({ message: 'Meal library item not found.' });
    }
    res.json(updated);
  } catch (error) {
    console.error('Error updating meal library item:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const deleteMealLibraryItem = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { itemId } = req.params;
    const deleted = await MealLibraryItem.findByIdAndDelete(itemId);
    if (!deleted) {
      return res.status(404).json({ message: 'Meal library item not found.' });
    }
    res.json({ message: 'Meal library item deleted successfully.' });
  } catch (error) {
    console.error('Error deleting meal library item:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  getMealLibraryItems,
  createMealLibraryItem,
  updateMealLibraryItem,
  deleteMealLibraryItem
};
