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

  const rawTimestamp = flaggedPayload.timestamp ? new Date(flaggedPayload.timestamp) : null;
  const parsedTimestamp = rawTimestamp && !isNaN(rawTimestamp.getTime()) ? rawTimestamp : new Date();

  const rawFlaggedAt = flaggedPayload.flaggedAt ? new Date(flaggedPayload.flaggedAt) : null;
  const parsedFlaggedAt = rawFlaggedAt && !isNaN(rawFlaggedAt.getTime()) ? rawFlaggedAt : new Date();

  const alertData = {
    alertId: flaggedPayload.alertId || crypto.randomUUID(),
    txnId: flaggedPayload.txnId,
    flaggedId: flaggedPayload.flaggedId || crypto.randomUUID(),
    userId: flaggedPayload.userId || 'usr_unknown',
    amount: typeof flaggedPayload.amount === 'number' ? flaggedPayload.amount : 0,
    currency: flaggedPayload.currency || 'USD',
    merchant: flaggedPayload.merchant || 'Unknown Merchant',
    location: flaggedPayload.location || {},
    deviceId: flaggedPayload.deviceId || 'dev_unknown',
    timestamp: parsedTimestamp,
    flaggedAt: parsedFlaggedAt,
    matchedRules: Array.isArray(flaggedPayload.matchedRules) ? flaggedPayload.matchedRules : [],
    riskScore: typeof flaggedPayload.riskScore === 'number' ? flaggedPayload.riskScore : 0,
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
