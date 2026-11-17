const { randomUUID } = require('crypto');
const {
  createKafkaClient,
  createProducer,
  createConsumer,
  validateTransaction,
  createLogger,
  TOPICS,
} = require('@finguard/shared');
const config = require('../config');
const { RuleEvaluator } = require('../engine/evaluator');

const logger = createLogger(config.serviceName);

class RuleProcessorService {
  /**
   * @param {object} [options]
   * @param {object} [options.producer]
   * @param {object} [options.consumer]
   * @param {RuleEvaluator} [options.evaluator]
   */
  constructor(options = {}) {
    this.producer = options.producer || null;
    this.consumer = options.consumer || null;
    this.evaluator = options.evaluator || new RuleEvaluator();

    this.rawTopic = config.kafka.rawTopic || TOPICS.TRANSACTIONS_RAW;
    this.flaggedTopic = config.kafka.flaggedTopic || TOPICS.TRANSACTIONS_FLAGGED;
    this.fromBeginning = config.kafka.fromBeginning;

    this.isRunning = false;
    this.metrics = {
      totalConsumed: 0,
      totalFlagged: 0,
      totalClean: 0,
      totalMalformed: 0,
      startTime: null,
      lastProcessedAt: null,
    };
  }

  async initKafka() {
    if (!this.kafka) {
      this.kafka = createKafkaClient({
        clientId: config.kafka.clientId,
        brokers: config.kafka.brokers,
      });
    }

    if (!this.producer) {
      this.producer = createProducer(this.kafka);
      await this.producer.connect();
    }

    if (!this.consumer) {
      this.consumer = createConsumer(this.kafka, {
        groupId: config.kafka.consumerGroupId,
      });
      await this.consumer.connect();
    }
  }

  /**
   * Starts the Kafka consumer stream processing loop.
   */
  async start() {
    if (this.isRunning) return;

    await this.initKafka();
    this.isRunning = true;
    this.metrics.startTime = new Date().toISOString();

    logger.info(
      {
        rawTopic: this.rawTopic,
        flaggedTopic: this.flaggedTopic,
        fromBeginning: this.fromBeginning,
        groupId: config.kafka.consumerGroupId,
      },
      'Starting Rule Engine stream processing consumer...'
    );

    await this.consumer.subscribe({
      topic: this.rawTopic,
      fromBeginning: this.fromBeginning,
    });

    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message, key, value, offset, commitOffset }) => {
        this.metrics.totalConsumed++;
        this.metrics.lastProcessedAt = new Date().toISOString();

        // 1. Guard against malformed JSON or invalid schema
        if (!value || typeof value !== 'object') {
          logger.warn(
            { topic, partition, offset, key },
            'Skipping malformed transaction message (non-JSON or null payload)'
          );
          this.metrics.totalMalformed++;
          if (commitOffset) await commitOffset();
          return;
        }

        const { error, value: validatedTxn } = validateTransaction(value);
        if (error) {
          logger.warn(
            { topic, partition, offset, key, validationErrors: error },
            'Skipping invalid transaction payload failing schema validation'
          );
          this.metrics.totalMalformed++;
          if (commitOffset) await commitOffset();
          return;
        }

        // 2. Evaluate against active fraud rules
        const evaluation = this.evaluator.evaluate(validatedTxn);

        if (evaluation.isFlagged) {
          const flaggedEvent = {
            flaggedId: randomUUID(),
            txnId: validatedTxn.txnId,
            userId: validatedTxn.userId,
            amount: validatedTxn.amount,
            currency: validatedTxn.currency,
            merchant: validatedTxn.merchant,
            location: validatedTxn.location,
            deviceId: validatedTxn.deviceId,
            timestamp: validatedTxn.timestamp,
            flaggedAt: new Date().toISOString(),
            matchedRules: evaluation.matchedRules,
            riskScore: evaluation.riskScore,
            status: 'FLAGGED',
          };

          try {
            // Publish flagged event to transactions.flagged
            await this.producer.send({
              topic: this.flaggedTopic,
              messages: [
                {
                  key: validatedTxn.userId,
                  value: flaggedEvent,
                },
              ],
            });

            this.metrics.totalFlagged++;

            logger.info(
              {
                flaggedId: flaggedEvent.flaggedId,
                txnId: validatedTxn.txnId,
                userId: validatedTxn.userId,
                amount: validatedTxn.amount,
                matchedRules: evaluation.matchedRules.map((r) => r.ruleId),
                riskScore: evaluation.riskScore,
              },
              'Fraud detected: Published flagged event to Kafka'
            );

            // 3. Only after confirmed publication to transactions.flagged, commit offset (at-least-once)
            if (commitOffset) {
              await commitOffset();
            }
          } catch (publishErr) {
            logger.error(
              {
                err: publishErr.message,
                txnId: validatedTxn.txnId,
                topic,
                partition,
                offset,
              },
              'Failed to publish flagged event to Kafka. Offset NOT committed for at-least-once retry.'
            );
            throw publishErr; // Let Kafka retry or handle through backoff
          }
        } else {
          // Clean transaction - commit offset
          this.metrics.totalClean++;
          if (commitOffset) {
            await commitOffset();
          }
        }
      },
    });

    logger.info('Rule Engine consumer loop active and awaiting raw transactions');
  }

  /**
   * Stops the consumer and producer cleanly.
   */
  async stop() {
    this.isRunning = false;
    if (this.consumer) {
      await this.consumer.disconnect().catch(() => {});
      this.consumer = null;
    }
    if (this.producer) {
      await this.producer.disconnect().catch(() => {});
      this.producer = null;
    }
    logger.info('Rule Engine processor stopped');
  }

  getMetrics() {
    return {
      ...this.metrics,
      isRunning: this.isRunning,
      activeRulesCount: this.evaluator.getRules().filter((r) => r.enabled).length,
    };
  }

  getEvaluator() {
    return this.evaluator;
  }
}

module.exports = new RuleProcessorService();
