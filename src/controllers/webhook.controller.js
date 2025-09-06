const Order = require('../models/Order.model');
const Stripe = require('stripe');
// --- THIS IS THE FIX ---
// The path is corrected to go up one level to 'src', then down into 'services'.
const { createNotification } = require('../services/notification.service');

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
}

exports.handleStripeWebhook = async (req, res) => {
    const signature = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata.order_id;
        console.log(`Webhook received: PaymentIntent succeeded for Order ID: ${orderId}`);

        try {
            const order = await Order.findById(orderId);
            if (order && order.orderStatus === 'Pending Payment') {
                order.orderStatus = 'Pending Approval';
                order.transactionId = paymentIntent.id;
                order.statusHistory.push({ status: 'Pending Approval', date: new Date() });
                await order.save();
                console.log(`Order ${order.orderId} successfully paid and updated.`);

                // --- Trigger notifications ---
                const title = "Order Confirmation";
                const message = `Your payment for order ${order.orderId} has been successful! We are now preparing your items.`;
                const link = `/orders/${order.orderId}`;
                // Notify the user
                await createNotification(order.userId, title, message, 'order', link);
                // Notify all admins
                await createNotification(null, `New Order Received`, `A new order (${order.orderId}) has been placed and requires approval.`, 'order', `/admin/orders/${order.orderId}`);
            }
        } catch (err) {
            console.error(`Error updating order for payment intent ${paymentIntent.id}:`, err);
        }
    }

    // --- NEW: HANDLE PAYMENT FAILURE ---
    if (event.type === 'payment_intent.payment_failed') {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata.order_id;
        console.log(`Webhook received: PaymentIntent failed for Order ID: ${orderId}`);

        try {
            // Find the order and update its status to 'Rejected' or a similar failure state.
            const order = await Order.findById(orderId);
            if (order && order.orderStatus === 'Pending Payment') {
                order.orderStatus = 'Rejected'; // Or a new status like 'Payment Failed'
                order.statusHistory.push({
                    status: 'Rejected',
                    date: new Date(),
                    // Store the failure reason from Stripe for debugging
                    reason: paymentIntent.last_payment_error?.message || 'Unknown payment error'
                });
                await order.save();
                console.log(`Order ${order.orderId} marked as rejected due to payment failure.`);
            }
        } catch (err) {
            console.error(`Error updating order for failed payment intent ${paymentIntent.id}:`, err);
        }
    }

    res.status(200).json({ received: true });
};