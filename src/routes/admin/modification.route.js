const express = require('express');
const router = express.Router();
const orderController = require('../../controllers/admin/modification.controller');
const multer = require('multer');
 
 

 


router.put('/:orderId/review-modification', orderController.reviewModification );
router.get('/modification-requests', orderController.getModificationOrders );

module.exports = router;