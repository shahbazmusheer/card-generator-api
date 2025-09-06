const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../../middleware/auth.middleware');
const dashboardRoutes = require('./dashboard.routes');
const orderRoutes = require('./order.routes');
const userRoutes = require('./user.routes');
const moderationRoutes = require('./moderation.routes');
const notificationRoutes = require('./notification.routes');

router.use(protect, authorize('admin'));

router.use('/dashboard', dashboardRoutes);
router.use('/orders', orderRoutes);
router.use('/users', userRoutes);
router.use('/moderation', moderationRoutes);
router.use('/notifications', notificationRoutes);

module.exports = router;