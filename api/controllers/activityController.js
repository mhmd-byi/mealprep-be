const User = require('../models/userModel');
const Activity = require('../models/activityModel');

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
  try {
    const { to, subject, text } = req.body;
    
    const options = {
      method: "POST",
      url: "https://send.api.mailtrap.io/api/send",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Api-Token": process.env.MAILTRAP_API_TOKEN,
      },
      data: {
        to: [to],
        from: { email: 'info@mealprep.co.in', name: 'Mealprep Info' },
        headers: {'X-Message-Source': 'app.mealprep.co.in'},
        subject: subject,
        text: text,
      }
    };

    const response = await axios.request(options);
    res.json(response.data);
  } catch (error) {
    console.error('Email sending failed:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
};

module.exports = {
  createActivity,
  getActivityFromUserId,
  sendEmailMailTrap,
}
