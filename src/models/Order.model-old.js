const mongoose = require('mongoose');

// This schema is designed to capture every piece of information shown in your UI mockups
// for both the user and the admin.

const OrderItemSchema = new mongoose.Schema({
    _id: false, // No need for sub-document IDs
    boxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Box', required: true },
    deckQuantity: { type: Number, required: true },
    cardsPerDeck: { type: Number, required: true },
    materialFinish: { type: String, required: true }, // e.g., "Gloss Finish"
    cardStock: { type: String, required: true },      // e.g., "Casino Linen"
    boxType: { type: String, required: true },        // e.g., "350gsm Tuck Box"
});

const ShippingDetailsSchema = new mongoose.Schema({
    _id: false,
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
    address: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true },
    zipCode: { type: String, required: true }
});

const CostSummarySchema = new mongoose.Schema({
    _id: false,
    cardsSubtotal: { type: Number, required: true },
    boxesSubtotal: { type: Number, required: true },
    shipping: { type: Number, required: true },
    tax: { type: Number, required: true },
    total: { type: Number, required: true }
});

const StatusHistorySchema = new mongoose.Schema({
    _id: false,
    status: { type: String, required: true },
    date: { type: Date, default: Date.now }
});

const OrderSchema = new mongoose.Schema({
    orderId: { // The user-friendly, custom ID like #ORD-2025-001
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    items: [OrderItemSchema],
    shippingDetails: { type: ShippingDetailsSchema, required: true },
    costs: { type: CostSummarySchema, required: true },
    paymentId: { // To store the transaction ID from Stripe, PayPal, etc.
        type: String,
        required: true
    },
    orderStatus: {
        type: String,
        enum: ['Pending Approval', 'Rejected', 'Processing', 'Printing', 'Shipped', 'Delivered', 'Completed'],
        default: 'Pending Approval'
    },
    statusHistory: [StatusHistorySchema],
    dhlTrackingNumber: {
        type: String,
        default: ''
    },
    printablePdfUrl: { // Stores the path/URL to the final PDF for printing
        type: String,  // This can be set by the admin uploading a file or by the backend generation service.
        default: ''
    }
}, { timestamps: true }); // `createdAt` will serve as the initial order date

module.exports = mongoose.model('Order', OrderSchema);