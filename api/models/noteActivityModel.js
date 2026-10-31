const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const NINETY_DAYS_IN_SECONDS = 90 * 24 * 60 * 60;

const noteActivitySchema = new Schema(
  {
    action: { type: String, enum: ['added', 'updated', 'completed', 'reopened', 'deleted'], required: true },
    noteTitle: { type: String, default: '' },
    byUserId: { type: Schema.Types.ObjectId, ref: 'Users' },
    byName: { type: String, default: '' }
  },
  {
    timestamps: true
  }
);

noteActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: NINETY_DAYS_IN_SECONDS });

module.exports = mongoose.model('NoteActivity', noteActivitySchema);
