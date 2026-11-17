const Redis = require('ioredis');
const { createLogger } = require('@finguard/shared');
const config = require('../config');

const logger = createLogger(config.serviceName);

let redisClient = null;
let redisSubscriber = null;
let redisPublisher = null;

function createClientInstance(role = 'default') {
  const client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    lazyConnect: true,
    retryStrategy(times) {
      const delay = Math.min(times * 500, 3000);
      return delay;
    },
  });

  client.on('error', (err) => {
    logger.error({ role, err: err.message }, 'Redis connection error');
  });

  return client;
}

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClientInstance('command');
    await redisClient.connect();
    logger.info('Connected to Redis (command client)');
  }
  return redisClient;
}

async function getRedisSubscriber() {
  if (!redisSubscriber) {
    redisSubscriber = createClientInstance('subscriber');
    await redisSubscriber.connect();
    logger.info('Connected to Redis (subscriber client)');
  }
  return redisSubscriber;
}

async function getRedisPublisher() {
  if (!redisPublisher) {
    redisPublisher = createClientInstance('publisher');
    await redisPublisher.connect();
    logger.info('Connected to Redis (publisher client)');
  }
  return redisPublisher;
}

async function disconnectRedis() {
  const disconnects = [];
  if (redisClient) {
    disconnects.push(redisClient.quit().catch(() => redisClient.disconnect()));
    redisClient = null;
  }
  if (redisSubscriber) {
    disconnects.push(redisSubscriber.quit().catch(() => redisSubscriber.disconnect()));
    redisSubscriber = null;
  }
  if (redisPublisher) {
    disconnects.push(redisPublisher.quit().catch(() => redisPublisher.disconnect()));
    redisPublisher = null;
  }
  await Promise.all(disconnects);
  logger.info('Disconnected all Redis clients');
}

module.exports = {
  getRedisClient,
  getRedisSubscriber,
  getRedisPublisher,
  disconnectRedis,
};
