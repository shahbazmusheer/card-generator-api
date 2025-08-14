// src/models/Element.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid'); // If you are using this for a custom ID

const ElementSchemaDef = {
    elementId: { type: String, default: uuidv4 }, // Custom ID, Mongoose _id is still primary key
    cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', index: true, default: null }, // Null if a box element
    boxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Box', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    isGuestElement: { type: Boolean, default: true },
    isFrontElement: { type: Boolean, required: true, default: true }, // true for front, false for back
    type: { type: String, enum: ['image', 'text', 'shape'], required: true },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: 100 },
    height: { type: Number, default: 50 },
    rotation: { type: Number, default: 0 },
    zIndex: { type: Number, default: 0 },
    opacity: { type: Number, default: 1 },
    imageUrl: { type: String },
    content: { type: String, default: '' },
    fontSize: { type: String, default: '16px' },
    fontFamily: { type: String, default: 'Arial' },
    color: { type: String, default: '#000000' },
    textAlign: { type: String, enum: ['left', 'center', 'right', 'justify'], default: 'left' },
    fontWeight: { type: String, default: 'normal' },
    fontStyle: { type: String, default: 'normal' },
    lineHeight: { type: String, default: 'normal'},
    letterSpacing: {type: String, default: 'normal'},
    textDecoration: {type: String, default: 'none'},
    borderRadius: { type: Number, default: 0 },
    shapeType: { type: String, enum: ['rectangle', 'circle', 'triangle'] }, // if you have 'shape' type
    fillColor: { type: String, default: '#cccccc' },
    strokeColor: { type: String, default: '#000000' },
    strokeWidth: { type: Number, default: 1 },
    customAttributes: { type: Map, of: String },
};

const ElementSchema = new mongoose.Schema(ElementSchemaDef, { timestamps: true });

module.exports = mongoose.models.Element || mongoose.model('Element', ElementSchema);