const { Rule } = require('../models/rule.model');
const { getRedisPublisher } = require('../database/redis');
const ruleProcessorService = require('../services/rule-processor.service');
const config = require('../config');
const {
  validateCreateRule,
  validateUpdateRule,
} = require('../validators/rule.validator');

async function publishRuleUpdate(action, ruleId, extra = {}) {
  try {
    const publisher = await getRedisPublisher();
    await publisher.publish(
      config.redis.channels.rulesUpdated,
      JSON.stringify({
        action,
        ruleId,
        updatedAt: new Date().toISOString(),
        ...extra,
      })
    );
  } catch {
    // Pub/sub error logged; fallback reload will still apply
  }
}

class RuleController {
  /**
   * POST /rules - Create a new fraud rule with strict Joi validation & ReDoS protection
   */
  async createRule(req, res, next) {
    try {
      const { error, value: validatedRule } = validateCreateRule(req.body);
      if (error) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid rule configuration payload',
          details: error,
        });
      }

      const existing = await Rule.findOne({ ruleId: validatedRule.ruleId });
      if (existing) {
        return res.status(409).json({
          error: 'ConflictError',
          message: `Rule with ID "${validatedRule.ruleId}" already exists`,
        });
      }

      const createdRule = await Rule.create(validatedRule);

      await publishRuleUpdate('CREATE_RULE', createdRule.ruleId);
      await ruleProcessorService.reloadRules('api-create');

      return res.status(201).json({
        status: 'success',
        message: `Rule "${createdRule.ruleId}" created successfully and engine reloaded`,
        rule: createdRule.toObject ? createdRule.toObject() : createdRule,
      });
    } catch (err) {
      next(err);
    }
  }

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
   * GET /rules/:id - Fetch a single rule by ruleId
   */
  async getRuleById(req, res, next) {
    try {
      const { id } = req.params;
      const rule = await Rule.findOne({ ruleId: id }).lean();
      if (!rule) {
        return res.status(404).json({
          error: 'NotFound',
          message: `Rule with ID "${id}" not found`,
        });
      }
      return res.status(200).json({ rule });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /rules/:id - Full update of rule definition and config
   */
  async putRule(req, res, next) {
    try {
      const { id } = req.params;
      const existing = await Rule.findOne({ ruleId: id });
      if (!existing) {
        return res.status(404).json({
          error: 'NotFound',
          message: `Rule with ID "${id}" not found`,
        });
      }

      const { error, value: validatedData } = validateUpdateRule(req.body, existing.type);
      if (error) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid rule update payload',
          details: error,
        });
      }

      const updateFields = {
        name: validatedData.name || existing.name,
        description: validatedData.description !== undefined ? validatedData.description : existing.description,
        severity: validatedData.severity || existing.severity,
        enabled: validatedData.enabled !== undefined ? validatedData.enabled : existing.enabled,
        type: validatedData.type || existing.type,
        config: validatedData.config || existing.config,
      };

      const updatedRule = await Rule.findOneAndUpdate(
        { ruleId: id },
        { $set: updateFields },
        { new: true }
      ).lean();

      await publishRuleUpdate('UPDATE_RULE', id);
      await ruleProcessorService.reloadRules('api-put');

      return res.status(200).json({
        status: 'success',
        message: `Rule "${id}" updated successfully and engine reloaded`,
        rule: updatedRule,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /rules/:id - Delete rule from MongoDB and reload engine
   */
  async deleteRule(req, res, next) {
    try {
      const { id } = req.params;
      const deleted = await Rule.findOneAndDelete({ ruleId: id }).lean();
      if (!deleted) {
        return res.status(404).json({
          error: 'NotFound',
          message: `Rule with ID "${id}" not found`,
        });
      }

      await publishRuleUpdate('DELETE_RULE', id);
      await ruleProcessorService.reloadRules('api-delete');

      return res.status(200).json({
        status: 'success',
        message: `Rule "${id}" deleted successfully and engine reloaded`,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /rules/:id/toggle - Toggle rule enabled state
   */
  async toggleRule(req, res, next) {
    try {
      const { id } = req.params;
      const existing = await Rule.findOne({ ruleId: id });
      if (!existing) {
        return res.status(404).json({
          error: 'NotFound',
          message: `Rule with ID "${id}" not found`,
        });
      }

      const newEnabled =
        req.body && typeof req.body.enabled === 'boolean'
          ? req.body.enabled
          : !existing.enabled;

      const updatedRule = await Rule.findOneAndUpdate(
        { ruleId: id },
        { $set: { enabled: newEnabled } },
        { new: true }
      ).lean();

      await publishRuleUpdate('TOGGLE_RULE', id, { enabled: newEnabled });
      await ruleProcessorService.reloadRules('api-toggle');

      return res.status(200).json({
        status: 'success',
        message: `Rule "${id}" enabled state toggled to ${newEnabled}`,
        rule: updatedRule,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /rules/:id - Partial rule update (backwards compatibility)
   */
  async updateRule(req, res, next) {
    try {
      const { id } = req.params;
      const existing = await Rule.findOne({ ruleId: id });
      if (!existing) {
        return res.status(404).json({
          error: 'NotFound',
          message: `Rule with ID "${id}" not found`,
        });
      }

      const { error, value: validatedData } = validateUpdateRule(req.body, existing.type);
      if (error) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid partial update payload',
          details: error,
        });
      }

      const updateFields = {};
      if (validatedData.enabled !== undefined) updateFields.enabled = validatedData.enabled;
      if (validatedData.severity) updateFields.severity = validatedData.severity;
      if (validatedData.name) updateFields.name = validatedData.name;
      if (validatedData.description !== undefined) updateFields.description = validatedData.description;
      if (validatedData.config) {
        updateFields.config = validatedData.config;
      } else if (req.body.threshold !== undefined) {
        updateFields.config = {
          ...existing.config,
          threshold: parseFloat(req.body.threshold),
        };
      }

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'No valid update fields provided',
        });
      }

      const updatedRule = await Rule.findOneAndUpdate(
        { ruleId: id },
        { $set: updateFields },
        { new: true }
      ).lean();

      await publishRuleUpdate('UPDATE_RULE', id);
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
