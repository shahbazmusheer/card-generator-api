const mongoose = require('mongoose');

const orderHistorySchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  originalData: {
    type: Object,
    required: true,
  },
  modifiedAt: {
    type: Date,
    default: Date.now,
  },
  modifiedBy: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
});

module.exports = mongoose.model('OrderHistory', orderHistorySchema);
