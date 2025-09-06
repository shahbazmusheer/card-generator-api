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
router.get('/:orderId', orderController.getOrderById);


// --- NEW ROUTE for submitting a post-order modification ---
router.post('/:orderId/request-modification', orderController.createModificationRequest);

module.exports = router;