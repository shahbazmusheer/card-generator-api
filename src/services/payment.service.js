const Stripe = require('stripe');

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
} else {
    console.warn("Stripe Secret Key is not configured.");
}

/**
 * Creates a Stripe Payment Intent for a new order.
 * @param {object} order - The newly created order object from the database.
 * @returns {Promise<object>} The Stripe Payment Intent object.
 */
async function createPaymentIntent(order) {
    if (!stripe) throw new Error("Payment service is not configured.");

    const amountInCents = Math.round(order.costs.total * 100);

    const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'usd', // Or your desired currency
        metadata: {
            order_id: order._id.toString() // Link the Stripe payment to our internal order ID
        }
    });

    return paymentIntent;
}

module.exports = {
    createPaymentIntent
};