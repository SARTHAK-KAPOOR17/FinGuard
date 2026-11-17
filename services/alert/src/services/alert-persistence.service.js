const crypto = require('crypto');
const { createLogger } = require('@finguard/shared');
const config = require('../config');
const { Alert, getHighestSeverity } = require('../models/alert.model');

const logger = createLogger(config.serviceName);

/**
 * Idempotently persists a flagged event into MongoDB.
 * Uses Mongo unique index on txnId + $setOnInsert upsert.
 * Guaranteed idempotent under at-least-once message delivery.
 *
 * @param {Object} flaggedPayload
 * @returns {Promise<{ alert: Object, isNew: boolean }>}
 */
async function upsertAlert(flaggedPayload) {
  if (!flaggedPayload || !flaggedPayload.txnId) {
    throw new Error('Invalid flagged payload: txnId is required');
  }

  const highestSeverity = getHighestSeverity(flaggedPayload.matchedRules);

  const alertData = {
    alertId: flaggedPayload.alertId || crypto.randomUUID(),
    txnId: flaggedPayload.txnId,
    flaggedId: flaggedPayload.flaggedId || crypto.randomUUID(),
    userId: flaggedPayload.userId,
    amount: flaggedPayload.amount,
    currency: flaggedPayload.currency,
    merchant: flaggedPayload.merchant,
    location: flaggedPayload.location || {},
    deviceId: flaggedPayload.deviceId,
    timestamp: new Date(flaggedPayload.timestamp),
    flaggedAt: new Date(flaggedPayload.flaggedAt || Date.now()),
    matchedRules: flaggedPayload.matchedRules,
    riskScore: flaggedPayload.riskScore,
    severity: highestSeverity,
    status: 'OPEN',
    notes: [],
  };

  try {
    const result = await Alert.findOneAndUpdate(
      { txnId: flaggedPayload.txnId },
      { $setOnInsert: alertData },
      {
        upsert: true,
        new: true,
        includeResultMetadata: true,
      }
    );

    const isNew = !result.lastErrorObject?.updatedExisting;
    const alert = result.value;

    if (isNew) {
      logger.info(
        {
          alertId: alert.alertId,
          txnId: alert.txnId,
          severity: alert.severity,
          riskScore: alert.riskScore,
          matchedRulesCount: alert.matchedRules.length,
        },
        'New fraud alert persisted to MongoDB'
      );
    } else {
      logger.debug(
        { txnId: alert.txnId, alertId: alert.alertId },
        'Duplicate flagged transaction detected. Existing alert preserved without modification.'
      );
    }

    return { alert, isNew };
  } catch (err) {
    // Gracefully handle E11000 duplicate key race condition
    if (err.code === 11000) {
      const existing = await Alert.findOne({ txnId: flaggedPayload.txnId }).lean();
      logger.debug(
        { txnId: flaggedPayload.txnId },
        'E11000 duplicate key caught; resolved to existing alert document'
      );
      return { alert: existing, isNew: false };
    }

    logger.error(
      { err: err.message, txnId: flaggedPayload.txnId },
      'Failed to persist alert into MongoDB'
    );
    throw err;
  }
}

module.exports = {
  upsertAlert,
};
