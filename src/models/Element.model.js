const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const ElementSchema = new mongoose.Schema({
    // A custom, non-mongo ID if needed for front-end logic, but _id is the primary key.
    elementId: { type: String, default: uuidv4 },

    // An element MUST belong to a box.
    boxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Box', required: true, index: true },

    // An element can optionally belong to a card. If this is null, it's a box-level or template-level element.
    cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', index: true, default: null },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    isGuestElement: { type: Boolean, default: true },
    isFrontElement: { type: Boolean, required: true, default: true },

    type: { type: String, enum: ['image', 'text', 'shape'], required: true },

    // Positioning and Transform
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: 100 },
    height: { type: Number, default: 50 },
    rotation: { type: Number, default: 0 },
    zIndex: { type: Number, default: 0 },
    opacity: { type: Number, default: 1 },

    // Image Properties
    imageUrl: { type: String },

    // Text Properties
    content: { type: String, default: '' },
    fontSize: { type: String, default: '16px' },
    fontFamily: { type: String, default: 'Arial' },
    color: { type: String, default: '#000000' },
    textAlign: { type: String, enum: ['left', 'center', 'right', 'justify'], default: 'left' },
    fontWeight: { type: String, default: 'normal' },

    // Shape Properties
    shapeType: { type: String, enum: ['rectangle', 'circle', 'triangle'] },
    fillColor: { type: String, default: '#cccccc' },
    borderRadius: { type: Number, default: 0 },

}, { timestamps: true });

module.exports = mongoose.models.Element || mongoose.model('Element', ElementSchema);