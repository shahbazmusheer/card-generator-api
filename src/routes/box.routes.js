const express = require('express');
const router = express.Router();
const boxController = require('../controllers/box.controller');
const { protect } = require('../middleware/auth.middleware'); // Use the correct import name

// --- NEW PUBLIC ROUTE for viewing a shared box ---
// This route MUST be defined before the other /:boxId routes to be matched correctly.
// It has no 'protect' middleware, so anyone can call it.
router.get('/view-box/:boxId', boxController.getPublicBox);

// --- Box Creation (unchanged) ---
router.post('/create-with-deck', boxController.generateNewDeckAndBox);
router.post('/', boxController.createBox);

// --- Claiming a Box (unchanged, protected) ---
router.post('/:boxId/claim', protect, boxController.claimBox);

// --- Reading User's Boxes (unchanged, protected) ---
router.get('/', protect, boxController.getUserBoxes);
router.get('/:boxId/export/json', protect, boxController.exportBoxAsJson);

// --- NEW PROTECTED ROUTE for toggling the public status ---
// Only the authenticated owner can access this.
router.put('/:boxId/toggle-public', protect, boxController.togglePublicStatus);

// --- Modifying/Deleting Box (unchanged, protected) ---
router.put('/:boxId', protect, boxController.updateBox);
router.delete('/:boxId', protect, boxController.deleteBox);
router.post('/:boxId/elements', protect, boxController.addBoxElement);
router.put('/:boxId/elements/:elementId', protect, boxController.updateBoxElement);
router.delete('/:boxId/elements/:elementId', protect, boxController.deleteBoxElement);

// --- Reading a specific box (unchanged) ---
// This is the route for when an owner views their own box. It can stay last.
router.get('/:boxId', boxController.getBoxById);

module.exports = router;