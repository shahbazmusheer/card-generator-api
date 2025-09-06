const mongoose = require('mongoose');

const TemplateSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true, default: '' },
    image: { type: String, required: true }, // The preview image for the template card
    uses_count: { type: Number, default: 0 },

    // --- NEW: Fields to pre-fill the generation form ---
    defaultBoxName: { type: String, default: 'My New Game' },
    defaultPrompt: { type: String, required: true },
    defaultGenre: { type: String, default: 'Fantasy' },
    defaultColorTheme: { type: String, default: '#5D4037' },
    defaultNumCards: { type: Number, default: 12 },
    includesCharacterArt: { type: Boolean, default: false },
    generatesBoxDesign: { type: Boolean, default: true },

}, { timestamps: true });

module.exports = mongoose.models.Template || mongoose.model('Template', TemplateSchema);