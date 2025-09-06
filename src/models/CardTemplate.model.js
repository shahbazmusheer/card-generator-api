const mongoose = require('mongoose');

// This model stores the shared visual design for all cards in a single box.
const CardTemplateSchema = new mongoose.Schema({
    boxId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Box',
        required: true,
        unique: true, // Each box can only have one template
        index: true
    },
    // The shared elements for the front of every card (background, decorations, etc.)
    frontElements: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Element'
    }],
    // The shared elements for the back of every card (usually just one image)
    backElements: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Element'
    }]
}, { timestamps: true });

module.exports = mongoose.model('CardTemplate', CardTemplateSchema);