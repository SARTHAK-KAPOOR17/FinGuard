const { Kafka, logLevel: KafkaLogLevel, Partitioners } = require('kafkajs');
const { createLogger } = require('../logger');

const logger = createLogger('shared-kafka');

/**
 * Maps KafkaJS log level to Pino log level.
 */
function toPinoLogLevel(level) {
  switch (level) {
    case KafkaLogLevel.ERROR:
    case KafkaLogLevel.NOTHING:
      return 'error';
    case KafkaLogLevel.WARN:
      return 'warn';
    case KafkaLogLevel.INFO:
      return 'info';
    case KafkaLogLevel.DEBUG:
    default:
      return 'debug';
  }
}

/**
 * Pino log creator for KafkaJS.
 */
function pinoLogCreator() {
  return ({ namespace, level, label, log }) => {
    const pinoLevel = toPinoLogLevel(level);
    const { message, ...extra } = log;
    logger[pinoLevel]({ kafkaNamespace: namespace, kafkaLabel: label, ...extra }, message);
  };
}

/**
 * Creates a configured Kafka client instance.
 *
 * @param {object} config
 * @param {string} [config.clientId]
 * @param {string[]|string} [config.brokers]
 * @param {object} [config.retry]
 * @returns {Kafka}
 */
function createKafkaClient(config = {}) {
  const brokersEnv = process.env.KAFKA_BROKERS || 'localhost:9092';
  const brokers = Array.isArray(config.brokers)
    ? config.brokers
    : (config.brokers || brokersEnv).split(',').map((b) => b.trim());

  const clientId = config.clientId || process.env.KAFKA_CLIENT_ID || 'finguard-client';

  return new Kafka({
    clientId,
    brokers,
    retry: {
      initialRetryTime: 300,
      maxRetryTime: 30000,
      retries: 8,
      factor: 2,
      ...config.retry,
    },
    logLevel: KafkaLogLevel.WARN,
    logCreator: pinoLogCreator,
    ...config.options,
  });
}

/**
 * Creates and wraps a Kafka producer with retry and lifecycle management.
 *
 * @param {Kafka} kafkaClient
 * @param {object} [options]
 * @returns {object} Wrapped producer
 */
function createProducer(kafkaClient, options = {}) {
  const producer = kafkaClient.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
    allowAutoTopicCreation: false,
    retry: {
      initialRetryTime: 300,
      retries: 5,
      ...options.retry,
    },
    ...options,
  });

  let connected = false;

  async function connect(retries = 5, delayMs = 1000) {
    if (connected) return;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await producer.connect();
        connected = true;
        logger.info({ attempt }, 'Kafka producer connected successfully');
        return;
      } catch (err) {
        logger.warn({ attempt, retries, err: err.message }, 'Kafka producer connection failed, retrying...');
        if (attempt === retries) {
          logger.error({ err }, 'Kafka producer failed to connect after maximum retries');
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  async function disconnect() {
    if (!connected) return;
    try {
      await producer.disconnect();
      connected = false;
      logger.info('Kafka producer disconnected cleanly');
    } catch (err) {
      logger.error({ err: err.message }, 'Error disconnecting Kafka producer');
      throw err;
    }
  }

  /**
   * Publishes messages to a topic.
   *
   * @param {object} params
   * @param {string} params.topic
   * @param {Array<{key?: string, value: any, headers?: object}>} params.messages
   * @param {number} [params.acks=-1] -1 = all replicas
   * @param {number} [params.timeout=30000]
   */
  async function send({ topic, messages, acks = -1, timeout = 30000 }) {
    if (!connected) {
      await connect();
    }

    if (!topic || typeof topic !== 'string') {
      throw new Error('Kafka producer send() requires a valid string topic name');
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Kafka producer send() requires a non-empty array of messages');
    }

    const preparedMessages = messages.map((m) => {
      let value = m.value;
      if (typeof value === 'object' && value !== null && !Buffer.isBuffer(value)) {
        value = JSON.stringify(value);
      }
      return {
        key: m.key !== undefined && m.key !== null ? String(m.key) : null,
        value,
        headers: m.headers || {},
      };
    });

    try {
      const result = await producer.send({
        topic,
        messages: preparedMessages,
        acks,
        timeout,
      });
      return result;
    } catch (err) {
      logger.error({ topic, messageCount: messages.length, err: err.message }, 'Failed to publish messages to Kafka');
      throw err;
    }
  }

  /**
   * Publishes a batch of topic messages in a single Kafka request.
   *
   * @param {object} params
   * @param {Array<{topic: string, messages: Array<{key?: string, value: any, headers?: object}>}>} params.topicMessages
   * @param {number} [params.acks=-1]
   * @param {number} [params.timeout=30000]
   */
  async function sendBatch({ topicMessages, acks = -1, timeout = 30000 }) {
    if (!connected) {
      await connect();
    }

    if (!Array.isArray(topicMessages) || topicMessages.length === 0) {
      throw new Error('Kafka producer sendBatch() requires a non-empty array of topicMessages');
    }

    const preparedBatch = topicMessages.map((tm) => {
      if (!tm.topic || typeof tm.topic !== 'string') {
        throw new Error('Each topicMessage in sendBatch must have a valid topic string');
      }

      const preparedMessages = (tm.messages || []).map((m) => {
        let value = m.value;
        if (typeof value === 'object' && value !== null && !Buffer.isBuffer(value)) {
          value = JSON.stringify(value);
        }
        return {
          key: m.key !== undefined && m.key !== null ? String(m.key) : null,
          value,
          headers: m.headers || {},
        };
      });

      return {
        topic: tm.topic,
        messages: preparedMessages,
      };
    });

    try {
      const result = await producer.sendBatch({
        topicMessages: preparedBatch,
        acks,
        timeout,
      });
      return result;
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to publish batch messages to Kafka');
      throw err;
    }
  }

  return {
    raw: producer,
    connect,
    disconnect,
    send,
    sendBatch,
    isConnected: () => connected,
  };
}

/**
 * Creates and wraps a Kafka consumer with subscriptions, error recovery, and deserialization.
 *
 * @param {Kafka} kafkaClient
 * @param {object} options
 * @param {string} options.groupId
 * @returns {object} Wrapped consumer
 */
function createConsumer(kafkaClient, options = {}) {
  const groupId = options.groupId || process.env.KAFKA_CONSUMER_GROUP_ID || 'finguard-default-group';

  const consumer = kafkaClient.consumer({
    groupId,
    retry: {
      initialRetryTime: 300,
      maxRetryTime: 30000,
      retries: 8,
      factor: 2,
      ...options.retry,
    },
    ...options,
  });

  let connected = false;

  async function connect(retries = 5, delayMs = 1000) {
    if (connected) return;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await consumer.connect();
        connected = true;
        logger.info({ groupId, attempt }, 'Kafka consumer connected successfully');
        return;
      } catch (err) {
        logger.warn({ groupId, attempt, retries, err: err.message }, 'Kafka consumer connection failed, retrying...');
        if (attempt === retries) {
          logger.error({ groupId, err }, 'Kafka consumer failed to connect after maximum retries');
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  async function disconnect() {
    if (!connected) return;
    try {
      await consumer.disconnect();
      connected = false;
      logger.info({ groupId }, 'Kafka consumer disconnected cleanly');
    } catch (err) {
      logger.error({ groupId, err: err.message }, 'Error disconnecting Kafka consumer');
      throw err;
    }
  }

  /**
   * Subscribes to topics.
   *
   * @param {object} params
   * @param {string|string[]} [params.topic]
   * @param {string[]} [params.topics]
   * @param {boolean} [params.fromBeginning=false]
   */
  async function subscribe({ topic, topics, fromBeginning = false }) {
    if (!connected) {
      await connect();
    }

    const topicList = topics || (topic ? (Array.isArray(topic) ? topic : [topic]) : []);
    if (topicList.length === 0) {
      throw new Error('Kafka consumer subscribe() requires at least one topic');
    }

    for (const t of topicList) {
      await consumer.subscribe({ topic: t, fromBeginning });
      logger.info({ topic: t, groupId, fromBeginning }, 'Kafka consumer subscribed to topic');
    }
  }

  /**
   * Runs the message consumption loop.
   *
   * @param {object} params
   * @param {function} [params.eachMessage] - async ({ topic, partition, message, key, parsedValue }) => void
   * @param {function} [params.eachBatch]
   * @param {boolean} [params.autoCommit=true]
   */
  async function run({ eachMessage, eachBatch, autoCommit = true }) {
    if (!connected) {
      await connect();
    }

    if (eachMessage) {
      await consumer.run({
        autoCommit,
        eachMessage: async (payload) => {
          const { topic, partition, message } = payload;
          const rawValue = message.value ? message.value.toString() : null;
          let parsedValue = rawValue;

          if (rawValue) {
            try {
              parsedValue = JSON.parse(rawValue);
            } catch {
              // Not JSON, leave as raw string
            }
          }

          const key = message.key ? message.key.toString() : null;

          try {
            await eachMessage({
              topic,
              partition,
              message,
              key,
              value: parsedValue,
              offset: message.offset,
              timestamp: message.timestamp,
              commitOffset: async () => {
                await consumer.commitOffsets([
                  { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
                ]);
              },
            });
          } catch (handlerErr) {
            logger.error(
              {
                topic,
                partition,
                offset: message.offset,
                key,
                err: handlerErr.message,
              },
              'Error in Kafka consumer message handler'
            );
            throw handlerErr;
          }
        },
      });
    } else if (eachBatch) {
      await consumer.run({
        autoCommit,
        eachBatch,
      });
    } else {
      throw new Error('Kafka consumer run() requires either eachMessage or eachBatch handler');
    }
  }

  async function commitOffsets(offsets) {
    if (!connected) {
      await connect();
    }
    return await consumer.commitOffsets(offsets);
  }

  return {
    raw: consumer,
    connect,
    disconnect,
    subscribe,
    run,
    commitOffsets,
    isConnected: () => connected,
  };
}

module.exports = {
  createKafkaClient,
  createProducer,
  createConsumer,
};
