const Stripe = require('stripe');
const paypal = require('@paypal/checkout-server-sdk');

// --- CLIENT INITIALIZATIONS (No change here) ---
let stripe;
if (process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
} else if (process.env.ENABLE_STRIPE_VERIFICATION === 'true') {
    console.error("Stripe verification is enabled, but STRIPE_SECRET_KEY is not set.");
}

let paypalClient;
if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
    const environment = process.env.PAYPAL_MODE === 'live'
        ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
        : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
    paypalClient = new paypal.core.PayPalHttpClient(environment);
} else if (process.env.ENABLE_PAYPAL_VERIFICATION === 'true') {
     console.error("PayPal verification is enabled, but PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is not set.");
}


/**
 * Verifies a Stripe Payment Intent ID. Can be disabled via environment variable.
 * @param {string} paymentIntentId The ID from the front-end (e.g., "pi_...").
 * @param {number} expectedAmount The server-calculated total amount in dollars.
 * @returns {Promise<boolean>} True if the payment is valid or if verification is disabled.
 */
async function verifyStripePayment(paymentIntentId, expectedAmount) {
    // --- NEW CONFIGURATION CHECK ---
    // Check if the verification is disabled in the .env file.
    if (process.env.ENABLE_STRIPE_VERIFICATION !== 'true') {
        console.warn("Stripe verification is disabled. Skipping API call and assuming payment is valid.");
        return true; // Bypass verification
    }

    if (!stripe) {
        throw new Error("Stripe verification is enabled, but the service could not be configured (missing key).");
    }

    // Original verification logic remains unchanged.
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const expectedAmountInCents = Math.round(expectedAmount * 100);

    if (paymentIntent.status === 'succeeded' && paymentIntent.amount === expectedAmountInCents) {
        return true;
    }
    
    console.warn(`Stripe verification FAILED for ID: ${paymentIntentId}.`);
    return false;
}

/**
 * Verifies a PayPal Order ID. Can be disabled via environment variable.
 * @param {string} paypalOrderID The Order ID from the front-end.
 * @param {number} expectedAmount The server-calculated total amount in dollars.
 * @returns {Promise<boolean>} True if the payment is valid or if verification is disabled.
 */
async function verifyPayPalPayment(paypalOrderID, expectedAmount) {
    // --- NEW CONFIGURATION CHECK ---
    if (process.env.ENABLE_PAYPAL_VERIFICATION !== 'true') {
        console.warn("PayPal verification is disabled. Skipping API call and assuming payment is valid.");
        return true; // Bypass verification
    }

    if (!paypalClient) {
        throw new Error("PayPal verification is enabled, but the service could not be configured (missing keys).");
    }

    // Original verification logic remains unchanged.
    const request = new paypal.orders.OrdersGetRequest(paypalOrderID);
    const order = await paypalClient.execute(request);
    const purchaseUnit = order.result.purchase_units[0];
    const paidAmount = parseFloat(purchaseUnit.amount.value);
    const isAmountMatch = Math.abs(paidAmount - expectedAmount) < 0.01;

    if (order.result.status === 'COMPLETED' && isAmountMatch) {
        return true;
    }

    console.warn(`PayPal verification FAILED for ID: ${paypalOrderID}.`);
    return false;
}

module.exports = {
    verifyStripePayment,
    verifyPayPalPayment
};