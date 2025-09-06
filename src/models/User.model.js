const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSettingsSchema = new mongoose.Schema({
    _id: false,
    receiveEmailNotifications: { type: Boolean, default: true }
});

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'], trim: true, lowercase: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    location: { type: String, trim: true },
    avatarUrl: { type: String, default: '/images/avatars/default-avatar.png' },

    // --- NEW FIELD for user settings ---
    settings: {
        type: UserSettingsSchema,
        default: () => ({}) // Ensures the default is applied on creation
    },

    status: { type: String, enum: ['active', 'banned', 'suspended'], default: 'active' },
    suspensionExpiresAt: { type: Date, default: null },
    resetPasswordToken: String,
    resetPasswordExpire: Date,
}, { timestamps: true });

UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

UserSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);