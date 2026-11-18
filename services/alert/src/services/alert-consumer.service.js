const { createKafkaClient, createConsumer, createLogger } = require('@finguard/shared');
const config = require('../config');
const defaultPersistenceService = require('./alert-persistence.service');

const logger = createLogger(config.serviceName);

class AlertConsumerService {
  constructor(options = {}) {
    this.consumer = options.consumer || null;
    this.persistenceService = options.persistenceService || defaultPersistenceService;
    this.isRunning = false;
    this.wsService = options.wsService || null;
    this.processedCount = 0;
    this.flaggedPersistedCount = 0;
    this.duplicateSkippedCount = 0;
    this.poisonPillCount = 0;
  }

  setWebSocketService(wsService) {
    this.wsService = wsService;
  }

  async start() {
    if (this.isRunning) return;

    if (!this.consumer) {
      const kafka = createKafkaClient({
        clientId: config.kafka.clientId,
        brokers: [config.kafka.brokers],
      });
      this.consumer = createConsumer(kafka, {
        groupId: config.kafka.consumerGroupId,
      });
    }

    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: config.kafka.flaggedTopic,
      fromBeginning: config.kafka.fromBeginning,
    });

    this.isRunning = true;
    logger.info(
      {
        topic: config.kafka.flaggedTopic,
        groupId: config.kafka.consumerGroupId,
        fromBeginning: config.kafka.fromBeginning,
      },
      'Alert Service consumer started, listening on transactions.flagged'
    );

    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        await this.handleMessage({ topic, partition, message });
      },
    });
  }

  async handleMessage({ topic, partition, message }) {
    this.processedCount++;
    const offsetCommitTarget = [
      {
        topic,
        partition,
        offset: (BigInt(message.offset) + 1n).toString(),
      },
    ];

    let payload;
    try {
      if (!message || !message.value) {
        throw new Error('Empty or null message value');
      }
      payload = JSON.parse(message.value.toString('utf8'));
    } catch (parseErr) {
      this.poisonPillCount++;
      logger.warn(
        {
          topic,
          partition,
          offset: message?.offset,
          err: parseErr.message,
        },
        'Poison pill encountered in transactions.flagged: skipping and committing offset'
      );
      if (this.consumer && typeof this.consumer.commitOffsets === 'function') {
        await this.consumer.commitOffsets(offsetCommitTarget);
      }
      return;
    }

    if (!payload || !payload.txnId) {
      this.poisonPillCount++;
      logger.warn(
        { topic, partition, offset: message.offset },
        'Message payload missing required txnId field: skipping and committing offset'
      );
      if (this.consumer && typeof this.consumer.commitOffsets === 'function') {
        await this.consumer.commitOffsets(offsetCommitTarget);
      }
      return;
    }

    // 1. Persist alert to MongoDB (atomic idempotent upsert)
    let persistenceResult;
    try {
      persistenceResult = await this.persistenceService.upsertAlert(payload);
    } catch (mongoErr) {
      logger.error(
        {
          err: mongoErr.message,
          txnId: payload.txnId,
          topic,
          partition,
          offset: message.offset,
        },
        'Failed to persist alert in MongoDB. Offset NOT committed (will retry on rebalance).'
      );
      throw mongoErr;
    }

    const { alert, isNew } = persistenceResult;

    // 2. Best-effort WebSocket broadcast for newly inserted alerts
    if (isNew) {
      this.flaggedPersistedCount++;
      try {
        if (this.wsService && typeof this.wsService.broadcastAlert === 'function') {
          this.wsService.broadcastAlert(alert);
        }
      } catch (wsErr) {
        logger.error(
          {
            err: wsErr.message,
            alertId: alert?.alertId,
            txnId: alert?.txnId,
          },
          'WebSocket broadcast failed (non-fatal, Kafka offset commit will proceed)'
        );
      }
    } else {
      this.duplicateSkippedCount++;
      logger.debug(
        { txnId: alert.txnId, alertId: alert.alertId },
        'Duplicate alert detected: skipping WebSocket broadcast'
      );
    }

    // 3. Commit Kafka offset ONLY after Mongo persist succeeds
    if (this.consumer && typeof this.consumer.commitOffsets === 'function') {
      await this.consumer.commitOffsets(offsetCommitTarget);
    }
  }

  getMetrics() {
    return {
      processedCount: this.processedCount,
      flaggedPersistedCount: this.flaggedPersistedCount,
      duplicateSkippedCount: this.duplicateSkippedCount,
      poisonPillCount: this.poisonPillCount,
      isRunning: this.isRunning,
    };
  }

  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.consumer) {
      try {
        await this.consumer.disconnect();
        logger.info('Alert Service consumer disconnected cleanly');
      } catch (err) {
        logger.error({ err: err.message }, 'Error disconnecting Alert Service consumer');
      }
      this.consumer = null;
    }
  }
}

const alertConsumerService = new AlertConsumerService();

module.exports = {
  AlertConsumerService,
  alertConsumerService,
};
