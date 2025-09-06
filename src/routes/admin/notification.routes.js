const express = require('express');
const router = express.Router();
const notificationController = require('../../controllers/admin/notification.controller');

// Note: The main admin router hub ('/routes/admin/index.js') already applies the
// 'protect' and 'authorize('admin')' middleware, so we don't need to add it here again.

// Route for an admin to send a platform-wide announcement to all users.
router.post('/broadcast', notificationController.broadcastNotification);

module.exports = router;