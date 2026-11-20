const { spawn } = require('child_process');
const http = require('http');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const { createKafkaClient, createConsumer, TOPICS, createLogger } = require('../shared');

const logger = createLogger('day6-new-rule-verifier');

const INGESTION_PORT = 3001;
const RULE_ENGINE_PORT = 3002;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://root:example@localhost:27017/finguard?authSource=admin';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpPostJson(url, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let resp = '';
        res.on('data', (c) => (resp += c));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(resp) });
          } catch {
            resolve({ statusCode: res.statusCode, raw: resp });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let resp = '';
        res.on('data', (c) => (resp += c));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(resp) });
          } catch {
            resolve({ statusCode: res.statusCode, raw: resp });
          }
        });
      })
      .on('error', reject);
  });
}

async function waitForHttp(url, name, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await httpGetJson(url);
      if (res.statusCode === 200) return true;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${name} at ${url}`);
}

async function runDay6Verification() {
  console.log('\n===============================================================');
  console.log('    FINGUARD DAY 6: DYNAMIC NEW RULE CREATION & LIVE DETECT    ');
  console.log('===============================================================\n');

  // 1. Reset Redis & ensure MongoDB connected
  await mongoose.connect(MONGO_URI);
  const rulesCollection = mongoose.connection.collection('rules');

  // Clean up any old test rule
  const newRuleId = 'RULE_TECH_STORE_MONITOR';
  await rulesCollection.deleteOne({ ruleId: newRuleId });

  const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
  await redis.flushall();

  // 2. Start Kafka consumer for transactions.flagged
  const kafka = createKafkaClient({
    clientId: 'day6-verifier',
    brokers: KAFKA_BROKERS,
  });
  const flagConsumer = createConsumer(kafka, {
    groupId: `day6-new-rule-group-${Date.now()}`,
  });
  await flagConsumer.connect();
  await flagConsumer.subscribe({ topic: TOPICS.TRANSACTIONS_FLAGGED, fromBeginning: false });

  const matchedNewRuleAlerts = [];
  await flagConsumer.run({
    eachMessage: async ({ message, value }) => {
      if (value && Array.isArray(value.matchedRules)) {
        const found = value.matchedRules.find((r) => r.ruleId === newRuleId);
        if (found) {
          matchedNewRuleAlerts.push(value);
        }
      }
    },
  });

  // 3. Spawn Ingestion & Rule Engine
  const ingestionProc = spawn(process.execPath, ['services/ingestion/src/index.js'], {
    env: { ...process.env, PORT: INGESTION_PORT, LOG_LEVEL: 'warn' },
    stdio: 'ignore',
  });
  const ruleEngineProc = spawn(process.execPath, ['services/rule-engine/src/index.js'], {
    env: { ...process.env, PORT: RULE_ENGINE_PORT, KAFKA_FROM_BEGINNING: 'false', LOG_LEVEL: 'info' },
    stdio: 'inherit',
  });

  await waitForHttp(`http://localhost:${INGESTION_PORT}/health`, 'Ingestion Service');
  await waitForHttp(`http://localhost:${RULE_ENGINE_PORT}/health`, 'Rule Engine Service');
  await sleep(3000); // Consumer group assignment

  console.log('Services running. Active rules at boot: 4 initial rules.\n');

  // --------------------------------------------------------------------------
  // STEP 1: Create a NEW RULE via POST /rules against live service
  // --------------------------------------------------------------------------
  const newRulePayload = {
    ruleId: newRuleId,
    name: 'Apple & Steam Merchant Purchasing Monitor',
    description: 'Dynamically flags electronic and gaming platforms in real time',
    type: 'merchant_regex',
    severity: 'MEDIUM',
    enabled: true,
    config: {
      pattern: '(Apple Store|Steam Games)',
    },
  };

  const createTimestamp = new Date().toISOString();
  console.log(`[${createTimestamp}] Sending POST http://localhost:${RULE_ENGINE_PORT}/rules...`);
  const createRes = await httpPostJson(`http://localhost:${RULE_ENGINE_PORT}/rules`, newRulePayload);

  console.log(`[POST /rules Response]: Status ${createRes.statusCode}`, JSON.stringify(createRes.body, null, 2));

  if (createRes.statusCode !== 201) {
    throw new Error(`Failed to create rule: ${JSON.stringify(createRes.body)}`);
  }

  // Wait 1.5s for Redis pub/sub reload to take effect atomically
  await sleep(1500);

  // --------------------------------------------------------------------------
  // STEP 2: Run Simulator traffic to produce normal transactions
  // --------------------------------------------------------------------------
  console.log('\n---------------------------------------------------------------');
  console.log('Running simulator at 100 txns/sec for 15s (--users 5000)...');
  console.log('Expecting new rule RULE_TECH_STORE_MONITOR to flag Apple Store & Steam transactions!');
  console.log('---------------------------------------------------------------\n');

  const simArgs = [
    'simulator/src/index.js',
    '--rate', '100',
    '--duration', '15',
    '--users', '5000',
    '--seed', 'finguard-day6-new-rule-test',
  ];

  const simProc = spawn(process.execPath, simArgs, {
    env: { ...process.env },
    stdio: 'inherit',
  });

  await new Promise((resolve) => simProc.on('close', resolve));
  await sleep(3000); // Allow consumer to commit

  // --------------------------------------------------------------------------
  // STEP 3: Verify and display results
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log('                 DAY 6 "DONE WHEN" VERIFICATION                ');
  console.log('===============================================================\n');

  console.log(`1. NEW RULE CREATION:`);
  console.log(`   - Rule ID:   ${newRuleId}`);
  console.log(`   - Rule Type: merchant_regex`);
  console.log(`   - Pattern:   (Apple Store|Steam Games)`);
  console.log(`   - Severity:  MEDIUM (riskScore base = 50)`);

  console.log(`\n2. FLAGGED TRANSACTIONS CAUSED BY NEW RULE (NO RESTART):`);
  console.log(`   - Total Alerts Triggered by ${newRuleId}: ${matchedNewRuleAlerts.length}`);

  if (matchedNewRuleAlerts.length === 0) {
    throw new Error('FAILED: No alerts were generated by the new rule');
  }

  console.log(`\n3. SAMPLE ALERT PUBLISHED TO KAFKA BY NEW RULE:`);
  const sampleAlert = matchedNewRuleAlerts[0];
  console.log(JSON.stringify(sampleAlert, null, 2));

  // Cleanup
  await flagConsumer.disconnect().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  redis.disconnect();

  ingestionProc.kill('SIGTERM');
  ruleEngineProc.kill('SIGTERM');

  console.log('\n===============================================================');
  console.log('       DAY 6 NEW RULE CREATION & LIVE DETECT VERIFIED!         ');
  console.log('===============================================================\n');
}

runDay6Verification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Day 6 verification failed:', err);
    process.exit(1);
  });
