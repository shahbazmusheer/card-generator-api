const User = require('../models/User.model');
const crypto = require('crypto');
const { generateToken } = require('../utils/tokenUtils');

const generateUniqueUsername = async (email) => {
    let baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
    let username = baseUsername;
    let user = await User.findOne({ username });
    while (user) {
        const randomSuffix = Math.floor(Math.random() * 9000) + 1000;
        username = `${baseUsername}${randomSuffix}`;
        user = await User.findOne({ username });
    }
    return username;
};

exports.register = async (req, res, next) => {
    const { fullName, email, phone, location, password, role = 'user' } = req.body;
    try {
        if (!fullName || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, Email, and Password are required fields.' });
        }
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ success: false, message: 'A user with this email already exists' });
        }
        const username = await generateUniqueUsername(email);
        user = await User.create({
            username, email, password, role, fullName, phone, location
        });
        const token = generateToken(user._id);
        res.status(201).json({
            success: true,
            token,
            data: { 
                userId: user._id, username: user.username, email: user.email, role: user.role,
                fullName: user.fullName, phone: user.phone, location: user.location, avatarUrl: user.avatarUrl
            }
        });
    } catch (error) {
        console.error("Register error:", error.message);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ success: false, message: messages.join(', ') });
        }
        res.status(500).json({ success: false, message: 'Server Error during registration' });
    }
};

exports.login = async (req, res, next) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Please provide an email and password' });
    }
    try {
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials (user not found)' });
        }
        if (user.status === 'banned') {
            return res.status(403).json({ success: false, message: 'Your account has been permanently banned.' });
        }
        if (user.status === 'suspended') {
            if (user.suspensionExpiresAt && user.suspensionExpiresAt > new Date()) {
                return res.status(403).json({ success: false, message: `Your account is suspended until ${user.suspensionExpiresAt.toLocaleString()}.` });
            } else {
                user.status = 'active';
                user.suspensionExpiresAt = null;
                await user.save({ validateBeforeSave: false });
            }
        }
        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials (password mismatch)' });
        }
        const token = generateToken(user._id);
        const userData = {
            userId: user._id, username: user.username, email: user.email, role: user.role, status: user.status,
            fullName: user.fullName, phone: user.phone, location: user.location, avatarUrl: user.avatarUrl
        };
        res.status(200).json({
            success: true,
            token,
            data: userData
        });
    } catch (error) {
        console.error("Login error:", error.message);
        res.status(500).json({ success: false, message: 'Server Error during login' });
    }
};

exports.profile = async (req, res, next) => {
    if (!req.user) {
        return res.status(404).json({ success: false, message: 'User not found or not authenticated' });
    }
    const user = req.user;
    const userData = {
        userId: user._id, username: user.username, email: user.email, role: user.role, status: user.status,
        fullName: user.fullName, phone: user.phone, location: user.location, avatarUrl: user.avatarUrl
    };
    res.status(200).json({
        success: true,
        data: userData
    });
};

// --- NEW METHOD FOR CHANGING PASSWORD ---
/**
 * @desc    Update password for a logged-in user
 * @route   PUT /api/auth/updatepassword
 * @access  Private
 */
exports.updatePassword = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Please provide both a current and a new password.' });
        }
        const user = await User.findById(userId).select('+password');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        const isMatch = await user.matchPassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Incorrect current password.' });
        }
        user.password = newPassword;
        await user.save();
        res.status(200).json({
            success: true,
            message: 'Password updated successfully.'
        });
    } catch (error) {
        console.error("Update Password error:", error.message);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ success: false, message: messages.join(', ') });
        }
        res.status(500).json({ success: false, message: 'Server Error during password update.' });
    }
};