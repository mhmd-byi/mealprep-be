const mongoose = require('mongoose');
const ContactMessage = require('../models/contactMessageModel');
const { requireAdmin } = require('../utils/requireAdmin');
const { createRateLimiter, clientIp } = require('../utils/rateLimiter');

const SUBMISSIONS_PER_HOUR = 5;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^[0-9()#&+*\-=.\s]+$/;

const limiter = createRateLimiter({ max: SUBMISSIONS_PER_HOUR, windowMs: 60 * 60 * 1000 });

const serverError = (res, label, error) => {
  console.error(`Error ${label}:`, error);
  res.status(500).json({ message: 'Internal Server Error', error: error.message });
};

const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');

const submitContactMessage = async (req, res) => {
  try {
    const body = req.body || {};

    if (typeof body.companyWebsite === 'string' && body.companyWebsite.trim() !== '') {
      return res.status(201).json({ message: 'Thank you. We will get back to you shortly.' });
    }

    if (!limiter.allow(clientIp(req))) {
      return res.status(429).json({ message: 'Too many messages from this connection. Please try again later.' });
    }

    const email = text(body.email, 120).toLowerCase();
    const phone = text(body.phone, 20);
    const message = text(body.message, 2000);
    const firstName = text(body.firstName, 60);
    const lastName = text(body.lastName, 60);

    if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ message: 'Please enter a valid email address.' });
    if (!PHONE_PATTERN.test(phone) || phone.replace(/\D/g, '').length < 6) {
      return res.status(400).json({ message: 'Please enter a valid phone number.' });
    }

    const duplicate = await ContactMessage.findOne({
      email,
      message,
      createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) }
    });
    if (!duplicate) {
      await ContactMessage.create({ firstName, lastName, email, phone, message });
    }

    res.status(201).json({ message: 'Thank you. We will get back to you shortly.' });
  } catch (error) {
    serverError(res, 'saving a contact message', error);
  }
};

const shapeMessage = (item) => ({
  _id: item._id,
  firstName: item.firstName,
  lastName: item.lastName,
  email: item.email,
  phone: item.phone,
  message: item.message,
  status: item.status,
  note: item.note || '',
  handledAt: item.handledAt || null,
  handledByName: item.handledByName || '',
  createdAt: item.createdAt
});

const adminName = (admin) => `${admin.firstName || ''} ${admin.lastName || ''}`.trim() || 'Admin';

const listContactMessages = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const filter = {};
    if (['new', 'handled'].includes(req.query.status)) filter.status = req.query.status;

    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 60) : '';
    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ firstName: pattern }, { lastName: pattern }, { email: pattern }, { phone: pattern }, { message: pattern }];
    }

    const [messages, total, newCount] = await Promise.all([
      ContactMessage.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ContactMessage.countDocuments(filter),
      ContactMessage.countDocuments({ status: 'new' })
    ]);

    res.json({ messages: messages.map(shapeMessage), total, page, limit, newCount });
  } catch (error) {
    serverError(res, 'listing contact messages', error);
  }
};

const getContactSummary = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.json({ newCount: await ContactMessage.countDocuments({ status: 'new' }) });
  } catch (error) {
    serverError(res, 'counting contact messages', error);
  }
};

const updateContactMessage = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.messageId)) return res.status(404).json({ message: 'Message not found.' });

    const update = {};
    if (req.body.status !== undefined) {
      if (!['new', 'handled'].includes(req.body.status)) return res.status(400).json({ message: 'Status must be new or handled.' });
      update.status = req.body.status;
      update.handledAt = req.body.status === 'handled' ? new Date() : null;
      update.handledByName = req.body.status === 'handled' ? adminName(admin) : '';
    }
    if (req.body.note !== undefined) update.note = text(req.body.note, 500);

    const message = await ContactMessage.findByIdAndUpdate(req.params.messageId, { $set: update }, { new: true }).lean();
    if (!message) return res.status(404).json({ message: 'Message not found.' });
    res.json(shapeMessage(message));
  } catch (error) {
    serverError(res, 'updating a contact message', error);
  }
};

const deleteContactMessage = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.messageId)) return res.status(404).json({ message: 'Message not found.' });

    const removed = await ContactMessage.findByIdAndDelete(req.params.messageId);
    if (!removed) return res.status(404).json({ message: 'Message not found.' });
    res.json({ message: 'Message deleted.' });
  } catch (error) {
    serverError(res, 'deleting a contact message', error);
  }
};

module.exports = { submitContactMessage, listContactMessages, getContactSummary, updateContactMessage, deleteContactMessage };
