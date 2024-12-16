const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const Meal = require('../models/mealModel');
const CustomiseMeal = require('../models/customiseMealModel');
require('dotenv').config();

// Add meal Api
const createMeal = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided or token is malformed' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, 'asdfghjkL007');
    } catch (error) {
      return res.status(401).json({ message: 'Invalid Token' });
    }

    const { userId, date, mealType, items } = req.body;
    const user = await User.findById(decoded.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can create meals' });
    }

    if (!userId || !date || !mealType || !items || items.length === 0) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    let existingMeal = await Meal.findOne({
      userId,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    if (existingMeal) {
      existingMeal.mealType = mealType;
      existingMeal.items = items;
      const updatedMeal = await existingMeal.save();
      res.status(200).json(updatedMeal);
    } else {
      const newMeal = new Meal({
        userId,
        date,
        mealType,
        items
      });
      const savedMeal = await newMeal.save();
      res.status(201).json(savedMeal);
    }
  } catch (error) {
    console.error('Error creating/updating meal:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};
// Fetch Meal API

const getMeal = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided or token is malformed' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ message: 'Invalid Token' });
    }

    if (decoded) {
      const { date } = req.query;

      if (!date) {
        return res.status(400).json({ message: 'Date parameter is required' });
      }

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      const meals = await Meal.find({
        date: { $gte: startOfDay, $lte: endOfDay }
      });

      res.json(meals);
    }
  } catch (error) {
    console.error('Error fetching meals:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Customise request meal api
const customizeMealRequest = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided or token is malformed' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ message: 'Invalid Token' });
    }

    if (decoded) {
      const { userId, date, items } = req.body;
      console.log('this is req body full', req.body)
      const itemsArray = Object.keys(items).map(key => ({
        name: items[key].name,
        weight: items[key].weight
      }));
      const customisationRequest = new CustomiseMeal({
        userId,
        date,
        items: itemsArray
      });
      const savedCustomisationMealRequest = await customisationRequest.save();
      res.status(201).json(savedCustomisationMealRequest);
    }
  } catch (e) {
    console.error('Error creating meal customisation request:', e);
    res.status(500).json({ message: 'Error creating meal customisation request', error: e.message });
  }
};

//  Remove Meal Api
const removeMealItem = async (req, res) => {
  try {
    const { mealId, itemId } = req.params;
    const meal = await Meal.findById(mealId);

    if (!meal) {
      return res.status(404).json({ message: 'Meal not found' });
    }

    meal.items = meal.items.filter(item => item._id.toString() !== itemId);

    if (meal.items.length === 0) {
      await Meal.findByIdAndDelete(mealId);
    } else {
      await meal.save();
    }

    res.json({ message: 'Item removed successfully' });
  } catch (error) {
    console.error('Error removing meal item:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// upload Image api
const updateOrCreateMealWithImages = async (req, res) => {
  const { date, imageUrls, userId } = req.body;

  if (!date || !imageUrls || !userId || imageUrls.length === 0) {
    return res.status(400).json({ message: 'Missing required fields: date, imageUrls, and userId are required.' });
  }
  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const update = {
      $setOnInsert: { userId, date, mealType: 'Default', items: [] },
      $addToSet: { imageUrls: { $each: imageUrls } } // Adds unique URLs
    };
    const options = { upsert: true, new: true };
    const meal = await Meal.findOneAndUpdate({ userId, date: { $gte: startOfDay, $lte: endOfDay } }, update, options);

    res.json({ message: 'Meal images updated successfully', meal });
  } catch (error) {
    console.error('Error updating or creating meal image URLs:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  createMeal,
  getMeal,
  removeMealItem,
  updateOrCreateMealWithImages,
  customizeMealRequest
};
