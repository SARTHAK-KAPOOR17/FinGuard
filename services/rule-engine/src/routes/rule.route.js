const { Router } = require('express');
const ruleController = require('../controllers/rule.controller');

const router = Router();

router.post('/', (req, res, next) => ruleController.createRule(req, res, next));
router.get('/', (req, res, next) => ruleController.getRules(req, res, next));
router.get('/:id', (req, res, next) => ruleController.getRuleById(req, res, next));
router.put('/:id', (req, res, next) => ruleController.putRule(req, res, next));
router.delete('/:id', (req, res, next) => ruleController.deleteRule(req, res, next));
router.patch('/:id/toggle', (req, res, next) => ruleController.toggleRule(req, res, next));
router.patch('/:id', (req, res, next) => ruleController.updateRule(req, res, next));

module.exports = router;
