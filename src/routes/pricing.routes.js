const express = require('express');
const router = express.Router();
const pricingController = require('../controllers/pricing.controller');

router.get('/options', pricingController.getProductOptions);

module.exports = router;