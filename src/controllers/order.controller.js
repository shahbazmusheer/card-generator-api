const pricingService = require('../services/pricing.service');
const orderService = require('../services/order.service');
const dhlService = require('../services/dhl.service');
const paymentService = require('../services/payment.service');
const Order = require('../models/Order.model');
const { successResponse, errorResponse } = require('../utils/responseHandler');

exports.getQuote = async (req, res) => {
    try {
        const { cardType, deckQuantity, cardsPerDeck, shippingDetails } = req.body;
        if (!cardType || !deckQuantity || !cardsPerDeck || !shippingDetails) {
            return errorResponse(res, "Missing required fields: cardType, deckQuantity, cardsPerDeck, and shippingDetails.", 400);
        }
        if (!shippingDetails.countryCode || !shippingDetails.zipCode || !shippingDetails.city) {
            return errorResponse(res, "Shipping details must include countryCode, zipCode, and city.", 400);
        }
        const { pricePerDeckForCards, pricePerDeckForBox } = await pricingService.calculatePrice(cardType, deckQuantity, cardsPerDeck);
        const packageDetails = { weight: 1.5, length: 20, width: 15, height: 10 };
        const shippingOptions = await dhlService.getShippingRates(shippingDetails, packageDetails);
        if (shippingOptions.length === 0) {
            return errorResponse(res, "Could not find any shipping options for the provided address.", 404);
        }
        const selectedShipping = shippingOptions[0];
        const cardsSubtotal = pricePerDeckForCards * deckQuantity;
        const boxesSubtotal = pricePerDeckForBox * deckQuantity;
        const shippingCost = selectedShipping.price;
        const taxRate = 0.10;
        const subtotal = cardsSubtotal + boxesSubtotal;
        const taxAmount = (subtotal + shippingCost) * taxRate;
        const totalCost = subtotal + shippingCost + taxAmount;
        const quote = {
            summary: {
                cards: { label: `Cards ($${pricePerDeckForCards.toFixed(2)} Per Deck)`, value: parseFloat(cardsSubtotal.toFixed(2)) },
                boxes: { label: `Boxes ($${pricePerDeckForBox.toFixed(2)} Per Box)`, value: parseFloat(boxesSubtotal.toFixed(2)) },
                shipping: { label: selectedShipping.serviceName, value: parseFloat(shippingCost.toFixed(2)) },
                tax: { label: 'Tax', value: parseFloat(taxAmount.toFixed(2)) },
                total: { label: 'Total', value: parseFloat(totalCost.toFixed(2)) }
            },
            shippingOptions
        };
        successResponse(res, 'Quote calculated successfully', quote);
    } catch (error) {
        console.error("Error in getQuote Controller:", error.message);
        errorResponse(res, error.message, 400);
    }
};

exports.createOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const { items, shippingDetails, paymentMethod, transactionId } = req.body;

        if (!items || items.length === 0 || !shippingDetails || !paymentMethod || !transactionId) {
            return errorResponse(res, "Missing required fields.", 400);
        }
        // This validation is now very important
        if (!shippingDetails.countryCode) {
            return errorResponse(res, "The shippingDetails object must include a 'countryCode'.", 400);
        }

        const orderItem = items[0];
        const { pricePerDeckForCards, pricePerDeckForBox } = await pricingService.calculatePrice(orderItem.cardStock, orderItem.deckQuantity, orderItem.cardsPerDeck);
        const shipping = 35.00; // Final shipping cost
        const cardsSubtotal = pricePerDeckForCards * orderItem.deckQuantity;
        const boxesSubtotal = pricePerDeckForBox * orderItem.deckQuantity;
        const tax = (cardsSubtotal + boxesSubtotal + shipping) * 0.10;
        const serverCalculatedTotal = cardsSubtotal + boxesSubtotal + shipping + tax;

        let isPaymentValid = false;
        if (paymentMethod.toLowerCase() === 'stripe') {
            isPaymentValid = await paymentService.verifyStripePayment(transactionId, serverCalculatedTotal);
        } else if (paymentMethod.toLowerCase() === 'paypal') {
            isPaymentValid = await paymentService.verifyPayPalPayment(transactionId, serverCalculatedTotal);
        } else {
            return errorResponse(res, `Payment method "${paymentMethod}" is not supported.`, 400);
        }

        if (!isPaymentValid) {
            return errorResponse(res, "Payment verification failed.", 402);
        }

        const orderId = await orderService.generateNextOrderId();

        // The full shippingDetails object, including countryCode, is now saved.
        const newOrder = new Order({
            orderId,
            userId,
            items,
            shippingDetails, // <-- This now correctly includes the countryCode
            paymentMethod,
            transactionId,
            costs: { cardsSubtotal, boxesSubtotal, shipping, tax, total: serverCalculatedTotal },
            statusHistory: [{ status: 'Pending Approval', date: new Date() }],
            orderStatus: 'Pending Approval'
        });

        const savedOrder = await newOrder.save();
        successResponse(res, 'Order placed and verified successfully!', savedOrder, 201);

    } catch (error) {
        console.error("Error creating order:", error);
        errorResponse(res, "Failed to create order.", 500, "ORDER_CREATION_FAILED", error.message);
    }
};

exports.getUserOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const orders = await Order.find({ userId }).sort({ createdAt: -1 }).lean();
        successResponse(res, "User's orders retrieved successfully.", orders);
    } catch (error) {
        errorResponse(res, "Failed to retrieve orders.", 500, "FETCH_ORDERS_FAILED", error.message);
    }
};

exports.getOrderById = async (req, res) => {
    try {
        const userId = req.user.id;
        const orderId = decodeURIComponent(req.params.orderId);
        const order = await Order.findOne({ orderId, userId }).lean();
        if (!order) {
            return errorResponse(res, "Order not found or not authorized.", 404);
        }
        successResponse(res, "Order details retrieved successfully.", order);
    } catch (error) {
        errorResponse(res, "Failed to retrieve order details.", 500, "FETCH_ORDER_FAILED", error.message);
    }
};

