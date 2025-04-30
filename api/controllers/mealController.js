const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const Meal = require('../models/mealModel');
const CustomiseMeal = require('../models/customiseMealModel');
const Activity = require('../models/activityModel');
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
      date: { $gte: startOfDay, $lte: endOfDay },
      mealType: mealType,
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
      const { date, mealType } = req.query;

      if (!date) {
        return res.status(400).json({ message: 'Date parameter is required' });
      }

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      const meals = await Meal.find({
        date: { $gte: startOfDay, $lte: endOfDay },
        mealType: mealType,
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
      const itemsArray = Object.keys(items).map(key => ({
        name: items[key].name,
        weight: items[key].weight,
        exclude: items[key].exclude
      }));
      const customisationRequest = new CustomiseMeal({
        userId,
        date,
        items: itemsArray
      });
      const activityData = new Activity({
        userId,
        date: new Date(),
        description: 'Requested for meal cstomisation for date ' + date
      });
      await activityData.save();
      const savedCustomisationMealRequest = await customisationRequest.save();
      res.status(201).json(savedCustomisationMealRequest);
    }
  } catch (e) {
    console.error('Error creating meal customisation request:', e);
    res.status(500).json({ message: 'Error creating meal customisation request', error: e.message });
  }
};

const getCustomisedMealRequests = async (req, res) => {
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

      // Fetch meals within the given date range
      const meals = await CustomiseMeal.find({
        date: { $gte: startOfDay, $lte: endOfDay }
      });

      // Extract user IDs from the meals
      const userIds = meals.map(meal => meal.userId);

      // Fetch user details based on the extracted user IDs
      const users = await User.find({ _id: { $in: userIds }});

      // Map the user details back onto the meal data
      const mealsWithUserDetails = meals.map(meal => ({
        ...meal.toObject(),
        user: users.find(user => user._id.toString() === meal.userId.toString())
      }));

      res.json(mealsWithUserDetails);
    }
  } catch (e) {
    console.error('Error fetching meals:', e);
    res.status(500).json({ message: 'Internal Server Error', error: e.message });
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

// get menu image api
const fetchMenuImages = async (req, res) => {
  try {
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

    const imageUrls = meals.reduce((acc, meal) => {
      const imagesWithSrc = meal.imageUrls.map(imageUrl => ({ src: imageUrl }));
      acc.push(...imagesWithSrc);
      return acc;
    }, []);

    res.json({ imageUrls });
  } catch (error) {
    console.error('Error fetching menu images:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const deleteAnImage = async (req, res) => {
  try {
    const { url, date } = req.body;
    console.log('this is url', url)

    if (!date) {
      return res.status(400).json({ message: 'Date parameter is required' });
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const mealForDeleteImage = await Meal.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      imageUrls: { $gte: 1 },
    });
    if (!mealForDeleteImage) {
      return res.status(404).json({ message: 'No meal found for the specified date' });
    }
    const updatedImageUrls = mealForDeleteImage?.[0]?.imageUrls?.filter(image => image !== url);
    if (updatedImageUrls?.length === mealForDeleteImage?.[0]?.imageUrls?.length) {
      return res.status(404).json({ message: 'Image URL not found in the meal data' });
    }

    const result = await Meal.updateOne(
      { _id: mealForDeleteImage[0]._id },
      { $set: { imageUrls: updatedImageUrls } }
    );

    // Check if the document was actually updated
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'No matching document found to update' });
    }

    if (result.modifiedCount === 0) {
      return res.status(406).json({ message: 'Document not modified' });
    }

    res.json({
      message: 'Image URL removed successfully',
      updatedImageUrls: updatedImageUrls
    });
  } catch (e) {
    console.error('Error deleting image URL:', e);
    res.status(500).json({ message: 'Internal Server Error', error: e.message });
  }
};

module.exports = {
  createMeal,
  getMeal,
  removeMealItem,
  updateOrCreateMealWithImages,
  customizeMealRequest,
  getCustomisedMealRequests,
  fetchMenuImages,
  deleteAnImage,
};
