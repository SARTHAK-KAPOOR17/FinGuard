const { createKafkaClient, createProducer, createConsumer, TOPICS } = require('../shared');
const { createLogger } = require('../shared/logger');

const logger = createLogger('kafka-roundtrip-test');

async function runKafkaRoundtripTest() {
  const topic = TOPICS.TRANSACTIONS_RAW;
  const correlationId = `roundtrip-${Date.now()}`;
  const testPayload = {
    txnId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    userId: 'usr_roundtrip_test_42',
    amount: 199.99,
    currency: 'USD',
    merchant: 'Roundtrip Test Merchant',
    location: {
      city: 'San Francisco',
      country: 'USA',
      lat: 37.7749,
      lng: -122.4194,
    },
    deviceId: 'dev_roundtrip_test_99',
    timestamp: new Date().toISOString(),
    _meta: {
      correlationId,
      sentAt: Date.now(),
    },
  };

  logger.info({ topic, correlationId }, 'Starting Kafka roundtrip test...');

  const kafka = createKafkaClient({
    clientId: `roundtrip-test-client-${Date.now()}`,
    brokers: process.env.KAFKA_BROKERS || 'localhost:9092',
  });

  const uniqueGroupId = `roundtrip-group-${Date.now()}`;
  const consumer = createConsumer(kafka, { groupId: uniqueGroupId });
  const producer = createProducer(kafka);

  let messageReceivedPromiseResolve;
  let messageReceivedPromiseReject;
  const messageReceivedPromise = new Promise((resolve, reject) => {
    messageReceivedPromiseResolve = resolve;
    messageReceivedPromiseReject = reject;
  });

  const timeoutHandle = setTimeout(() => {
    messageReceivedPromiseReject(
      new Error(`Timed out waiting for test message with correlationId ${correlationId} after 20 seconds`)
    );
  }, 20000);

  try {
    // 1. Connect and start consumer
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic: msgTopic, partition, key, value, offset, timestamp }) => {
        if (value && typeof value === 'object' && value._meta && value._meta.correlationId === correlationId) {
          const latencyMs = Date.now() - value._meta.sentAt;
          logger.info(
            {
              topic: msgTopic,
              partition,
              offset,
              key,
              correlationId,
              latencyMs: `${latencyMs}ms`,
              receivedTxnId: value.txnId,
              receivedUserId: value.userId,
              receivedAmount: value.amount,
            },
            '>>> Kafka consumer SUCCESSFULLY received the test message!'
          );
          clearTimeout(timeoutHandle);
          messageReceivedPromiseResolve({ partition, offset, key, value, latencyMs });
        }
      },
    });

    // Brief wait to ensure Kafka consumer group rebalance and partition assignment complete
    logger.info('Waiting 2 seconds for consumer group partition assignment...');
    await new Promise((r) => setTimeout(r, 2000));

    // 2. Connect producer and send message
    await producer.connect();
    const sentTime = Date.now();
    logger.info(
      {
        topic,
        key: testPayload.userId,
        txnId: testPayload.txnId,
        correlationId,
      },
      '>>> Kafka producer SENDING test message...'
    );

    const recordMetadata = await producer.send({
      topic,
      messages: [
        {
          key: testPayload.userId,
          value: testPayload,
        },
      ],
    });

    logger.info({ recordMetadata }, '>>> Kafka producer sent message confirmed by broker');

    // 3. Wait for consumer to process message
    const result = await messageReceivedPromise;

    console.log('\n======================================================');
    console.log('KAFKA ROUNDTRIP TEST PASSED SUCCESSFULLY!');
    console.log(`Topic:        ${topic}`);
    console.log(`Partition:    ${result.partition}`);
    console.log(`Offset:       ${result.offset}`);
    console.log(`Key:          ${result.key}`);
    console.log(`Txn ID:       ${result.value.txnId}`);
    console.log(`User ID:      ${result.value.userId}`);
    console.log(`Amount:       $${result.value.amount} ${result.value.currency}`);
    console.log(`Roundtrip:    ${result.latencyMs} ms`);
    console.log('======================================================\n');
  } finally {
    clearTimeout(timeoutHandle);
    await producer.disconnect().catch(() => {});
    await consumer.disconnect().catch(() => {});
  }
}

if (require.main === module) {
  runKafkaRoundtripTest()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err.message, stack: err.stack }, 'Kafka roundtrip test failed');
      console.error('KAFKA ROUNDTRIP TEST FAILED:', err);
      process.exit(1);
    });
}

module.exports = { runKafkaRoundtripTest };
