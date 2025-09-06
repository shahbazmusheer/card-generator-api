const express = require('express');
const router = express.Router();
const cardController = require('../controllers/card.controller');
const { optionalProtect } = require('../middleware/auth.middleware'); // <-- Use optionalProtect

// --- Apply optional authentication to ALL card routes ---
// This middleware will check for a token and add 'req.user' if it exists,
// but it will NOT block the request if there is no token.
router.use(optionalProtect);

// Get a single card by its ID.
router.get('/:cardId', cardController.getCardById);

// Create a new blank card within an existing box.
router.post('/box/:boxId', cardController.createCardInBox);

// Update card details (e.g., name).
router.put('/:cardId', cardController.updateCardDetails);

// Delete a card and its unique elements.
router.delete('/:cardId', cardController.deleteCard);

// --- ELEMENT MANAGEMENT FOR CARDS ---

// Add a new element to a card.
router.post('/:cardId/elements', cardController.addCardElement);

// Update an existing element on a card.
router.put('/elements/:elementId', cardController.updateCardElement);

// Delete an element from a card.
router.delete('/:cardId/elements/:elementId', cardController.deleteCardElement);

module.exports = router;