const pricingService = require('../services/pricing.service');
const orderService = require('../services/order.service');
const dhlService = require('../services/dhl.service');
const paymentService = require('../services/payment.service');
const Order = require('../models/Order.model');
const { successResponse, errorResponse } = require('../utils/responseHandler');

exports.getQuote = async (req, res) => {
    try {
        const { cardStock, deckQuantity, cardsPerDeck, shippingDetails } = req.body;
        if (!cardStock || !deckQuantity || !cardsPerDeck || !shippingDetails) {
            return errorResponse(res, "Missing required fields.", 400);
        }
        if (deckQuantity < 20) return errorResponse(res, "Minimum order quantity is 20 decks.", 400);
        if (cardsPerDeck < 30) return errorResponse(res, "Minimum number of cards per deck is 30.", 400);

        const { pricePerDeckForCards, pricePerDeckForBox } = await pricingService.calculatePrice(cardStock, deckQuantity, cardsPerDeck);

        const packageDetails = { weight: 1.5, length: 20, width: 15, height: 10 };
        const shippingOptions = await dhlService.getShippingRates(shippingDetails, packageDetails);
        if (shippingOptions.length === 0) {
            return errorResponse(res, "Could not find any shipping options for the provided address.", 404);
        }

        // Use the first option as the default for the summary
        const selectedShipping = shippingOptions[0];
        const cardsSubtotal = pricePerDeckForCards * deckQuantity;
        const boxesSubtotal = pricePerDeckForBox * deckQuantity;
        const shippingCost = selectedShipping.price;
        const currency = selectedShipping.currency || 'USD';
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
            // The full array of options, each with its own currency, is included here.
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
        const { items, shippingDetails, selectedShippingOption, paymentMethod } = req.body;
        if (!items || items.length === 0 || !shippingDetails || !selectedShippingOption || !paymentMethod) {
            return errorResponse(res, "Missing required fields.", 400);
        }

        const orderItem = items[0];
        const { cardStock, deckQuantity, cardsPerDeck } = orderItem;
        if (deckQuantity < 20) return errorResponse(res, "Minimum order quantity is 20 decks.", 400);
        if (cardsPerDeck < 30) return errorResponse(res, "Minimum number of cards per deck is 30.", 400);

        const { pricePerDeckForCards, pricePerDeckForBox } = await pricingService.calculatePrice(cardStock, deckQuantity, cardsPerDeck);
        const cardsSubtotal = pricePerDeckForCards * deckQuantity;
        const boxesSubtotal = pricePerDeckForBox * deckQuantity;
        const shippingCost = selectedShippingOption.price;
        const currency = selectedShippingOption.currency || 'USD'; // <-- GET CURRENCY
        const subtotal = cardsSubtotal + boxesSubtotal;
        const tax = (subtotal + shippingCost) * 0.10;
        const finalTotal = subtotal + shippingCost + tax;

        const orderId = await orderService.generateNextOrderId();
        const newOrder = new Order({
            orderId, userId, items, shippingDetails, selectedShippingOption, paymentMethod,
            // --- UPDATED: Save the currency with the costs ---
            costs: {
                cardsSubtotal,
                boxesSubtotal,
                shipping: shippingCost,
                tax,
                total: finalTotal,
                currency // <-- SAVE CURRENCY
            },
            statusHistory: [{ status: 'Pending Payment', date: new Date() }],
            orderStatus: 'Pending Payment'
        });
        const savedOrder = await newOrder.save();

        const paymentIntent = await paymentService.createPaymentIntent(savedOrder);

        successResponse(res, 'Order initiated. Please complete payment.', {
            order: savedOrder,
            stripeClientSecret: paymentIntent.client_secret
        }, 201);

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

exports.createModificationRequest = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;
        const { modifiedBoxData } = req.body;
        if (!modifiedBoxData || !modifiedBoxData.box || !modifiedBoxData.cardTemplate || !modifiedBoxData.cards) {
            return errorResponse(res, "A complete 'modifiedBoxData' object including box, cardTemplate, and cards is required.", 400);
        }
        const order = await Order.findOne({ _id: orderId, userId });
        if (!order) {
            return errorResponse(res, "Order not found or you are not authorized to modify it.", 404);
        }
        if (!['Pending Approval', 'Processing'].includes(order.orderStatus)) {
            return errorResponse(res, `Order cannot be modified as it is already '${order.orderStatus}'.`, 403);
        }
        const existingRequest = await ModificationRequest.findOne({ orderId, status: 'pending' });
        if (existingRequest) {
            return errorResponse(res, "There is already a pending modification request for this order. Please wait for an admin to review it.", 409);
        }
        await ModificationRequest.create({ orderId, userId, modifiedBoxData });
        order.orderStatus = 'Modification Pending';
        order.statusHistory.push({ status: 'Modification Pending', reason: 'User submitted changes for review' });
        await order.save();
        await createNotification(null, `Modification Request`, `User has requested changes for order ${order.orderId}.`, 'project', `/admin/moderation/requests`);
        successResponse(res, "Modification request submitted successfully. Please wait for admin approval.", null, 201);
    } catch (error) {
        errorResponse(res, "Failed to create modification request.", 500, "CREATE_MOD_REQUEST_FAILED", error.message);
    }
};