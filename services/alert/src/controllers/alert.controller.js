const mongoose = require('mongoose');
const { createLogger } = require('@finguard/shared');
const config = require('../config');
const { Alert, SEVERITY_ENUM, STATUS_ENUM } = require('../models/alert.model');
const {
  validateAlertId,
  validateGetAlertsQuery,
  validateUpdateStatusBody,
  isAllowedStatusTransition,
} = require('../validators/alert.validator');

const logger = createLogger(config.serviceName);

class AlertController {
  /**
   * GET /alerts/stats
   * Single aggregation ($facet) returning comprehensive fraud metrics
   */
  async getStats(req, res, next) {
    try {
      const [statsResult] = await Alert.aggregate([
        {
          $facet: {
            total: [{ $count: 'count' }],
            bySeverity: [{ $group: { _id: '$severity', count: { $sum: 1 } } }],
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            topRules: [
              { $unwind: '$matchedRules' },
              {
                $group: {
                  _id: '$matchedRules.ruleId',
                  ruleName: { $first: '$matchedRules.ruleName' },
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1 } },
              { $limit: 5 },
            ],
            avgRiskScore: [{ $group: { _id: null, avg: { $avg: '$riskScore' } } }],
          },
        },
      ]);

      const severityCounts = {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
        CRITICAL: 0,
      };
      if (statsResult?.bySeverity) {
        for (const item of statsResult.bySeverity) {
          if (item._id && severityCounts[item._id] !== undefined) {
            severityCounts[item._id] = item.count;
          }
        }
      }

      const statusCounts = {
        OPEN: 0,
        INVESTIGATING: 0,
        RESOLVED: 0,
        DISMISSED: 0,
      };
      if (statsResult?.byStatus) {
        for (const item of statsResult.byStatus) {
          if (item._id && statusCounts[item._id] !== undefined) {
            statusCounts[item._id] = item.count;
          }
        }
      }

      const topRules = (statsResult?.topRules || []).map((r) => ({
        ruleId: r._id,
        ruleName: r.ruleName || r._id,
        count: r.count,
      }));

      const rawAvg = statsResult?.avgRiskScore?.[0]?.avg;
      const avgRiskScore = typeof rawAvg === 'number' ? Math.round(rawAvg * 100) / 100 : 0;
      const total = statsResult?.total?.[0]?.count || 0;

      return res.status(200).json({
        total,
        bySeverity: severityCounts,
        byStatus: statusCounts,
        topRules,
        avgRiskScore,
      });
    } catch (err) {
      logger.error({ err: err.message }, 'Error aggregating alert statistics');
      return next(err);
    }
  }

  /**
   * GET /alerts
   * Paginated and filtered list of fraud alerts
   */
  async getAlerts(req, res, next) {
    try {
      const { error, value: query } = validateGetAlertsQuery(req.query);
      if (error) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid query parameters',
          details: error,
        });
      }

      const { page, limit, sort, severity, status, userId, ruleId, startDate, endDate } = query;

      const mongoFilter = {};

      if (severity) mongoFilter.severity = severity;
      if (status) mongoFilter.status = status;
      if (userId) mongoFilter.userId = userId;
      if (ruleId) mongoFilter['matchedRules.ruleId'] = ruleId;

      if (startDate || endDate) {
        mongoFilter.createdAt = {};
        if (startDate) mongoFilter.createdAt.$gte = new Date(startDate);
        if (endDate) mongoFilter.createdAt.$lte = new Date(endDate);
      }

      const sortOption = {};
      if (sort === 'riskScore') sortOption.riskScore = 1;
      else if (sort === '-riskScore') sortOption.riskScore = -1;
      else if (sort === 'createdAt') sortOption.createdAt = 1;
      else sortOption.createdAt = -1;

      const skip = (page - 1) * limit;

      const [alerts, total] = await Promise.all([
        Alert.find(mongoFilter).sort(sortOption).skip(skip).limit(limit).lean(),
        Alert.countDocuments(mongoFilter),
      ]);

      const totalPages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);

      return res.status(200).json({
        data: alerts,
        page,
        limit,
        total,
        totalPages,
      });
    } catch (err) {
      logger.error({ err: err.message }, 'Error retrieving alerts');
      return next(err);
    }
  }

  /**
   * GET /alerts/:id
   * Fetch individual alert by UUID alertId or MongoDB ObjectId
   */
  async getAlertById(req, res, next) {
    try {
      const { id } = req.params;

      if (!validateAlertId(id)) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid alert ID format. Must be a valid UUID or 24-character hex ObjectId.',
        });
      }

      const query = mongoose.Types.ObjectId.isValid(id) && id.length === 24
        ? { $or: [{ alertId: id }, { _id: id }] }
        : { alertId: id };

      const alert = await Alert.findOne(query).lean();

      if (!alert) {
        return res.status(404).json({
          error: 'NotFound',
          message: `Alert with ID "${id}" was not found.`,
        });
      }

      return res.status(200).json({ alert });
    } catch (err) {
      logger.error({ err: err.message, id: req.params.id }, 'Error retrieving alert by ID');
      return next(err);
    }
  }

  /**
   * PATCH /alerts/:id/status
   * Updates alert status with analyst audit notes and lifecycle transition validation.
   */
  async updateStatus(req, res, next) {
    try {
      const { id } = req.params;

      if (!validateAlertId(id)) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid alert ID format. Must be a valid UUID or 24-character hex ObjectId.',
        });
      }

      const { error, value: body } = validateUpdateStatusBody(req.body);
      if (error) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid status update payload',
          details: error,
        });
      }

      const query = mongoose.Types.ObjectId.isValid(id) && id.length === 24
        ? { $or: [{ alertId: id }, { _id: id }] }
        : { alertId: id };

      const alert = await Alert.findOne(query);

      if (!alert) {
        return res.status(404).json({
          error: 'NotFound',
          message: `Alert with ID "${id}" was not found.`,
        });
      }

      const currentStatus = alert.status;
      const targetStatus = body.status;

      // Validate lifecycle state transition
      if (!isAllowedStatusTransition(currentStatus, targetStatus)) {
        return res.status(400).json({
          error: 'InvalidTransitionError',
          message: `Cannot transition alert status from "${currentStatus}" to "${targetStatus}". Reopening a resolved/dismissed alert requires moving to "INVESTIGATING".`,
        });
      }

      // Append analyst note if provided
      if (body.note) {
        alert.notes.push({
          author: body.analyst,
          text: body.note,
          createdAt: new Date(),
        });
      }

      // If status changed, record an automated audit note
      if (currentStatus !== targetStatus) {
        alert.notes.push({
          author: body.analyst,
          text: `Status changed from ${currentStatus} to ${targetStatus}`,
          createdAt: new Date(),
        });
      }

      alert.status = targetStatus;
      alert.assignedTo = body.analyst;

      await alert.save();

      logger.info(
        {
          alertId: alert.alertId,
          oldStatus: currentStatus,
          newStatus: targetStatus,
          analyst: body.analyst,
        },
        'Alert status updated'
      );

      return res.status(200).json({
        status: 'success',
        message: 'Alert status updated successfully',
        alert,
      });
    } catch (err) {
      logger.error({ err: err.message, id: req.params.id }, 'Error updating alert status');
      return next(err);
    }
  }
}

const alertController = new AlertController();

module.exports = alertController;
