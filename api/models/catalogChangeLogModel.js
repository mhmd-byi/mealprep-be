const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MODULES = ['plan', 'product', 'category', 'slots', 'carb-type'];
const ACTIONS = ['created', 'updated', 'deleted', 'activated', 'deactivated', 'setup'];
const KINDS = ['text', 'money', 'number', 'list', 'flag', 'range', 'images'];

const changeSchema = new Schema(
  {
    field: { type: String, required: true },
    label: { type: String, required: true },
    kind: { type: String, enum: KINDS, default: 'text' },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    percent: { type: Number, default: null }
  },
  { _id: false }
);

const catalogChangeLogSchema = new Schema(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'Users', required: true },
    adminName: { type: String, required: true },
    adminEmail: { type: String, default: '' },
    module: { type: String, enum: MODULES, required: true },
    action: { type: String, enum: ACTIONS, required: true },
    itemId: { type: Schema.Types.ObjectId, default: null },
    itemName: { type: String, default: '' },
    priceChanged: { type: Boolean, default: false },
    changes: { type: [changeSchema], default: [] },
    snapshot: { type: [new Schema({ label: String, kind: { type: String, enum: KINDS, default: 'text' }, value: Schema.Types.Mixed }, { _id: false })], default: [] }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

catalogChangeLogSchema.index({ createdAt: -1 });
catalogChangeLogSchema.index({ module: 1, createdAt: -1 });
catalogChangeLogSchema.index({ itemId: 1, createdAt: -1 });

module.exports = mongoose.model('CatalogChangeLog', catalogChangeLogSchema);
module.exports.MODULES = MODULES;
module.exports.ACTIONS = ACTIONS;
