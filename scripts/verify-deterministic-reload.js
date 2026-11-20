const { spawn } = require('child_process');
const http = require('http');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const { createKafkaClient, createConsumer, TOPICS, createLogger } = require('../shared');

const logger = createLogger('deterministic-reload-verifier');

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

function httpPatchJson(url, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'PATCH',
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

async function runDeterministicReloadProof() {
  console.log('\n===============================================================');
  console.log('       FINGUARD: DETERMINISTIC LIVE RELOAD PROOF SCRIPT        ');
  console.log('===============================================================\n');

  // 1. Reset MongoDB & Redis
  await mongoose.connect(MONGO_URI);
  const rulesCollection = mongoose.connection.collection('rules');
  await rulesCollection.updateOne(
    { ruleId: 'RULE_LARGE_AMOUNT' },
    { $set: { 'config.threshold': 10000, 'config.currency': 'USD', enabled: true } },
    { upsert: false }
  );

  const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
  await redis.flushall();

  // 2. Start Kafka listener for transactions.flagged
  const kafka = createKafkaClient({
    clientId: 'deterministic-reload-verifier',
    brokers: KAFKA_BROKERS,
  });
  const flagConsumer = createConsumer(kafka, {
    groupId: `deterministic-verifier-group-${Date.now()}`,
  });
  await flagConsumer.connect();
  await flagConsumer.subscribe({ topic: TOPICS.TRANSACTIONS_FLAGGED, fromBeginning: false });

  const capturedFlags = [];
  await flagConsumer.run({
    eachMessage: async ({ message, value }) => {
      if (value && value.txnId) {
        capturedFlags.push(value);
      }
    },
  });

  // 3. Spawn Ingestion & Rule Engine
  const ingestionProc = spawn(process.execPath, ['services/ingestion/src/index.js'], {
    env: { ...process.env, PORT: INGESTION_PORT, LOG_LEVEL: 'warn' },
    stdio: 'ignore',
  });
  const ruleEngineProc = spawn(process.execPath, ['services/rule-engine/src/index.js'], {
    env: { ...process.env, PORT: RULE_ENGINE_PORT, KAFKA_FROM_BEGINNING: 'false', LOG_LEVEL: 'warn' },
    stdio: 'ignore',
  });

  await waitForHttp(`http://localhost:${INGESTION_PORT}/health`, 'Ingestion Service');
  await waitForHttp(`http://localhost:${RULE_ENGINE_PORT}/health`, 'Rule Engine Service');
  await sleep(3000); // Consumer group assignment

  console.log('Services ready. Initial state: RULE_LARGE_AMOUNT threshold = $10,000 USD\n');

  // --------------------------------------------------------------------------
  // STEP A: Send $20,000 USD transaction -> Expect FLAGGED (threshold 10,000)
  // --------------------------------------------------------------------------
  const txnA = {
    txnId: randomUUID(),
    userId: 'usr_det_test_A',
    amount: 20000.0,
    currency: 'USD',
    merchant: 'Standard Retail Goods Store',
    location: { city: 'New York', country: 'USA', lat: 40.7128, lng: -74.006 },
    deviceId: 'dev_det_test_A',
    timestamp: new Date().toISOString(),
  };

  const timeA = new Date().toISOString();
  console.log(`[${timeA}] [STEP A] Sending fixed $20,000 USD transaction: ${txnA.txnId}`);
  const postResA = await httpPostJson(`http://localhost:${INGESTION_PORT}/transactions`, txnA);
  console.log(`[STEP A] Ingestion response status: ${postResA.statusCode} (${postResA.body.status})`);

  // Wait for flagged event in Kafka
  let flagA = null;
  for (let i = 0; i < 20; i++) {
    flagA = capturedFlags.find((f) => f.txnId === txnA.txnId);
    if (flagA) break;
    await sleep(250);
  }

  if (flagA) {
    const match = flagA.matchedRules.find((r) => r.ruleId === 'RULE_LARGE_AMOUNT');
    console.log(`[${flagA.flaggedAt}] [STEP A RESULT] >>> FLAGGED as expected!`);
    console.log(`  Rule: ${match.ruleId} | Severity: ${match.severity}`);
    console.log(`  Reason: "${match.reason}"\n`);
  } else {
    throw new Error('STEP A FAILED: Transaction was not flagged by RULE_LARGE_AMOUNT');
  }

  // --------------------------------------------------------------------------
  // STEP B: PATCH threshold to $50,000 via REST API & verify reload
  // --------------------------------------------------------------------------
  const timePatch = new Date().toISOString();
  console.log(`[${timePatch}] [STEP B] PATCHing threshold from $10,000 -> $50,000 via HTTP PATCH /rules/RULE_LARGE_AMOUNT...`);
  const patchRes = await httpPatchJson(`http://localhost:${RULE_ENGINE_PORT}/rules/RULE_LARGE_AMOUNT`, {
    threshold: 50000,
  });
  console.log(`[${new Date().toISOString()}] [STEP B] PATCH response (${patchRes.statusCode}):`, patchRes.body.message);
  console.log(`  Updated Config:`, patchRes.body.rule.config);

  await sleep(1000); // Give processor atomic reload a moment to settle

  // Send same-shaped $20,000 transaction with new txnId -> Expect NOT FLAGGED
  const txnB = {
    txnId: randomUUID(),
    userId: 'usr_det_test_B',
    amount: 20000.0,
    currency: 'USD',
    merchant: 'Standard Retail Goods Store',
    location: { city: 'New York', country: 'USA', lat: 40.7128, lng: -74.006 },
    deviceId: 'dev_det_test_B',
    timestamp: new Date().toISOString(),
  };

  const timeB = new Date().toISOString();
  console.log(`\n[${timeB}] [STEP B] Sending identical $20,000 USD transaction with new txnId: ${txnB.txnId}`);
  const postResB = await httpPostJson(`http://localhost:${INGESTION_PORT}/transactions`, txnB);
  console.log(`[STEP B] Ingestion response status: ${postResB.statusCode} (${postResB.body.status})`);

  // Wait 3 seconds to confirm it is NOT flagged
  await sleep(3000);
  const flagB = capturedFlags.find((f) => f.txnId === txnB.txnId);

  if (!flagB) {
    console.log(`[${new Date().toISOString()}] [STEP B RESULT] >>> CLEAN as expected! $20,000 did NOT trigger RULE_LARGE_AMOUNT (threshold is now $50,000).\n`);
  } else {
    throw new Error('STEP B FAILED: Transaction was unexpectedly flagged after threshold increased to 50,000');
  }

  // --------------------------------------------------------------------------
  // STEP C: Direct MongoDB update + Redis Pub/Sub channel 'rules:updated'
  // --------------------------------------------------------------------------
  const timeMongo = new Date().toISOString();
  console.log(`[${timeMongo}] [STEP C] Direct MongoDB update: Setting threshold to $15,000...`);
  await rulesCollection.updateOne(
    { ruleId: 'RULE_LARGE_AMOUNT' },
    { $set: { 'config.threshold': 15000, updatedAt: new Date() } }
  );

  const timePub = new Date().toISOString();
  console.log(`[${timePub}] [STEP C] Publishing reload notification to Redis channel 'rules:updated'...`);
  const pubSubMsg = JSON.stringify({
    action: 'UPDATE_RULE',
    ruleId: 'RULE_LARGE_AMOUNT',
    updatedAt: timePub,
  });
  await redis.publish('rules:updated', pubSubMsg);

  // Wait for Redis subscriber in rule-engine to receive and atomically swap evaluator
  await sleep(1500);

  // Test C1: $18,000 transaction -> Expect FLAGGED (since threshold is now 15,000)
  const txnC1 = {
    txnId: randomUUID(),
    userId: 'usr_det_test_C1',
    amount: 18000.0,
    currency: 'USD',
    merchant: 'Standard Retail Goods Store',
    location: { city: 'New York', country: 'USA', lat: 40.7128, lng: -74.006 },
    deviceId: 'dev_det_test_C1',
    timestamp: new Date().toISOString(),
  };

  const timeC1 = new Date().toISOString();
  console.log(`[${timeC1}] [STEP C1] Sending $18,000 transaction: ${txnC1.txnId} (Threshold = $15,000)`);
  await httpPostJson(`http://localhost:${INGESTION_PORT}/transactions`, txnC1);

  let flagC1 = null;
  for (let i = 0; i < 20; i++) {
    flagC1 = capturedFlags.find((f) => f.txnId === txnC1.txnId);
    if (flagC1) break;
    await sleep(250);
  }

  if (flagC1) {
    const match = flagC1.matchedRules.find((r) => r.ruleId === 'RULE_LARGE_AMOUNT');
    console.log(`[${flagC1.flaggedAt}] [STEP C1 RESULT] >>> FLAGGED via Redis pub/sub reload!`);
    console.log(`  Rule: ${match.ruleId} | Reason: "${match.reason}"\n`);
  } else {
    throw new Error('STEP C1 FAILED: $18,000 transaction was not flagged after MongoDB + Redis Pub/Sub reload');
  }

  // Test C2: $12,000 transaction -> Expect NOT FLAGGED (since threshold is 15,000)
  const txnC2 = {
    txnId: randomUUID(),
    userId: 'usr_det_test_C2',
    amount: 12000.0,
    currency: 'USD',
    merchant: 'Standard Retail Goods Store',
    location: { city: 'New York', country: 'USA', lat: 40.7128, lng: -74.006 },
    deviceId: 'dev_det_test_C2',
    timestamp: new Date().toISOString(),
  };

  const timeC2 = new Date().toISOString();
  console.log(`[${timeC2}] [STEP C2] Sending $12,000 transaction: ${txnC2.txnId} (Threshold = $15,000)`);
  await httpPostJson(`http://localhost:${INGESTION_PORT}/transactions`, txnC2);

  await sleep(3000);
  const flagC2 = capturedFlags.find((f) => f.txnId === txnC2.txnId);

  if (!flagC2) {
    console.log(`[${new Date().toISOString()}] [STEP C2 RESULT] >>> CLEAN as expected! $12,000 did NOT trigger RULE_LARGE_AMOUNT.\n`);
  } else {
    throw new Error('STEP C2 FAILED: $12,000 transaction was unexpectedly flagged');
  }

  // Cleanup
  await flagConsumer.disconnect().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  redis.disconnect();

  ingestionProc.kill('SIGTERM');
  ruleEngineProc.kill('SIGTERM');

  console.log('===============================================================');
  console.log('   DETERMINISTIC LIVE RELOAD & PUB/SUB PROOF 100% SUCCESSFUL   ');
  console.log('===============================================================\n');
}

runDeterministicReloadProof()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Deterministic reload proof failed:', err);
    process.exit(1);
  });
