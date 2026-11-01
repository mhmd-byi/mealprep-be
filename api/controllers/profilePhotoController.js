const crypto = require('crypto');
const User = require('../models/userModel');
const Activity = require('../models/activityModel');
const { requireAuth } = require('../utils/requireAuth');
const { isConfigured, uploadImage, deleteImageByUrl } = require('../utils/s3Storage');
const { decodeImageBody } = require('../utils/imageUpload');

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

    const decoded = decodeImageBody(req.body);
    if (decoded.message) {
      return res.status(decoded.status).json({ message: decoded.message });
    }

    const previousUrl = caller.profileImageUrl;
    const profileImageUrl = await uploadImage({
      buffer: decoded.buffer,
      contentType: decoded.contentType,
      key: `profile-${caller._id}-${crypto.randomUUID()}.${decoded.extension}`
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
