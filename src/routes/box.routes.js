const express = require('express');
const router = express.Router();
const boxController = require('../controllers/box.controller');
const { protect, optionalProtect } = require('../middleware/auth.middleware');

// Apply optional authentication to all box routes first
router.use(optionalProtect);

// Publicly accessible routes
router.get('/public/:boxId', boxController.getPublicBox);
router.post('/create-with-deck', boxController.generateNewDeckAndBox);

// Public-aware routes (work for guests or logged-in users)
router.post('/', boxController.createBox);
router.get('/', boxController.getUserBoxes);
router.get('/:boxId', boxController.getBoxById);
router.put('/:boxId', boxController.updateBox);
router.delete('/:boxId', boxController.deleteBox);
router.post('/:boxId/elements', boxController.addBoxElement);
router.put('/:boxId/elements/:elementId', boxController.updateBoxElement);
router.delete('/:boxId/elements/:elementId', boxController.deleteBoxElement);
router.put('/cards/:cardId/detach', boxController.detachCardFromTemplate);

// Protected routes (require a logged-in user)
router.post('/:boxId/claim', protect, boxController.claimBox);
router.get('/:boxId/export/json', protect, boxController.exportBoxAsJson);
router.put('/:boxId/toggle-public', protect, boxController.togglePublicStatus);
router.put('/cards/:cardId/promote', protect, boxController.promoteCardToTemplate);

module.exports = router;