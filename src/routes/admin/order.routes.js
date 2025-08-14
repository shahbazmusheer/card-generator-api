const express = require('express');
const router = express.Router();
const orderController = require('../../controllers/admin/order.controller');
const multer = require('multer');

// --- Multer Configuration for PDF Uploads (specific to order routes) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/prints/'),
    filename: (req, file, cb) => {
        const orderId = decodeURIComponent(req.params.orderId).replace(/[^a-z0-9]/gi, '_').toLowerCase();
        cb(null, `print_${orderId}_${Date.now()}.pdf`);
    }
});
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('Only PDF files are allowed!'), false);
        }
        cb(null, true);
    }
});

// --- Order Management Routes ---
// Base URL for these routes is /api/admin/orders

router.get('/', orderController.getAllOrders);
router.get('/:orderId', orderController.getOrderDetails);
router.put('/:orderId/status', orderController.updateOrderStatus);
router.post('/:orderId/upload-pdf', upload.single('pdfFile'), orderController.uploadOrderPdf);
router.post('/:orderId/generate-pdf', orderController.generateOrderPdf);

module.exports = router;