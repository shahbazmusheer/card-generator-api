const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
    _id: false,
    boxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Box', required: true },
    deckQuantity: { type: Number, required: true },
    cardsPerDeck: { type: Number, required: true },
    materialFinish: { type: String, required: true },
    cardStock: { type: String, required: true },
    boxType: { type: String, required: true },
});

const ShippingDetailsSchema = new mongoose.Schema({
    _id: false,
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
    address: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true },
    countryCode: { type: String, required: true }, // <-- NEW REQUIRED FIELD
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
    orderId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: [OrderItemSchema],
    shippingDetails: { type: ShippingDetailsSchema, required: true },
    costs: { type: CostSummarySchema, required: true },
    paymentMethod: { type: String, required: true },
    transactionId: { type: String, required: true, unique: true },
    orderStatus: {
        type: String,
        enum: ['Pending Approval', 'Rejected', 'Processing', 'Printing', 'Shipped', 'Delivered', 'Completed'],
        default: 'Pending Approval'
    },
    statusHistory: [StatusHistorySchema],
    dhlTrackingNumber: { type: String, default: '' },
    printablePdfUrl: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);