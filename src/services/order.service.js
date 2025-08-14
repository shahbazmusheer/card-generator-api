const OrderCounter = require('../models/OrderCounter.model');

/**
 * Generates a new, unique, user-friendly order ID.
 * Format: #ORD-YYYY-NNNNN
 * @returns {Promise<string>} The new order ID.
 */
async function generateNextOrderId() {
    // Find the counter document and increment its sequence value in one atomic operation.
    // The { new: true } option returns the document after the update.
    // The { upsert: true } option creates the document if it doesn't exist.
    const counter = await OrderCounter.findByIdAndUpdate(
        'order_counter', // The fixed ID for our single counter document
        { $inc: { sequence_value: 1 } },
        { new: true, upsert: true }
    );

    const year = new Date().getFullYear();
    // Pad the sequence number with leading zeros to ensure it's at least 5 digits.
    const sequence = counter.sequence_value.toString().padStart(5, '0');

    return `#ORD-${year}-${sequence}`;
}

module.exports = {
    generateNextOrderId
};