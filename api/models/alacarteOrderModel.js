const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const STATUSES = ['pending_payment', 'placed', 'confirmed', 'out_for_delivery', 'delivered', 'expired'];

const itemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    image: { type: String, default: '' },
    dietType: { type: String, default: '' },
    unitPrice: { type: Number, required: true },
    compareAtPrice: { type: Number, default: null },
    quantity: { type: Number, required: true, min: 1 },
    trackedStock: { type: Boolean, default: false }
  },
  { _id: false }
);

const historySchema = new Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' }
  },
  { _id: false }
);

const alacarteOrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'Users', required: true, index: true },
    customerName: { type: String, default: '' },
    mobile: { type: String, default: '' },
    address: { type: String, required: true, maxlength: 500 },
    note: { type: String, default: '', maxlength: 300 },
    items: { type: [itemSchema], required: true },
    subtotal: { type: Number, required: true },
    deliveryFee: { type: Number, default: 0 },
    total: { type: Number, required: true },
    deliveryDate: { type: Date, required: true },
    deliverySlot: { type: String, required: true },
    deliverySlotLabel: { type: String, default: '' },
    status: { type: String, enum: STATUSES, default: 'pending_payment' },
    razorpayOrderId: { type: String },
    paymentId: { type: String },
    paidAt: { type: Date },
    stockReserved: { type: Boolean, default: false },
    needsAttention: { type: Boolean, default: false },
    statusHistory: { type: [historySchema], default: [] }
  },
  { timestamps: true }
);

alacarteOrderSchema.index({ userId: 1, createdAt: -1 });
alacarteOrderSchema.index({ razorpayOrderId: 1 }, { unique: true, partialFilterExpression: { razorpayOrderId: { $type: 'string' } } });
alacarteOrderSchema.index({ deliveryDate: 1, status: 1 });
alacarteOrderSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('AlacarteOrder', alacarteOrderSchema);
module.exports.STATUSES = STATUSES;
