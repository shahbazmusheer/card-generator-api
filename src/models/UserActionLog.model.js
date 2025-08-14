// src/models/UserActionLog.model.js
const mongoose = require('mongoose');

const UserActionLogSchema = new mongoose.Schema({
    // The user who was the subject of the action
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // The admin who performed the action
    moderatorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // The type of action taken
    actionType: {
        type: String,
        enum: ['ban', 'suspend', 'unban'],
        required: true
    },
    // A structured reason type (e.g., 'spam', 'harassment', 'tos_violation')
    reasonType: {
        type: String,
        trim: true,
        // This is not required for 'unban' actions
        required: function() { return this.actionType !== 'unban'; }
    },
    // A more detailed, free-text description of the reason
    reasonDescription: {
        type: String,
        trim: true,
        required: function() { return this.actionType !== 'unban'; }
    },
    // For suspensions, this stores when the action expires
    expiresAt: {
        type: Date
    }
}, { timestamps: true }); // `createdAt` will record when the action was taken

module.exports = mongoose.model('UserActionLog', UserActionLogSchema);