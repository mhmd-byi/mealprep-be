const { MailtrapClient } = require('mailtrap');
const { requireAuth } = require('../utils/requireAuth');

const FEEDBACK_RECIPIENT = process.env.FEEDBACK_EMAIL || 'ermoinzafarsheikh@hotmail.com';
const MAX_MESSAGE_LENGTH = 2000;

const sendFeedback = async (req, res) => {
  try {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ message: 'Please write your message.' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ message: `The message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
    }
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 20) : '';
    const name = `${caller.firstName || ''} ${caller.lastName || ''}`.trim();

    const client = new MailtrapClient({ token: process.env.MAILTRAP_API_TOKEN });
    await client.send({
      from: { email: 'hello@app.mealprep.co.in', name: 'Mealprep' },
      to: [{ email: FEEDBACK_RECIPIENT, name: 'Mealprep' }],
      subject: `Customer feedback from ${name}`,
      text:
        `Name: ${name}\n` +
        `Email: ${caller.email}\n` +
        `Account mobile: ${caller.mobile}\n` +
        `Contact phone: ${phone || 'not given'}\n\n` +
        message
    });

    res.json({ message: "Thank you for your message! We'll get in touch soon." });
  } catch (error) {
    console.error('Feedback email failed:', error);
    res.status(500).json({ message: 'Could not send your message. Please try again.' });
  }
};

module.exports = { sendFeedback };
