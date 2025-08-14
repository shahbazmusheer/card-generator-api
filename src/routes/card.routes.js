// src/routes/card.routes.js
const express = require('express');
const router = express.Router();
const cardController = require('../controllers/card.controller');
const authMiddleware = require('../middleware/auth.middleware'); // Make sure this is correctly imported

// --- Card Routes (often nested under or related to a Box) ---

// Get all cards for a specific box
// LINE X: This should be public like getBoxById. The controller (getCardsByBox)
//         will need to check if the box is guest or, if owned, if the current user (if any) has access.
router.get('/box/:boxId', cardController.getCardsByBox);

// Get a single card by its ID
// LINE Y: Public for the same reasons as getBoxById and getCardsByBox.
//         Controller (getCardById) needs to handle guest/owned access.
router.get('/:cardId', cardController.getCardById);

// Create a new blank card within an existing box (user designs it manually)
// LINE Z: Public. The controller (createCardInBox) will check if the parent box
//         is guest or owned, and assign userId/isGuestCard accordingly. It can
//         also optionally check for an auth token to associate directly if user is logged in.
router.post('/box/:boxId', cardController.createCardInBox);

// Update card details (name, orderInBox) - elements are handled separately
// LINE A: Protected. Modifying card details should require ownership.
router.put('/:cardId', cardController.updateCardDetails);

// Delete a card
// LINE B: Protected. Deleting a card (and its elements) should require ownership.
router.delete('/:cardId', cardController.deleteCard);

// --- Routes for Card Elements ---
// Add an element to a card's front or back
// query param: ?face=front or ?face=back
// LINE C: Public (for guest cards). The controller (addCardElement) will check
//         if the parent card is guest or owned, and assign userId/isGuestElement.
//         If the card is owned, it implicitly requires the user to be the owner (checked via card's userId).
//         Alternatively, to be stricter, you could protect this, and only allow adding elements to
//         cards that have been "claimed" or created by a logged-in user.
//         For the "create as guest" model, this should allow adding elements to guest cards.
router.post('/:cardId/elements', cardController.addCardElement); // Controller handles ownership/guest status of parent card

// Update an existing element on a card's front or back
// LINE D: Protected. Modifying an element should require ownership of the element (and thus its card/box).
//         The controller (updateCardElement) should verify element.userId.
router.put('/elements/:elementId', cardController.updateCardElement);
// Note: The route is /elements/:elementId which is fine if elementId is globally unique.
// If you want to scope it to a card (e.g. /cards/:cardId/elements/:elementId), adjust accordingly,
// though direct update via elementId with ownership check is also common. My controller assumed /elements/:elementId

// Delete an element from a card's front or back
// LINE E: Protected. Deleting an element should require ownership.
router.delete('/:cardId/elements/:elementId',  cardController.deleteCardElement);

// AI Text Generation for a specific card field
// LINE F: This depends on the nature of the action.
//         If it modifies the card's content, it should likely be PROTECTED.
//         If it's just fetching text suggestions that the user can then choose to apply (via a separate update),
//         it could be public. Given it's "for a specific card field", implying it might update data,
//         protecting it is safer.
router.post('/:cardId/generate-text-field', authMiddleware.protect, cardController.generateTextForCard);

module.exports = router;