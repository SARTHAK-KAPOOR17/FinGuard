const { Router } = require('express');
const ruleController = require('../controllers/rule.controller');

const router = Router();

router.get('/', ruleController.getRules);
router.patch('/:id', ruleController.toggleRule);

module.exports = router;
