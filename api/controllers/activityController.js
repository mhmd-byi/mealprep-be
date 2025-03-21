const User = require('../models/userModel');
const Activity = require('../models/activityModel');
const { default: axios } = require('axios');
const { MailtrapClient } = require('mailtrap');
const confirmMobileOtp = require('../models/confirmMobileOtp');
require('dotenv').config();

const createActivity = async (req, res) => {
  try {
    const { userId, date, description } = req.body;

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
      description
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
    const activities = await Activity.find({ userId });
    if (!activities) {
      return res.status(400).json({ message: 'Activities not found' });
    }
    res.status(200).json(activities);
  } catch (error) {
    console.error('Error fetching activities:', error);
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
  const { mobileNumber, name } = req.body;
  const generateOtp = Math.floor(100000 + Math.random() * 900000);
  const otp = generateOtp.toString();
  const saveOtp = new confirmMobileOtp({
    mobileNumber,
    otp
  })
  await saveOtp.save();
  const sendMessage = await axios({
    method: 'POST',
    url: process.env.AISENSY_URL,
    data: {
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'mobile_number_authentication',
      destination: mobileNumber,
      userName: name,
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
  })
  .then(response => {
    res.json(response.data);
  })
  .catch(error => {
    console.error('Message sending failed:', error);
    res.status(500).json({ error: 'Failed to send message' });
  });
  return sendMessage;
}

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
  sendEmailMailTrap,
  sendMessageAiSensy,
  verifyOtp
};
