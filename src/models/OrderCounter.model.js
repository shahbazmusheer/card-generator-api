const mongoose = require('mongoose');

// This is a simple utility model to ensure we can generate unique, sequential
// order numbers that are more user-friendly than MongoDB's default ObjectId.
const OrderCounterSchema = new mongoose.Schema({
    _id: { type: String, required: true }, // A fixed ID, e.g., 'order_counter'
    sequence_value: { type: Number, default: 0 } // The last used order number
});

module.exports = mongoose.model('OrderCounter', OrderCounterSchema);