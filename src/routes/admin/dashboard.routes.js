const express = require('express');
const router = express.Router();
const dashboardController = require('../../controllers/admin/dashboard.controller');

// This is the new, primary route for your main dashboard screen.
// Route: GET /api/admin/dashboard/overview
router.get('/overview', dashboardController.getPlatformOverviewStats);

// This route can be kept for the "Orders Management" screen's simpler stats.
// Route: GET /api/admin/dashboard/stats
router.get('/stats', dashboardController.getOrderDashboardStats);

module.exports = router;