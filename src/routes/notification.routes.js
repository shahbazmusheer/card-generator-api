const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { protect } = require('../middleware/auth.middleware');

// All notification routes are protected
router.use(protect);

router.get('/', notificationController.getMyNotifications);
router.get('/recent', notificationController.getRecentNotifications);
router.put('/read-all', notificationController.markAllAsRead);

module.exports = router;