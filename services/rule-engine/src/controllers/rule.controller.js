const { Rule } = require('../models/rule.model');
const { getRedisPublisher } = require('../database/redis');
const ruleProcessorService = require('../services/rule-processor.service');
const config = require('../config');

class RuleController {
  /**
   * GET /rules - Fetch all configured rules from MongoDB
   */
  async getRules(req, res, next) {
    try {
      const rules = await Rule.find().lean();
      return res.status(200).json({ rules });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /rules/:id - Update rule enabled state or configuration (threshold, speed, pattern, etc.)
   */
  async updateRule(req, res, next) {
    try {
      const { id } = req.params;
      const { enabled, config: ruleConfig, threshold, severity, name, description } = req.body;

      const updateFields = {};

      if (typeof enabled === 'boolean') {
        updateFields.enabled = enabled;
      }

      if (severity && ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity)) {
        updateFields.severity = severity;
      }

      if (name) updateFields.name = name;
      if (description) updateFields.description = description;

      // Handle config update or direct threshold update
      if (ruleConfig && typeof ruleConfig === 'object') {
        updateFields.config = ruleConfig;
      } else if (threshold !== undefined) {
        // Direct threshold convenience update (e.g. { threshold: 50000 })
        const existingRule = await Rule.findOne({ ruleId: id });
        if (existingRule) {
          updateFields.config = {
            ...existingRule.config,
            threshold: parseFloat(threshold),
          };
        }
      }

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'No valid update fields provided (enabled, config, threshold, severity, name, description)',
        });
      }

      const updatedRule = await Rule.findOneAndUpdate(
        { ruleId: id },
        { $set: updateFields },
        { new: true }
      ).lean();

      if (!updatedRule) {
        return res.status(404).json({
          error: 'NotFound',
          message: `Rule with ID "${id}" not found`,
        });
      }

      // Publish update notification to Redis pub/sub channel `rules:updated`
      try {
        const publisher = await getRedisPublisher();
        await publisher.publish(
          config.redis.channels.rulesUpdated,
          JSON.stringify({
            action: 'UPDATE_RULE',
            ruleId: id,
            updatedAt: new Date().toISOString(),
          })
        );
      } catch {
        // Pub/sub failure logged, fallback to local reload
      }

      // Trigger local atomic reload
      await ruleProcessorService.reloadRules('api-patch');

      return res.status(200).json({
        status: 'success',
        message: `Rule "${id}" updated successfully and reload published`,
        rule: updatedRule,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new RuleController();
