const { Router } = require('express');
const { apiKeyAuth } = require('@finguard/shared');
const ruleController = require('../controllers/rule.controller');

const router = Router();

// Public read endpoints
router.get('/', (req, res, next) => ruleController.getRules(req, res, next));
router.get('/:id', (req, res, next) => ruleController.getRuleById(req, res, next));

// Protected administrative write endpoints
router.post('/', apiKeyAuth, (req, res, next) => ruleController.createRule(req, res, next));
router.put('/:id', apiKeyAuth, (req, res, next) => ruleController.putRule(req, res, next));
router.delete('/:id', apiKeyAuth, (req, res, next) => ruleController.deleteRule(req, res, next));
router.patch('/:id/toggle', apiKeyAuth, (req, res, next) => ruleController.toggleRule(req, res, next));
router.patch('/:id', apiKeyAuth, (req, res, next) => ruleController.updateRule(req, res, next));

module.exports = router;
