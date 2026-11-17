const ruleProcessorService = require('../services/rule-processor.service');

class RuleController {
  getRules(req, res) {
    const rules = ruleProcessorService.getEvaluator().getRules();
    return res.status(200).json({ rules });
  }

  toggleRule(req, res) {
    const { id } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Field "enabled" must be a boolean',
      });
    }

    const updated = ruleProcessorService.getEvaluator().setRuleEnabled(id, enabled);
    if (!updated) {
      return res.status(404).json({
        error: 'NotFound',
        message: `Rule with ID "${id}" not found`,
      });
    }

    return res.status(200).json({
      status: 'success',
      message: `Rule "${id}" updated successfully`,
      ruleId: id,
      enabled,
    });
  }
}

module.exports = new RuleController();
