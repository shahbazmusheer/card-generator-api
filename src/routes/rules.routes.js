// src/routes/rules.routes.js
const express = require('express');
const router = express.Router();
const rulesController = require('../controllers/rules.controller');
const { protect, optionalProtect } = require('../middleware/auth.middleware');

// Create a new RuleSet (Public, but uses optional auth to assign userId if logged in)
router.post('/', optionalProtect, rulesController.createRuleSet);
// The following routes are for managing existing rulesets and MUST be protected
router.get('/', protect, rulesController.getUserRuleSets);
router.get('/:ruleSetId', protect, rulesController.getRuleSetById);
router.put('/:ruleSetId', protect, rulesController.updateRuleSet);
router.delete('/:ruleSetId', protect, rulesController.deleteRuleSet);

module.exports = router;