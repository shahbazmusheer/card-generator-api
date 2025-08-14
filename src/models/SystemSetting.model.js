// src/models/Setting.model.js
const mongoose = require('mongoose');

const SystemSettingSchema = new mongoose.Schema({
    key: {
        type: String,
        required: [true, 'Setting key is required.'],
        unique: true, // Each setting key must be unique for easy lookup
        trim: true,
        uppercase: true, // Standardize keys to uppercase, e.g., 'IMAGE_GENERATION_STRATEGY'
    },
    value: {
        type: mongoose.Schema.Types.Mixed, // Allows the value to be a string, boolean, number, etc.
        required: [true, 'Setting value is required.'],
    },
    description: { // Optional, but highly recommended for clarity in an admin panel
        type: String,
        trim: true,
    }
}, { timestamps: true });

module.exports = mongoose.model('SyetemSetting', SystemSettingSchema);