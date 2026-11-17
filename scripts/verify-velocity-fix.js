const { spawn } = require('child_process');
const http = require('http');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const { createKafkaClient, TOPICS, createLogger } = require('../shared');

const logger = createLogger('velocity-fix-verification');

const INGESTION_PORT = 3001;
const RULE_ENGINE_PORT = 3002;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://root:example@localhost:27017/finguard?authSource=admin';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ statusCode: res.statusCode, raw: data });
          }
        });
      })
      .on('error', reject);
  });
}

async function waitForHttp(url, name, maxRetries = 30, intervalMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await httpGetJson(url);
      if (res.statusCode === 200) {
        logger.info({ name, url }, `${name} is up and healthy!`);
        return true;
      }
    } catch {}
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${name} at ${url}`);
}

async function getTotalTopicOffset(admin, topic) {
  const offsets = await admin.fetchTopicOffsets(topic);
  const total = offsets.reduce((sum, p) => sum + parseInt(p.high, 10), 0);
  return { total, partitions: offsets };
}

async function runVelocityFixVerification() {
  console.log('\n===============================================================');
  console.log('       FINGUARD: VERIFY VELOCITY FIX WITH 5,000 USER POOL       ');
  console.log('===============================================================\n');

  // 1. Reset MongoDB & Redis
  logger.info('Resetting MongoDB RULE_LARGE_AMOUNT to $10,000 threshold...');
  await mongoose.connect(MONGO_URI);
  const rulesCollection = mongoose.connection.collection('rules');
  await rulesCollection.updateOne(
    { ruleId: 'RULE_LARGE_AMOUNT' },
    { $set: { 'config.threshold': 10000, 'config.currency': 'USD', enabled: true } },
    { upsert: false }
  );

  const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
  await redis.flushall();
  logger.info('Flushed Redis sliding-window cache.');
  redis.disconnect();

  // 2. Fetch baseline Kafka offsets
  const kafka = createKafkaClient({
    clientId: 'velocity-fix-verifier',
    brokers: KAFKA_BROKERS,
  });
  const admin = kafka.admin();
  await admin.connect();
  const rawBase = await getTotalTopicOffset(admin, TOPICS.TRANSACTIONS_RAW);
  const flaggedBase = await getTotalTopicOffset(admin, TOPICS.TRANSACTIONS_FLAGGED);
  logger.info(
    { rawBase: rawBase.total, flaggedBase: flaggedBase.total },
    'Baseline Kafka topic offsets recorded'
  );

  // 3. Spawn Ingestion Service
  logger.info('Spawning Ingestion Service on port 3001...');
  const ingestionProc = spawn(process.execPath, ['services/ingestion/src/index.js'], {
    env: { ...process.env, PORT: INGESTION_PORT, LOG_LEVEL: 'warn' },
    stdio: 'inherit',
  });

  // 4. Spawn Rule Engine Service
  logger.info('Spawning Rule Engine Service on port 3002 (KAFKA_FROM_BEGINNING=false)...');
  const ruleEngineProc = spawn(process.execPath, ['services/rule-engine/src/index.js'], {
    env: { ...process.env, PORT: RULE_ENGINE_PORT, KAFKA_FROM_BEGINNING: 'false', LOG_LEVEL: 'warn' },
    stdio: 'inherit',
  });

  // Wait for both to be healthy
  await waitForHttp(`http://localhost:${INGESTION_PORT}/health`, 'Ingestion Service');
  await waitForHttp(`http://localhost:${RULE_ENGINE_PORT}/health`, 'Rule Engine Service');

  logger.info('Allowing 3s for Kafka consumer group rebalance and partition assignment...');
  await sleep(3000);

  // 5. Run Simulator: 100 txns/sec for 30s with --users 5000
  console.log('\n---------------------------------------------------------------');
  console.log('RUNNING SIMULATOR: 100 txns/sec, 30s, --users 5000');
  console.log('---------------------------------------------------------------\n');

  const simArgs = [
    'simulator/src/index.js',
    '--rate', '100',
    '--duration', '30',
    '--users', '5000',
    '--seed', 'finguard-day6-velocity-verify',
  ];

  let simOutput = '';
  const simProc = spawn(process.execPath, simArgs, {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  simProc.stdout.on('data', (d) => {
    const s = d.toString();
    simOutput += s;
    process.stdout.write(s);
  });
  simProc.stderr.on('data', (d) => process.stderr.write(d.toString()));

  await new Promise((resolve) => simProc.on('close', resolve));

  logger.info('Simulator process completed. Waiting 4s for Rule Engine consumer to flush...');
  await sleep(4000);

  // 6. Collect final metrics from Rule Engine
  const finalHealth = await httpGetJson(`http://localhost:${RULE_ENGINE_PORT}/health`);
  const finalProc = finalHealth.body.processor || {};

  const rawFinal = await getTotalTopicOffset(admin, TOPICS.TRANSACTIONS_RAW);
  const flaggedFinal = await getTotalTopicOffset(admin, TOPICS.TRANSACTIONS_FLAGGED);

  await admin.disconnect().catch(() => {});
  await mongoose.disconnect().catch(() => {});

  ingestionProc.kill('SIGTERM');
  ruleEngineProc.kill('SIGTERM');

  console.log('\n===============================================================');
  console.log('             VELOCITY FALSE POSITIVES FIX VERIFICATION         ');
  console.log('===============================================================\n');

  console.log('1. KAFKA TOPIC OFFSETS:');
  console.log(`   - transactions.raw:     ${rawBase.total} -> ${rawFinal.total} (+${rawFinal.total - rawBase.total} messages produced)`);
  console.log(`   - transactions.flagged: ${flaggedBase.total} -> ${flaggedFinal.total} (+${flaggedFinal.total - flaggedBase.total} alerts published)`);

  const totalConsumed = finalProc.totalConsumed || 0;
  const totalFlagged = finalProc.totalFlagged || 0;
  const flagRate = totalConsumed > 0 ? ((totalFlagged / totalConsumed) * 100).toFixed(2) : '0.00';

  console.log('\n2. RULE ENGINE PROCESSOR METRICS:');
  console.log(`   - Total Consumed:  ${totalConsumed}`);
  console.log(`   - Total Flagged:   ${totalFlagged} (${flagRate}% overall flag rate)`);
  console.log(`   - Total Clean:     ${finalProc.totalClean}`);
  console.log(`   - Total Malformed: ${finalProc.totalMalformed}`);

  console.log('\n3. FLAGGED BREAKDOWN BY RULE TYPE:');
  const byRule = finalProc.flaggedByRule || {};
  console.log(`   - RULE_LARGE_AMOUNT:         ${byRule['RULE_LARGE_AMOUNT'] || 0}`);
  console.log(`   - RULE_SUSPICIOUS_MERCHANT:  ${byRule['RULE_SUSPICIOUS_MERCHANT'] || 0}`);
  console.log(`   - RULE_VELOCITY:             ${byRule['RULE_VELOCITY'] || 0}`);
  console.log(`   - RULE_LOCATION_JUMP:        ${byRule['RULE_LOCATION_JUMP'] || 0}`);

  console.log('\n===============================================================');
  console.log(`EXPECTED: Total flag rate 10-15%, velocity flags close to burst count.`);
  console.log(`ACTUAL:   ${flagRate}% total flag rate, ${byRule['RULE_VELOCITY'] || 0} velocity flags.`);
  console.log('===============================================================\n');
}

runVelocityFixVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Velocity verification failed:', err);
    process.exit(1);
  });
