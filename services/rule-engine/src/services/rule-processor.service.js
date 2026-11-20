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
const { Rule } = require('../models/rule.model');
const { RuleEvaluator } = require('../engine/evaluator');
const { connectMongo, disconnectMongo } = require('../database/mongo');
const {
  getRedisClient,
  getRedisSubscriber,
  disconnectRedis,
} = require('../database/redis');

const logger = createLogger(config.serviceName);

class RuleProcessorService {
  /**
   * @param {object} [options]
   * @param {object} [options.producer]
   * @param {object} [options.consumer]
   * @param {object} [options.redisClient]
   * @param {RuleEvaluator} [options.evaluator]
   */
  constructor(options = {}) {
    this.producer = options.producer || null;
    this.consumer = options.consumer || null;
    this.redisClient = options.redisClient || null;
    this.evaluator = options.evaluator || new RuleEvaluator([]);

    this.rawTopic = config.kafka.rawTopic || TOPICS.TRANSACTIONS_RAW;
    this.flaggedTopic = config.kafka.flaggedTopic || TOPICS.TRANSACTIONS_FLAGGED;
    this.fromBeginning = config.kafka.fromBeginning;

    this.isRunning = false;
    this.fallbackTimer = null;
    this.metrics = {
      totalConsumed: 0,
      totalFlagged: 0,
      totalClean: 0,
      totalMalformed: 0,
      flaggedByRule: {},
      startTime: null,
      lastProcessedAt: null,
      lastReloadAt: null,
      activeRulesCount: 0,
    };
  }

  /**
   * Atomically reloads rules from MongoDB and updates the active evaluator reference.
   *
   * @param {string} [trigger='manual']
   */
  async reloadRules(trigger = 'manual') {
    try {
      logger.info({ trigger }, 'Starting atomic rule reload from MongoDB...');
      const dbRules = await Rule.find().lean();
      const newEvaluator = new RuleEvaluator(dbRules);

      // Atomic pointer swap
      this.evaluator = newEvaluator;

      const activeCount = dbRules.filter((r) => r.enabled).length;
      this.metrics.lastReloadAt = new Date().toISOString();
      this.metrics.activeRulesCount = activeCount;

      logger.info(
        {
          trigger,
          timestamp: this.metrics.lastReloadAt,
          activeRulesCount: activeCount,
          ruleDetails: dbRules.map((r) => ({
            id: r.ruleId,
            name: r.name,
            type: r.type,
            enabled: r.enabled,
            config: r.config,
          })),
        },
        '>>> Rule Engine ATOMICALLY RELOADED rules from MongoDB'
      );
    } catch (err) {
      logger.error({ err: err.message, trigger }, 'Failed to reload rules from MongoDB');
    }
  }

  async initDependencies() {
    // 1. Connect MongoDB and seed if empty
    await connectMongo();

    // 2. Load rules from MongoDB
    await this.reloadRules('startup');

    // 3. Connect Redis command client
    if (!this.redisClient) {
      this.redisClient = await getRedisClient();
    }

    // 4. Connect Redis pub/sub subscriber for rules:updated channel
    try {
      const subscriber = await getRedisSubscriber();
      await subscriber.subscribe(config.redis.channels.rulesUpdated);
      subscriber.on('message', async (channel, message) => {
        if (channel === config.redis.channels.rulesUpdated) {
          logger.info({ channel, message }, 'Redis pub/sub reload notification received');
          await this.reloadRules('redis-pubsub');
        }
      });
      logger.info({ channel: config.redis.channels.rulesUpdated }, 'Subscribed to Redis rule reload channel');
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to subscribe to Redis reload channel; falling back to timer');
    }

    // 5. Setup 60s fallback background refresh
    if (!this.fallbackTimer) {
      this.fallbackTimer = setInterval(() => {
        this.reloadRules('timer-fallback');
      }, 60000);
      this.fallbackTimer.unref();
    }

    // 6. Connect Kafka
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
   * Starts the Kafka stream processing consumer.
   */
  async start() {
    if (this.isRunning) return;

    await this.initDependencies();
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

        // 2. Evaluate against active rules with Redis context
        const evaluation = await this.evaluator.evaluate(validatedTxn, {
          redis: this.redisClient,
        });

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

            // Record breakdown by ruleId
            for (const r of evaluation.matchedRules) {
              this.metrics.flaggedByRule[r.ruleId] = (this.metrics.flaggedByRule[r.ruleId] || 0) + 1;
            }

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
            throw publishErr;
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
   * Stops consumer, producer, timers, and database connections.
   */
  async stop() {
    this.isRunning = false;
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.consumer) {
      await this.consumer.disconnect().catch(() => {});
      this.consumer = null;
    }
    if (this.producer) {
      await this.producer.disconnect().catch(() => {});
      this.producer = null;
    }
    await disconnectRedis().catch(() => {});
    await disconnectMongo().catch(() => {});
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
