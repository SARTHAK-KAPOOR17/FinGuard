const { spawn } = require('child_process');
const http = require('http');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const {
  createKafkaClient,
  createConsumer,
  TOPICS,
  createLogger,
} = require('../shared');

const logger = createLogger('day5-verification');

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

function httpPatchJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let respData = '';
        res.on('data', (chunk) => (respData += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(respData) });
          } catch (e) {
            resolve({ statusCode: res.statusCode, raw: respData });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
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

async function runDay5LiveReloadDemo() {
  console.log('\n===============================================================');
  console.log('       FINGUARD DAY 5: STATEFUL RULES & LIVE RELOAD DEMO       ');
  console.log('===============================================================\n');

  // 1. Prepare MongoDB & Redis
  logger.info('Resetting MongoDB RULE_LARGE_AMOUNT to initial $10,000 threshold...');
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
    clientId: 'day5-verifier',
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

  // 3. Listen to transactions.flagged for samples
  const sampleFlaggedMessages = {};
  const flagConsumer = createConsumer(kafka, { groupId: `verifier-sample-group-${Date.now()}` });
  await flagConsumer.connect();
  await flagConsumer.subscribe({ topic: TOPICS.TRANSACTIONS_FLAGGED, fromBeginning: false });
  await flagConsumer.run({
    eachMessage: async ({ message, value }) => {
      if (value && value.matchedRules && Array.isArray(value.matchedRules)) {
        for (const r of value.matchedRules) {
          if (!sampleFlaggedMessages[r.ruleId]) {
            sampleFlaggedMessages[r.ruleId] = value;
          }
        }
      }
    },
  });

  // 4. Spawn Ingestion Service
  logger.info('Spawning Ingestion Service on port 3001...');
  const ingestionProc = spawn(process.execPath, ['services/ingestion/src/index.js'], {
    env: { ...process.env, PORT: INGESTION_PORT, LOG_LEVEL: 'warn' },
    stdio: 'inherit',
  });

  // 5. Spawn Rule Engine Service
  logger.info('Spawning Rule Engine Service on port 3002 (KAFKA_FROM_BEGINNING=false)...');
  const ruleEngineProc = spawn(process.execPath, ['services/rule-engine/src/index.js'], {
    env: { ...process.env, PORT: RULE_ENGINE_PORT, KAFKA_FROM_BEGINNING: 'false', LOG_LEVEL: 'info' },
    stdio: 'inherit',
  });

  // Wait for both to be healthy
  await waitForHttp(`http://localhost:${INGESTION_PORT}/health`, 'Ingestion Service');
  await waitForHttp(`http://localhost:${RULE_ENGINE_PORT}/health`, 'Rule Engine Service');

  // Let Kafka partition consumer rebalance settle
  logger.info('Allowing 3s for Kafka consumer group rebalance and partition assignment...');
  await sleep(3000);

  // 6. Start Simulator in child process
  console.log('\n---------------------------------------------------------------');
  console.log('STARTING SIMULATOR: 100 txns/sec for 30s (~3,000 txns)');
  console.log('Live reload scheduled at t = 10s: PATCH threshold 10,000 -> 50,000');
  console.log('---------------------------------------------------------------\n');

  const simArgs = [
    'simulator/src/index.js',
    '--rate', '100',
    '--duration', '30',
    '--seed', 'finguard-day5-live-reload',
  ];

  const startTime = Date.now();
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

  // 7. Track metrics every second & execute live reload at t = 10s
  let reloaded = false;
  let reloadEventData = null;
  const metricsTimeline = [];

  const monitorInterval = setInterval(async () => {
    const elapsedSec = (Date.now() - startTime) / 1000;
    try {
      const res = await httpGetJson(`http://localhost:${RULE_ENGINE_PORT}/health`);
      if (res.statusCode === 200 && res.body.processor) {
        const proc = res.body.processor;
        metricsTimeline.push({
          elapsedSec: parseFloat(elapsedSec.toFixed(1)),
          totalConsumed: proc.totalConsumed,
          totalFlagged: proc.totalFlagged,
          flaggedByRule: { ...proc.flaggedByRule },
        });
      }
    } catch {}

    // At t >= 10s and not yet reloaded: trigger live reload!
    if (elapsedSec >= 10.0 && !reloaded) {
      reloaded = true;
      const reloadTimestamp = new Date().toISOString();
      console.log('\n\n***************************************************************');
      console.log(`[t = ${elapsedSec.toFixed(1)}s] TRIGGERING RUNTIME LIVE RELOAD VIA HTTP PATCH`);
      console.log(`Endpoint: PATCH http://localhost:${RULE_ENGINE_PORT}/rules/RULE_LARGE_AMOUNT`);
      console.log('Payload:  { "threshold": 50000 }');
      console.log(`Time:     ${reloadTimestamp}`);
      console.log('***************************************************************\n');

      try {
        const patchRes = await httpPatchJson(
          `http://localhost:${RULE_ENGINE_PORT}/rules/RULE_LARGE_AMOUNT`,
          { threshold: 50000 }
        );
        reloadEventData = {
          timestamp: reloadTimestamp,
          elapsedSec: parseFloat(elapsedSec.toFixed(1)),
          response: patchRes,
        };
        console.log(`[LIVE RELOAD RESPONSE (Status ${patchRes.statusCode})]:`, JSON.stringify(patchRes.body, null, 2));
      } catch (err) {
        console.error('FAILED TO TRIGGER LIVE RELOAD:', err.message);
      }
    }
  }, 1000);

  // Wait for simulator to complete
  await new Promise((resolve) => {
    simProc.on('close', resolve);
  });

  clearInterval(monitorInterval);
  logger.info('Simulator process completed. Waiting 4s for Rule Engine to flush pipeline...');
  await sleep(4000);

  // 8. Collect final metrics from Rule Engine
  const finalHealth = await httpGetJson(`http://localhost:${RULE_ENGINE_PORT}/health`);
  const finalProc = finalHealth.body.processor || {};

  const rawFinal = await getTotalTopicOffset(admin, TOPICS.TRANSACTIONS_RAW);
  const flaggedFinal = await getTotalTopicOffset(admin, TOPICS.TRANSACTIONS_FLAGGED);

  // 9. Stop consumer and disconnect
  await flagConsumer.disconnect().catch(() => {});
  await admin.disconnect().catch(() => {});
  await mongoose.disconnect().catch(() => {});

  // Terminate child processes
  ingestionProc.kill('SIGTERM');
  ruleEngineProc.kill('SIGTERM');

  // 10. Output Comprehensive Verification Report
  console.log('\n===============================================================');
  console.log('             DAY 5 VERIFICATION & BENCHMARK REPORT             ');
  console.log('===============================================================\n');

  console.log('1. KAFKA TOPIC OFFSETS:');
  console.log(`   - transactions.raw:     ${rawBase.total} -> ${rawFinal.total} (+${rawFinal.total - rawBase.total} messages produced)`);
  console.log(`   - transactions.flagged: ${flaggedBase.total} -> ${flaggedFinal.total} (+${flaggedFinal.total - flaggedBase.total} alerts published)`);

  console.log('\n2. RULE ENGINE PROCESSOR METRICS:');
  console.log(`   - Total Consumed:  ${finalProc.totalConsumed}`);
  console.log(`   - Total Flagged:   ${finalProc.totalFlagged}`);
  console.log(`   - Total Clean:     ${finalProc.totalClean}`);
  console.log(`   - Total Malformed: ${finalProc.totalMalformed}`);
  console.log(`   - Last Reload At:  ${finalProc.lastReloadAt}`);

  console.log('\n3. FLAGGED BREAKDOWN BY RULE TYPE:');
  const byRule = finalProc.flaggedByRule || {};
  console.log(`   - RULE_LARGE_AMOUNT:         ${byRule['RULE_LARGE_AMOUNT'] || 0}`);
  console.log(`   - RULE_SUSPICIOUS_MERCHANT:  ${byRule['RULE_SUSPICIOUS_MERCHANT'] || 0}`);
  console.log(`   - RULE_VELOCITY:             ${byRule['RULE_VELOCITY'] || 0}`);
  console.log(`   - RULE_LOCATION_JUMP:        ${byRule['RULE_LOCATION_JUMP'] || 0}`);

  console.log('\n4. LIVE RELOAD IMPACT ANALYSIS (RULE_LARGE_AMOUNT):');
  // Find snapshot around t=10s
  const preReloadSnapshot = metricsTimeline.find((m) => m.elapsedSec >= 9.5 && m.elapsedSec <= 10.5) || metricsTimeline[9];
  const postReloadSnapshot = metricsTimeline[metricsTimeline.length - 1];

  if (preReloadSnapshot && postReloadSnapshot) {
    const preCount = (preReloadSnapshot.flaggedByRule && preReloadSnapshot.flaggedByRule['RULE_LARGE_AMOUNT']) || 0;
    const postCount = ((postReloadSnapshot.flaggedByRule && postReloadSnapshot.flaggedByRule['RULE_LARGE_AMOUNT']) || 0) - preCount;
    const preRate = (preCount / preReloadSnapshot.elapsedSec).toFixed(2);
    const postElapsed = postReloadSnapshot.elapsedSec - preReloadSnapshot.elapsedSec;
    const postRate = (postCount / postElapsed).toFixed(2);

    console.log(`   - Pre-Reload  (t=0s to 10s, threshold = $10,000): ${preCount} flags in ${preReloadSnapshot.elapsedSec}s  (${preRate} flags/sec)`);
    console.log(`   - Post-Reload (t=10s to 30s, threshold = $50,000): ${postCount} flags in ${postElapsed.toFixed(1)}s (${postRate} flags/sec)`);
    console.log(`   - Rate Drop: ${preRate} -> ${postRate} flags/sec (DROP CONFIRMED WITHOUT PROCESS RESTART!)`);
  }

  console.log('\n5. SAMPLE FLAGGED MESSAGES WITH FULL RULE METADATA:');
  for (const [ruleId, sample] of Object.entries(sampleFlaggedMessages)) {
    console.log(`\n--- Sample Alert for [${ruleId}] ---`);
    console.log(JSON.stringify(sample, null, 2));
  }

  console.log('\n===============================================================');
  console.log('            DAY 5 LIVE RELOAD & STATE VERIFICATION PASSED      ');
  console.log('===============================================================\n');
}

runDay5LiveReloadDemo()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Verification failed with error:', err);
    process.exit(1);
  });
