// src/utils/tokenUtils.js
const jwt = require('jsonwebtoken');

// Generate JWT
exports.generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '30d' // e.g., '30d', '1h'
    });
};