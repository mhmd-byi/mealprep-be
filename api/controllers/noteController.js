const mongoose = require('mongoose');
const Note = require('../models/noteModel');
const NoteCategory = require('../models/noteCategoryModel');
const NoteActivity = require('../models/noteActivityModel');
const User = require('../models/userModel');
const { requireAdmin } = require('../utils/requireAdmin');
const { getExcludedUserIds } = require('../utils/excludedAccounts');
const { nowIST } = require('../utils/dateUtils');

const PRIORITIES = ['high', 'medium', 'low'];
const MAX_ATTACHMENTS = 5;
const DEFAULT_PAGE_SIZE = 6;
const UPCOMING_LIMIT = 6;
const ACTIVITY_LIMIT = 8;
const CUSTOMER_SEARCH_LIMIT = 8;

const SORTS = {
  latest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  priority: { priorityRank: -1, createdAt: -1, _id: -1 }
};

const CUSTOMER_FIELDS = 'firstName lastName mobile';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const authorOf = (admin) => ({
  userId: admin._id,
  name: `${admin.firstName || ''} ${admin.lastName || ''}`.trim() || 'Admin'
});

const logNoteActivity = async (admin, action, noteTitle) => {
  try {
    await NoteActivity.create({ action, noteTitle, byUserId: admin._id, byName: authorOf(admin).name });
  } catch (error) {
    console.error('Error logging note activity:', error.message);
  }
};

const shapeNote = (note) => {
  const { customerId, ...rest } = note;
  const customer = customerId && customerId._id
    ? {
        _id: customerId._id,
        name: `${customerId.firstName || ''} ${customerId.lastName || ''}`.trim(),
        mobile: customerId.mobile || ''
      }
    : null;
  return { ...rest, customer };
};

const loadShapedNote = async (noteId) => {
  const note = await Note.findById(noteId).populate('customerId', CUSTOMER_FIELDS).lean();
  return note ? shapeNote(note) : null;
};

const periodBounds = (quick) => {
  const now = nowIST();
  if (quick === 'today') return { start: now.startOf('day').toJSDate(), end: now.endOf('day').toJSDate() };
  if (quick === 'week') return { start: now.startOf('week').toJSDate(), end: now.endOf('week').toJSDate() };
  if (quick === 'month') return { start: now.startOf('month').toJSDate(), end: now.endOf('month').toJSDate() };
  return null;
};

const periodClause = (quick) => {
  const bounds = periodBounds(quick);
  if (!bounds) return null;
  const range = { $gte: bounds.start, $lte: bounds.end };
  return { $or: [{ createdAt: range }, { dueAt: range }] };
};

const buildListFilter = ({ search, category, status, quick, pending }) => {
  const clauses = [];
  if (category) clauses.push({ category });
  if (status === 'open') clauses.push({ isDone: false });
  if (status === 'done') clauses.push({ isDone: true });
  if (pending) clauses.push({ isDone: false, dueAt: { $ne: null } });
  if (search) {
    const pattern = new RegExp(escapeRegex(search.slice(0, 100)), 'i');
    clauses.push({ $or: [{ title: pattern }, { body: pattern }] });
  }
  const period = periodClause(quick);
  if (period) clauses.push(period);
  return clauses.length ? { $and: clauses } : {};
};

const validateNoteInput = async (input = {}) => {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return { error: 'A title is required.' };
  if (title.length > 120) return { error: 'The title must be 120 characters or fewer.' };

  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body.length > 2000) return { error: 'The details must be 2000 characters or fewer.' };

  const priority = input.priority || 'medium';
  if (!PRIORITIES.includes(priority)) return { error: `priority must be one of: ${PRIORITIES.join(', ')}` };

  let category = '';
  if (input.category) {
    const found = await NoteCategory.findOne({ name: String(input.category).trim() })
      .collation({ locale: 'en', strength: 2 });
    if (!found) return { error: 'That category does not exist.' };
    category = found.name;
  }

  let dueAt = null;
  if (input.dueAt) {
    dueAt = new Date(input.dueAt);
    if (Number.isNaN(dueAt.getTime())) return { error: 'The due date is not valid.' };
  }

  let customerId = null;
  if (input.customerId) {
    if (!mongoose.Types.ObjectId.isValid(input.customerId)) return { error: 'Customer not found.' };
    const customer = await User.findOne({ _id: input.customerId, role: 'user' }, '_id');
    if (!customer) return { error: 'Customer not found.' };
    customerId = customer._id;
  }

  const attachmentInput = Array.isArray(input.attachments) ? input.attachments : [];
  if (attachmentInput.length > MAX_ATTACHMENTS) {
    return { error: `You can attach up to ${MAX_ATTACHMENTS} images.` };
  }
  const attachments = [];
  for (const item of attachmentInput) {
    if (!item || typeof item.url !== 'string' || !/^https:\/\//i.test(item.url)) {
      return { error: 'An attachment is not valid.' };
    }
    attachments.push({ url: item.url, name: typeof item.name === 'string' ? item.name.slice(0, 120) : '' });
  }

  return { value: { title, body, category, priority, dueAt, customerId, attachments } };
};

const listNotes = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
    const pending = req.query.pending === '1';
    const sort = pending ? { dueAt: 1, _id: 1 } : SORTS[req.query.sort] || SORTS.latest;
    const filter = buildListFilter({
      search: typeof req.query.search === 'string' ? req.query.search.trim() : '',
      category: typeof req.query.category === 'string' ? req.query.category : '',
      status: req.query.status,
      quick: req.query.quick,
      pending
    });

    const [notes, total] = await Promise.all([
      Note.find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('customerId', CUSTOMER_FIELDS)
        .lean(),
      Note.countDocuments(filter)
    ]);

    res.json({ notes: notes.map(shapeNote), total, page, limit });
  } catch (error) {
    console.error('Error listing notes:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const getNotesOverview = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const categoryMatch = periodClause(req.query.quick) || {};
    const todayMatch = periodClause('today');

    const [categoryCounts, todayCounts, upcoming, activity] = await Promise.all([
      Note.aggregate([{ $match: categoryMatch }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
      Note.aggregate([{ $match: todayMatch }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
      Note.find({ isDone: false, dueAt: { $ne: null } })
        .sort({ dueAt: 1, _id: 1 })
        .limit(UPCOMING_LIMIT)
        .select('title priority dueAt category')
        .lean(),
      NoteActivity.find().sort({ createdAt: -1 }).limit(ACTIVITY_LIMIT).lean()
    ]);

    const countsByCategory = {};
    let totalNotes = 0;
    categoryCounts.forEach((row) => {
      countsByCategory[row._id || ''] = row.count;
      totalNotes += row.count;
    });

    const todayByPriority = { high: 0, medium: 0, low: 0 };
    todayCounts.forEach((row) => {
      if (todayByPriority[row._id] !== undefined) todayByPriority[row._id] = row.count;
    });

    res.json({
      totalNotes,
      countsByCategory,
      today: {
        total: todayByPriority.high + todayByPriority.medium + todayByPriority.low,
        ...todayByPriority
      },
      upcoming,
      activity
    });
  } catch (error) {
    console.error('Error building notes overview:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const searchNoteCustomers = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search.length < 2) return res.json([]);

    const pattern = new RegExp(escapeRegex(search.slice(0, 60)), 'i');
    const excludedUserIds = await getExcludedUserIds();
    const customers = await User.find(
      {
        role: 'user',
        _id: { $nin: excludedUserIds },
        $or: [{ firstName: pattern }, { lastName: pattern }, { mobile: pattern }, { email: pattern }]
      },
      CUSTOMER_FIELDS
    )
      .sort({ firstName: 1 })
      .limit(CUSTOMER_SEARCH_LIMIT)
      .lean();

    res.json(
      customers.map((customer) => ({
        _id: customer._id,
        name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
        mobile: customer.mobile || ''
      }))
    );
  } catch (error) {
    console.error('Error searching customers for notes:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const createNote = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const checked = await validateNoteInput(req.body);
    if (checked.error) {
      return res.status(400).json({ message: checked.error });
    }

    const author = authorOf(admin);
    const note = await Note.create({ ...checked.value, createdBy: author, updatedBy: author });
    await logNoteActivity(admin, 'added', note.title);

    res.status(201).json(await loadShapedNote(note._id));
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const updateNote = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const note = await Note.findById(req.params.noteId);
    if (!note) {
      return res.status(404).json({ message: 'Note not found.' });
    }
    const checked = await validateNoteInput(req.body);
    if (checked.error) {
      return res.status(400).json({ message: checked.error });
    }

    Object.assign(note, checked.value, { updatedBy: authorOf(admin) });
    await note.save();
    await logNoteActivity(admin, 'updated', note.title);

    res.json(await loadShapedNote(note._id));
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const setNoteDone = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const note = await Note.findById(req.params.noteId);
    if (!note) {
      return res.status(404).json({ message: 'Note not found.' });
    }

    const isDone = Boolean(req.body.isDone);
    if (note.isDone !== isDone) {
      note.isDone = isDone;
      note.doneAt = isDone ? new Date() : null;
      note.updatedBy = authorOf(admin);
      await note.save();
      await logNoteActivity(admin, isDone ? 'completed' : 'reopened', note.title);
    }

    res.json(await loadShapedNote(note._id));
  } catch (error) {
    console.error('Error updating note status:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const deleteNote = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const note = await Note.findByIdAndDelete(req.params.noteId);
    if (!note) {
      return res.status(404).json({ message: 'Note not found.' });
    }
    await logNoteActivity(admin, 'deleted', note.title);

    res.json({ message: 'Note deleted successfully.', attachments: note.attachments || [] });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  listNotes,
  getNotesOverview,
  searchNoteCustomers,
  createNote,
  updateNote,
  setNoteDone,
  deleteNote
};
