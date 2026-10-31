const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

const attachmentSchema = new Schema(
  {
    url: { type: String, required: true },
    name: { type: String, default: '' }
  },
  { _id: false }
);

const authorSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'Users' },
    name: { type: String, default: '' }
  },
  { _id: false }
);

const noteSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, default: '', trim: true, maxlength: 2000 },
    category: { type: String, default: '', trim: true },
    priority: { type: String, enum: Object.keys(PRIORITY_RANK), default: 'medium' },
    priorityRank: { type: Number, default: PRIORITY_RANK.medium },
    dueAt: { type: Date, default: null },
    isDone: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
    customerId: { type: Schema.Types.ObjectId, ref: 'Users', default: null },
    attachments: { type: [attachmentSchema], default: [] },
    createdBy: authorSchema,
    updatedBy: authorSchema
  },
  {
    timestamps: true
  }
);

noteSchema.pre('save', function (next) {
  this.priorityRank = PRIORITY_RANK[this.priority];
  next();
});

noteSchema.index({ createdAt: -1 });
noteSchema.index({ category: 1 });
noteSchema.index({ dueAt: 1 });

module.exports = mongoose.model('Note', noteSchema);
