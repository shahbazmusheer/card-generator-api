const express = require('express');
const {
    getUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser,
    // --- IMPORT NEW CONTROLLERS ---
    banUser,
    unbanUser,
    suspendUser
} = require('../controllers/user.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// All routes below are admin-protected
router.use(protect);
router.use(authorize('admin'));

router.route('/')
    .get(getUsers)
    .post(createUser);

router.route('/:id')
    .get(getUser)
    .put(updateUser)
    .delete(deleteUser);

// --- NEW ADMIN ROUTES FOR USER STATUS MANAGEMENT ---
router.put('/:id/ban', banUser);
router.put('/:id/unban', unbanUser);
router.put('/:id/suspend', suspendUser);

module.exports = router;