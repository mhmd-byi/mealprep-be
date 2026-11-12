const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const contactMessageSchema = new Schema(
  {
    firstName: { type: String, default: '', trim: true, maxlength: 60 },
    lastName: { type: String, default: '', trim: true, maxlength: 60 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    message: { type: String, default: '', trim: true, maxlength: 2000 },
    status: { type: String, enum: ['new', 'handled'], default: 'new' },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    handledAt: { type: Date, default: null },
    handledByName: { type: String, default: '' },
    source: { type: String, default: 'website' }
  },
  { timestamps: true }
);

contactMessageSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ContactMessage', contactMessageSchema);
