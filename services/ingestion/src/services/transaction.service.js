const {
  createKafkaClient,
  createProducer,
  validateTransaction,
  validateBatchItems,
  TOPICS,
} = require('@finguard/shared');
const config = require('../config');
const { logger } = require('../app');

class TransactionService {
  constructor(producer = null) {
    this.producer = producer;
    this.kafka = null;
    this.rawTopic = config.kafka.rawTopic || TOPICS.TRANSACTIONS_RAW;
  }

  /**
   * Initializes the Kafka producer if not already initialized.
   */
  async getProducer() {
    if (this.producer) {
      return this.producer;
    }

    this.kafka = createKafkaClient({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
    });

    this.producer = createProducer(this.kafka);
    await this.producer.connect();
    return this.producer;
  }

  /**
   * Processes a single transaction ingestion request.
   *
   * @param {object} payload
   * @returns {Promise<{ success: boolean, statusCode: number, data: object }>}
   */
  async ingestSingleTransaction(payload) {
    const { error, value } = validateTransaction(payload);

    if (error) {
      return {
        success: false,
        statusCode: 400,
        data: {
          error: 'ValidationError',
          message: 'Invalid transaction payload',
          details: error,
        },
      };
    }

    try {
      const producer = await this.getProducer();
      await producer.send({
        topic: this.rawTopic,
        messages: [
          {
            key: value.userId,
            value,
          },
        ],
      });

      return {
        success: true,
        statusCode: 202,
        data: {
          status: 'accepted',
          message: 'Transaction accepted and queued for processing',
          txnId: value.txnId,
        },
      };
    } catch (err) {
      logger.error({ err: err.message, txnId: value.txnId }, 'Failed to queue transaction to Kafka');
      return {
        success: false,
        statusCode: 500,
        data: {
          error: 'IngestionError',
          message: 'Failed to process transaction',
        },
      };
    }
  }

  /**
   * Processes a batch transaction ingestion request.
   *
   * @param {Array|object} payload
   * @returns {Promise<{ success: boolean, statusCode: number, data: object }>}
   */
  async ingestBatchTransactions(payload) {
    const { validItems, errors, batchError } = validateBatchItems(payload);

    if (batchError) {
      return {
        success: false,
        statusCode: 400,
        data: {
          error: 'ValidationError',
          message: batchError,
        },
      };
    }

    // If no valid items at all, reject immediately
    if (validItems.length === 0) {
      return {
        success: false,
        statusCode: 400,
        data: {
          error: 'ValidationError',
          message: 'All transactions in batch failed validation',
          errors,
        },
      };
    }

    // Publish valid items using a single producer.sendBatch call
    try {
      const producer = await this.getProducer();
      const messages = validItems.map(({ item }) => ({
        key: item.userId,
        value: item,
      }));

      await producer.sendBatch({
        topicMessages: [
          {
            topic: this.rawTopic,
            messages,
          },
        ],
      });

      const responseStatus = errors.length > 0 ? 202 : 202;
      return {
        success: true,
        statusCode: responseStatus,
        data: {
          status: errors.length > 0 ? 'partially_accepted' : 'accepted',
          message:
            errors.length > 0
              ? `Accepted ${validItems.length} transactions, rejected ${errors.length} invalid transactions`
              : `Successfully accepted all ${validItems.length} transactions`,
          acceptedCount: validItems.length,
          rejectedCount: errors.length,
          errors: errors.length > 0 ? errors : undefined,
        },
      };
    } catch (err) {
      logger.error({ err: err.message, validCount: validItems.length }, 'Failed to publish transaction batch to Kafka');
      return {
        success: false,
        statusCode: 500,
        data: {
          error: 'IngestionError',
          message: 'Failed to publish transaction batch',
        },
      };
    }
  }

  async disconnect() {
    if (this.producer) {
      await this.producer.disconnect().catch(() => {});
      this.producer = null;
    }
  }
}

module.exports = new TransactionService();
