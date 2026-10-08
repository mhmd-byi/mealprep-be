const User = require('../models/userModel');
const Activity = require('../models/activityModel');
const axios = require('axios');
const { MailtrapClient } = require('mailtrap');
const confirmMobileOtp = require('../models/confirmMobileOtp');
const { getUserByMobileNumber } = require('./userController');
const { requireAdmin } = require('../utils/requireAdmin');
require('dotenv').config();

const createActivity = async (req, res) => {
  try {
    const { userId, date, description, category } = req.body;

    if (!userId || !date || !description) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(403).json({ message: 'User not found' });
    }

    const newActivity = new Activity({
      userId,
      date,
      description,
      // Old callers that don't send a category yet still work — the schema
      // default ('other') applies automatically.
      ...(category ? { category } : {})
    });
    const savedActivity = await newActivity.save();
    res.status(201).json(savedActivity);
  } catch (error) {
    console.error('Error creating activity:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const getActivityFromUserId = async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ message: 'User id not found' });
    }
    const activities = await Activity.find({ userId }).sort({ createdAt: -1 });
    if (!activities) {
      return res.status(400).json({ message: 'Activities not found' });
    }
    res.status(200).json(activities);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Recent activity across every customer, newest first — for the admin
// dashboard's "Customer's Recent Activity" widget. Capped by a lookback
// window (hours) and a hard limit so one noisy day can't return everything.
const getRecentActivities = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const hours = Number(req.query.hours) || 24;
    const limit = Math.min(500, Number(req.query.limit) || 200);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const activities = await Activity.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit);

    const userIds = [...new Set(activities.map((a) => String(a.userId)))];
    const users = await User.find({ _id: { $in: userIds } }, 'firstName lastName mobile');
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const enriched = activities.map((a) => {
      const user = userById.get(String(a.userId));
      return {
        _id: a._id,
        category: a.category || 'other',
        description: a.description,
        createdAt: a.createdAt,
        userId: a.userId,
        name: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
        mobile: user?.mobile || ''
      };
    });

    res.json({ activities: enriched, windowHours: hours });
  } catch (error) {
    console.error('Error fetching recent activities:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const sendEmailMailTrap = async (req, res) => {
  const { toEmail, toName, subject, text } = req.body;
  const client = new MailtrapClient({ token: process.env.MAILTRAP_API_TOKEN });
  const sender = {
    email: "hello@app.mealprep.co.in",
    name: "Mealprep",
  };
  client
    .send({
      from: sender,
      to: [{ email: toEmail, name: toName }],
      cc: [{ email: "ermoinzafarsheikh@hotmail.com", name: "Mealprep" }],
      subject: subject,
      text: text
    })
    .then(response => {
      res.json(response.data);
    })
    .catch(error => {
      console.error('Email sending failed:', error);
      res.status(500).json({ error: 'Failed to send email' });
    });
};

const sendMessageAiSensy = async (req, res) => {
  try {
    const { mobileNumber, name } = req.body;
    const generateOtp = Math.floor(100000 + Math.random() * 900000);
    const otp = generateOtp.toString();
    const saveOtp = new confirmMobileOtp({
      mobileNumber,
      otp
    });
    await saveOtp.save();

    let userName = name;
    if (!userName) {
      userName = await getUserByMobileNumber(mobileNumber);
    }

    if (!process.env.AISENSY_URL || !process.env.AISENSY_API_KEY) {
      console.error("Missing AISENSY configuration");
      return res.status(500).json({ message: 'Server configuration error' });
    }

    const response = await axios({
      method: 'POST',
      url: process.env.AISENSY_URL,
      data: {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'mobile_number_authentication',
        destination: mobileNumber,
        userName: userName || "User",
        templateParams: [
          otp
        ],
        buttons: [
          {
            type: "button",
            sub_type: "url",
            index: 0,
            parameters: [
              {
                type: "text",
                text: otp
              }
            ]
          }
        ],
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error('Message sending failed:', error);
    res.status(500).json({ message: 'Failed to send message', details: error.message });
  }
};

const verifyOtp = async (req, res) => {
  const { mobile, otp } = req.body;
  const verifyOtp = await confirmMobileOtp.findOne({ mobileNumber: mobile, otp: otp });
  // const checkOtpExpiry = await confirmMobileOtp.findOne({ mobileNumber: mobile, otp: otp, createdAt: { $lt: new Date(Date.now() - 1000 * 60 * 60 * 24) } });
  if (!verifyOtp) {
    return res.status(400).json({ message: 'Invalid OTP' });
  }
  res.status(200).json({ message: 'OTP verified successfully' });
}

module.exports = {
  createActivity,
  getActivityFromUserId,
  getRecentActivities,
  sendEmailMailTrap,
  sendMessageAiSensy,
  verifyOtp
};
