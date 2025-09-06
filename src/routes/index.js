const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const profileRoutes = require('./profile.routes');
const boxRoutes = require('./box.routes');
const cardRoutes = require('./card.routes');
const rulesRoutes = require('./rules.routes');
const templateRoutes = require('./template.routes');
const orderRoutes = require('./order.routes');
const pricingRoutes = require('./pricing.routes');
const adminRoutes = require('./admin');
const notificationRoutes = require('./notification.routes');

router.use('/auth', authRoutes);
router.use('/auth/profile', profileRoutes);
router.use('/boxes', boxRoutes);
router.use('/cards', cardRoutes);
router.use('/rules', rulesRoutes);
router.use('/templates', templateRoutes);
router.use('/orders', orderRoutes);
router.use('/pricing', pricingRoutes); // <-- ADD THE NEW ROUTER
router.use('/admin', adminRoutes);
router.use('/notifications', notificationRoutes);

router.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'API is healthy' });
});

module.exports = router;