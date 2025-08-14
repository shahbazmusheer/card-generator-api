const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profile.controller');
const { protect } = require('../middleware/auth.middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- Multer Configuration for Avatar Uploads ---

// 1. Define the storage location and filename
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = 'public/images/avatars/';
        // Ensure the directory exists
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Create a unique filename: userId-timestamp.extension
        const uniqueSuffix = req.user.id + '-' + Date.now() + path.extname(file.originalname);
        cb(null, uniqueSuffix);
    }
});

// 2. Create a file filter to only accept images
const fileFilter = (req, file, cb) => {
    // Allowed extensions
    const filetypes = /jpeg|jpg|png|gif/;
    // Check extension
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    // Check mime type
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Error: Images Only!'), false);
    }
};

// 3. Initialize multer with the storage and filter
const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 1024 * 5 }, // 5MB file size limit
    fileFilter: fileFilter
});


// --- SECURE ALL PROFILE ROUTES ---
router.use(protect);

// --- Routes for managing profile DATA ---
router.route('/')
    .get(profileController.getMyProfile)
    .put(profileController.updateMyProfile)
    .delete(profileController.deleteMyAccount);

// --- NEW Route for uploading avatar IMAGE ---
// The middleware 'upload.single('avatar')' processes a single file upload
// from a form field named 'avatar'.
router.post('/avatar', upload.single('avatar'), profileController.uploadAvatar);

module.exports = router;