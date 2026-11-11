const crypto = require('crypto');
const Note = require('../models/noteModel');
const { requireAdmin } = require('../utils/requireAdmin');
const { isConfigured, uploadImage, deleteImageByUrl, keyFromUrl } = require('../utils/s3Storage');
const { decodeImageBody } = require('../utils/imageUpload');

const FOLDERS = ['note', 'meal', 'menu', 'product'];

const uploadAdminImage = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (!isConfigured()) {
      return res.status(503).json({ message: 'Image upload is not set up yet.' });
    }
    const folder = FOLDERS.includes(req.body.folder) ? req.body.folder : 'note';
    const decoded = decodeImageBody(req.body);
    if (decoded.message) {
      return res.status(decoded.status).json({ message: decoded.message });
    }

    const url = await uploadImage({
      buffer: decoded.buffer,
      contentType: decoded.contentType,
      key: `${folder}-${crypto.randomUUID()}.${decoded.extension}`
    });
    res.status(201).json({ url, name: typeof req.body.name === 'string' ? req.body.name.slice(0, 120) : '' });
  } catch (error) {
    console.error('Error uploading admin image:', error);
    res.status(500).json({ message: 'Could not upload the image. Please try again.' });
  }
};

const deleteUnsavedNoteImage = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const url = typeof req.body.url === 'string' ? req.body.url : '';
    const key = keyFromUrl(url);
    if (!key || !key.startsWith('note-')) {
      return res.status(400).json({ message: 'That image cannot be deleted here.' });
    }
    if (await Note.exists({ 'attachments.url': url })) {
      return res.status(409).json({ message: 'That image is attached to a note.' });
    }

    await deleteImageByUrl(url);
    res.json({ message: 'Image deleted.' });
  } catch (error) {
    console.error('Error deleting admin image:', error);
    res.status(500).json({ message: 'Could not delete the image.' });
  }
};

module.exports = { uploadAdminImage, deleteUnsavedNoteImage };
