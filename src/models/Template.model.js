// src/models/Template.model.js
const mongoose = require('mongoose');

const TemplateSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Template name is required.'],
        unique: true,
        trim: true
    },
    description: {
        type: String,
        trim: true,
        default: ''
    },
    // This is the prompt string that the frontend will merge
    themePrompt: {
        type: String,
        required: [true, 'A theme prompt is required for the template.']
    },
    // The image will be stored as a Base64 Data URI string
    image: {
        type: String,
        required: [true, 'A preview image is required for the template.']
    },
    uses_count: {
        type: Number,
        default: 0
    },

    // --- NEW FIELDS FOR PAID TEMPLATES ---
    paidType: {
        type: String,
        enum: ['free', 'premium'],
        default: 'free'
    },
    // price: {
    //     type: Number,
    //     // Price is only required if the template is 'premium'
    //     required: function() {
    //         return this.paidType === 'premium';
    //     },
    //     // Price must be a positive number if it exists
    //     min: [0, 'Price cannot be negative.']
    // }
    price: {
        type: Number,
        default: 0, // Default price is now 0
        min: [0, 'Price cannot be negative.']
    }
    // --- END OF NEW FIELDS ---

}, { timestamps: true });

// --- NEW: Add a pre-save hook for data consistency ---
// This middleware will run before any 'save' operation (like .create() or .save())
TemplateSchema.pre('save', function(next) {
    // If the template is 'free', ensure its price is 0.
    // This handles cases where a user might accidentally send a price with a free template.
    if (this.paidType === 'free') {
        this.price = 0;
    }
    next();
});

module.exports = mongoose.models.Template || mongoose.model('Template', TemplateSchema);