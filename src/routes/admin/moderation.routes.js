const express = require('express');
const router = express.Router();
// --- THIS IS THE FIX ---
// The path needs to go up one level from 'routes/admin' to 'src', then into 'controllers/admin'
const moderationController = require('../../controllers/admin/moderation.controller');

// Proactive content moderation for new boxes
router.get('/boxes', moderationController.getPendingBoxes);
router.put('/boxes/:boxId', moderationController.updateBoxModerationStatus);

// Post-order modification requests
router.get('/requests', moderationController.getModificationRequests);
router.put('/requests/:requestId', moderationController.processModificationRequest);

module.exports = router;