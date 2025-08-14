const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../../middleware/auth.middleware');

// Import the modular route files
const dashboardRoutes = require('./dashboard.routes');
const orderRoutes = require('./order.routes');
const userRoutes = require('./user.routes');

// --- SECURE ALL ADMIN ROUTES ---
// This middleware will be applied to every single route defined in the files below.
// It first checks for a valid login token (protect) and then checks if the user
// has the 'admin' role (authorize).
router.use(protect, authorize('admin'));

// --- Mount the modular routers ---
// Any request to /api/admin/dashboard/* will be handled by dashboardRoutes
router.use('/dashboard', dashboardRoutes);

// Any request to /api/admin/orders/* will be handled by orderRoutes
router.use('/orders', orderRoutes);
router.use('/users', userRoutes);

module.exports = router;