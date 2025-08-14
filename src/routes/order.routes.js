const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { protect } = require('../middleware/auth.middleware');

// --- PUBLIC ROUTE ---
// Get a dynamic price quote for an order.
router.post('/quote', orderController.getQuote);


// --- PRIVATE (USER-ONLY) ROUTES ---
// All routes below require the user to be authenticated.
router.use(protect);

// Create a new order.
router.post('/', orderController.createOrder);

// Get a list of all orders for the authenticated user.
router.get('/', orderController.getUserOrders);

// Get the details of a single, specific order belonging to the user.
// The custom orderId (e.g., #ORD-2025-001) should be URL-encoded by the frontend.
router.get('/:orderId', orderController.getOrderById);

module.exports = router;