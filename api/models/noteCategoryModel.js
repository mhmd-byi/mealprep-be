const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const noteCategorySchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    color: { type: String, required: true },
    icon: { type: String, default: 'StickyNote' },
    sortOrder: { type: Number, default: 0 }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('NoteCategory', noteCategorySchema);
