const express = require('express');
const { register, login, profile, updatePassword } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/profile', protect, profile);
router.put('/updatepassword', protect, updatePassword);

module.exports = router;