const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: [true, 'Please provide a username'], unique: true, trim: true },
    email: { type: String, required: [true, 'Please provide an email'], unique: true, match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'], trim: true, lowercase: true },
    password: { type: String, required: [true, 'Please provide a password'], minlength: 6, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },

    fullName: { type: String, required: [true, 'Please provide your full name'], trim: true },
    phone: { type: String, trim: true },
    location: { type: String, trim: true },

    // UPDATED: Added a default value for the avatar URL.
    avatarUrl: {
        type: String,
        default: '/images/avatars/default-avatar.png' // Default image path
    },

    status: { type: String, enum: ['active', 'banned', 'suspended'], default: 'active' },
    suspensionExpiresAt: { type: Date, default: null },

    resetPasswordToken: String,
    resetPasswordExpire: Date,
}, { timestamps: true });

UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

UserSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);