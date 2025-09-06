const mongoose = require('mongoose');

// This schema stores a user's request to change an order that has already been placed.
const ModificationRequestSchema = new mongoose.Schema({
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // A complete snapshot of the MODIFIED box and its cards at the time of request.
    // We are using a generic Object type for flexibility.
    modifiedBoxData: {
        type: Object,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    adminReason: { // An optional reason from the admin for rejection
        type: String,
        trim: true
    }
}, { timestamps: true });

module.exports = mongoose.model('ModificationRequest', ModificationRequestSchema);