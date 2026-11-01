const crypto = require('crypto');
const User = require('../models/userModel');
const Activity = require('../models/activityModel');
const { requireAuth } = require('../utils/requireAuth');
const { isConfigured, uploadImage, deleteImageByUrl } = require('../utils/s3Storage');

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const hasImageSignature = (buffer, contentType) => {
  if (contentType === 'image/jpeg') {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return buffer.length > 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
  }
  return (
    buffer.length > 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
};

const uploadProfilePhoto = async (req, res) => {
  try {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    if (caller._id.toString() !== req.params.userId) {
      return res.status(403).json({ message: 'You can only change your own profile photo.' });
    }
    if (!isConfigured()) {
      return res.status(503).json({ message: 'Photo upload is not set up yet. Please try again later.' });
    }

    const { image, contentType } = req.body;
    const extension = EXTENSIONS[contentType];
    if (!extension || typeof image !== 'string') {
      return res.status(400).json({ message: 'Please choose a JPEG, PNG or WebP image.' });
    }

    const buffer = Buffer.from(image, 'base64');
    if (!hasImageSignature(buffer, contentType)) {
      return res.status(400).json({ message: 'That file is not a valid image.' });
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ message: 'The image is too large. Please choose a smaller one.' });
    }

    const previousUrl = caller.profileImageUrl;
    const profileImageUrl = await uploadImage({
      buffer,
      contentType,
      key: `profile-${caller._id}-${crypto.randomUUID()}.${extension}`
    });

    try {
      await User.updateOne({ _id: caller._id }, { profileImageUrl });
    } catch (error) {
      await deleteImageByUrl(profileImageUrl);
      throw error;
    }

    deleteImageByUrl(previousUrl);
    Activity.create({
      userId: caller._id,
      date: new Date(),
      description: 'Updated profile photo',
      category: 'profile'
    }).catch((error) => console.error('Profile photo activity log failed:', error.message));

    res.json({ profileImageUrl });
  } catch (error) {
    console.error('Profile photo upload failed:', error);
    res.status(500).json({ message: 'Could not update your profile photo. Please try again.' });
  }
};

module.exports = { uploadProfilePhoto };
