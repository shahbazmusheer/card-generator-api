const express = require('express');
const router = express.Router();
const userController = require('../../controllers/admin/user.controller');

// Base URL for these routes is /api/admin/users

// Standard CRUD for users
router.route('/')
    .get(userController.getUsers);

router.route('/:id')
    .get(userController.getUser)
    .put(userController.updateUser)
    .delete(userController.deleteUser);

// Moderation Actions
router.put('/:id/ban', userController.banUser);
router.put('/:id/suspend', userController.suspendUser);
router.put('/:id/activate', userController.activateUser); // A single endpoint to remove ban/suspension

module.exports = router;