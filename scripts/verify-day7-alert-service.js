/**
 * FinGuard Day 7 Verification Script
 * Validates End-to-End Real-Time Alert Pipeline:
 * Simulator -> Ingestion -> Kafka (transactions.raw) -> Rule Engine
 *   -> Kafka (transactions.flagged) -> Alert Service -> MongoDB & Socket.io
 */

const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const { io: ioClient } = require('socket.io-client');
const {
  createKafkaClient,
  createProducer,
  TOPICS,
  createLogger,
} = require('../shared');

const logger = createLogger('day7-alert-verifier');

const INGESTION_PORT = 3001;
const RULE_ENGINE_PORT = 3002;
const ALERT_PORT = 3003;

const VERIFY_DB_NAME = 'finguard_verify_day7';
const MONGO_URI = `mongodb://root:example@localhost:27017/${VERIFY_DB_NAME}?authSource=admin`;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092';
const ADMIN_API_KEY = 'finguard-verify-admin-key-2026';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers,
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
    req.end();
  });
}

function httpPatchJson(url, data, headers = {}) {
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
          ...headers,
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

async function runDay7Verification() {
  console.log('\n===============================================================');
  console.log('    FINGUARD DAY 7: ALERT SERVICE & REAL-TIME WEBSOCKET DEMO   ');
  console.log('===============================================================\n');

  // 1. Reset Clean Test Database and Redis
  console.log(`[1/8] Initializing clean test database: ${VERIFY_DB_NAME}...`);
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection;
  await db.collection('alerts').deleteMany({});
  await db.collection('rules').deleteMany({});

  const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
  await redis.flushall();
  console.log('      Clean MongoDB collection and Redis state ready.');

  // 2. Start Alert Service FIRST on Port 3003
  console.log('\n[2/8] Starting Alert Service (FIRST) on port 3003...');
  const alertProc = spawn(process.execPath, ['services/alert/src/index.js'], {
    env: {
      ...process.env,
      PORT: String(ALERT_PORT),
      MONGO_URI,
      ADMIN_API_KEY,
      DASHBOARD_ORIGIN: 'http://localhost:3000',
      KAFKA_FROM_BEGINNING: 'false',
      KAFKA_CONSUMER_GROUP_ID: `alert-group-verify-${Date.now()}`,
      LOG_LEVEL: 'warn',
    },
    stdio: 'ignore',
  });

  await waitForHttp(`http://localhost:${ALERT_PORT}/health`, 'Alert Service');
  console.log('      Alert Service is healthy and listening on port 3003.');

  // 3. Connect Socket.io client to listen for real-time alert:new events
  console.log('\n[3/8] Connecting Socket.io client to Alert Service...');
  const socketClient = ioClient(`http://localhost:${ALERT_PORT}`, {
    transports: ['websocket'],
    extraHeaders: {
      Origin: 'http://localhost:3000',
    },
    reconnection: false,
  });

  const socketAlerts = [];
  socketClient.on('alert:new', (alertPayload) => {
    socketAlerts.push(alertPayload);
  });

  await new Promise((resolve, reject) => {
    socketClient.on('connect', () => {
      console.log(`      Socket.io client connected successfully (socketId: ${socketClient.id})`);
      resolve();
    });
    socketClient.on('connect_error', reject);
    setTimeout(() => reject(new Error('Socket.io connection timed out')), 5000);
  });

  // 4. Start Rule Engine and Ingestion Services
  console.log('\n[4/8] Starting Rule Engine and Ingestion Services...');
  const ruleEngineProc = spawn(process.execPath, ['services/rule-engine/src/index.js'], {
    env: {
      ...process.env,
      PORT: String(RULE_ENGINE_PORT),
      MONGO_URI,
      ADMIN_API_KEY,
      KAFKA_FROM_BEGINNING: 'false',
      KAFKA_CONSUMER_GROUP_ID: `rule-engine-verify-${Date.now()}`,
      LOG_LEVEL: 'warn',
    },
    stdio: 'ignore',
  });

  const ingestionProc = spawn(process.execPath, ['services/ingestion/src/index.js'], {
    env: {
      ...process.env,
      PORT: String(INGESTION_PORT),
      LOG_LEVEL: 'warn',
    },
    stdio: 'ignore',
  });

  await waitForHttp(`http://localhost:${RULE_ENGINE_PORT}/health`, 'Rule Engine');
  await waitForHttp(`http://localhost:${INGESTION_PORT}/health`, 'Ingestion Service');
  console.log('      Rule Engine and Ingestion Services running.');

  // Allow Kafka consumers to stabilize group assignments
  console.log('      Waiting 6s for Kafka consumer partitions to rebalance...');
  await sleep(6000);

  // 5. Run Simulator: 100 txns/sec for 15 seconds with 5000 users
  console.log('\n[5/8] Running Transaction Simulator (100 txns/sec, 15s, 5000 users, seed 42)...');
  const simProc = spawn(
    process.execPath,
    ['simulator/src/index.js', '--rate', '100', '--duration', '15', '--users', '5000', '--seed', '42'],
    { stdio: 'inherit' }
  );

  await new Promise((resolve, reject) => {
    simProc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Simulator exited with code ${code}`));
    });
  });

  console.log('\n      Simulator finished. Awaiting stream pipeline to settle (6s)...');
  await sleep(6000);

  // 6. Pipeline Verification: Rule Engine Flagged == Mongo Alerts == Socket.io Events
  console.log('\n[6/8] Verifying Pipeline Consistency (Rule Engine vs Mongo vs Socket.io)...');
  const ruleHealth = await httpGetJson(`http://localhost:${RULE_ENGINE_PORT}/health`);
  const ruleEngineFlagged = ruleHealth.body?.processor?.totalFlagged || 0;
  const mongoAlertsCount = await db.collection('alerts').countDocuments({});
  const socketAlertsCount = socketAlerts.length;

  console.log(`      - Rule Engine Flagged Count : ${ruleEngineFlagged}`);
  console.log(`      - MongoDB Alerts Persisted  : ${mongoAlertsCount}`);
  console.log(`      - Socket.io alert:new Count : ${socketAlertsCount}`);

  const countsMatch =
    ruleEngineFlagged === mongoAlertsCount && mongoAlertsCount === socketAlertsCount;

  if (countsMatch) {
    console.log('      >>> [PASSED] 100% Pipeline Consistency: Rule Engine == Mongo == Socket.io!');
  } else {
    console.error(
      `      >>> [MISMATCH] Rule Engine: ${ruleEngineFlagged}, Mongo: ${mongoAlertsCount}, Socket.io: ${socketAlertsCount}`
    );
  }

  // Verify GET /alerts/stats aggregation
  console.log('\n      Validating GET /alerts/stats aggregation...');
  const statsRes = await httpGetJson(`http://localhost:${ALERT_PORT}/alerts/stats`);
  const stats = statsRes.body;
  console.log(`      - Total in Stats API        : ${stats.total}`);
  console.log(`      - Severity Breakdown        : LOW: ${stats.bySeverity.LOW}, MEDIUM: ${stats.bySeverity.MEDIUM}, HIGH: ${stats.bySeverity.HIGH}, CRITICAL: ${stats.bySeverity.CRITICAL}`);
  console.log(`      - Status Breakdown          : OPEN: ${stats.byStatus.OPEN}, INVESTIGATING: ${stats.byStatus.INVESTIGATING}, RESOLVED: ${stats.byStatus.RESOLVED}, DISMISSED: ${stats.byStatus.DISMISSED}`);
  console.log(`      - Average Risk Score        : ${stats.avgRiskScore}`);
  console.log(`      - Top Triggered Rules       : ${stats.topRules.map((r) => `${r.ruleId} (${r.count})`).join(', ')}`);

  const statsMatch = stats.total === mongoAlertsCount;
  if (statsMatch) {
    console.log('      >>> [PASSED] GET /alerts/stats matches direct MongoDB count!');
  } else {
    console.error(`      >>> [FAILED] Stats total ${stats.total} != Mongo count ${mongoAlertsCount}`);
  }

  // 7. Deduplication Test: Deliver Same Flagged Event Twice
  console.log('\n[7/8] Testing Idempotent Deduplication (At-Least-Once Delivery Simulation)...');
  const kafka = createKafkaClient({
    clientId: 'day7-dedup-producer',
    brokers: KAFKA_BROKERS,
  });
  const dedupProducer = createProducer(kafka);
  await dedupProducer.connect();

  const dedupTxnId = crypto.randomUUID();
  const dedupPayload = {
    flaggedId: crypto.randomUUID(),
    txnId: dedupTxnId,
    userId: 'usr_dedup_live',
    amount: 88888,
    currency: 'USD',
    merchant: 'Offshore Crypto OTC VIP',
    location: { city: 'Panama City', country: 'PA', lat: 8.98, lng: -79.51 },
    deviceId: 'dev_dedup_live_1',
    timestamp: new Date().toISOString(),
    flaggedAt: new Date().toISOString(),
    matchedRules: [
      {
        ruleId: 'RULE_LARGE_AMOUNT',
        ruleName: 'High Amount',
        severity: 'HIGH',
        reason: 'exceeds threshold',
      },
      {
        ruleId: 'RULE_SUSPICIOUS_MERCHANT',
        ruleName: 'Suspicious Merchant',
        severity: 'CRITICAL',
        reason: 'crypto offshore VIP',
      },
    ],
    riskScore: 95,
  };

  console.log(`      Publishing flagged event with txnId: ${dedupTxnId} to ${TOPICS.TRANSACTIONS_FLAGGED}...`);
  await dedupProducer.send({
    topic: TOPICS.TRANSACTIONS_FLAGGED,
    messages: [{ key: 'usr_dedup_live', value: JSON.stringify(dedupPayload) }],
  });

  console.log(`      Publishing DUPLICATE of same event to ${TOPICS.TRANSACTIONS_FLAGGED}...`);
  await dedupProducer.send({
    topic: TOPICS.TRANSACTIONS_FLAGGED,
    messages: [{ key: 'usr_dedup_live', value: JSON.stringify(dedupPayload) }],
  });

  await sleep(3000); // Allow consumer to process both deliveries

  const dedupInMongo = await db.collection('alerts').countDocuments({ txnId: dedupTxnId });
  const dedupInSocket = socketAlerts.filter((a) => a.txnId === dedupTxnId).length;

  console.log(`      - Records in MongoDB for duplicate txnId : ${dedupInMongo} (expected: 1)`);
  console.log(`      - alert:new events emitted on Socket.io   : ${dedupInSocket} (expected: 1)`);

  const dedupPassed = dedupInMongo === 1 && dedupInSocket === 1;
  if (dedupPassed) {
    console.log('      >>> [PASSED] Deduplication Verified: Mongo unique index + $setOnInsert blocked duplicate record and avoided duplicate WS broadcast!');
  } else {
    console.error(`      >>> [FAILED] Deduplication mismatch: Mongo=${dedupInMongo}, Socket=${dedupInSocket}`);
  }

  // 8. PATCH Status & API Key Authentication Verification
  console.log('\n[8/8] Testing PATCH /alerts/:id/status and API Key Authorization...');
  const sampleAlert = await db.collection('alerts').findOne({ status: 'OPEN' });

  if (!sampleAlert) {
    throw new Error('No OPEN alert found for status update test');
  }

  console.log(`      Testing alertId: ${sampleAlert.alertId}`);

  // 8a. Test Unauthorized Request (Missing API Key)
  const unauthRes = await httpPatchJson(
    `http://localhost:${ALERT_PORT}/alerts/${sampleAlert.alertId}/status`,
    { status: 'INVESTIGATING', analyst: 'analyst_hacker' }
  );
  console.log(`      - Request WITHOUT API key : HTTP ${unauthRes.statusCode} (expected: 401)`);
  const unauthPassed = unauthRes.statusCode === 401;

  // 8b. Test Authorized Status Update
  const authRes = await httpPatchJson(
    `http://localhost:${ALERT_PORT}/alerts/${sampleAlert.alertId}/status`,
    {
      status: 'INVESTIGATING',
      analyst: 'analyst_lead_sarah',
      note: 'Verified suspicious offshore activity. Assigned for escalation.',
    },
    { 'x-api-key': ADMIN_API_KEY }
  );

  console.log(`      - Request WITH API key    : HTTP ${authRes.statusCode} (expected: 200)`);
  const authPassed = authRes.statusCode === 200 && authRes.body?.alert?.status === 'INVESTIGATING';

  // Verify Audit Log in MongoDB
  const updatedDoc = await db.collection('alerts').findOne({ alertId: sampleAlert.alertId });
  const hasAnalystNote = updatedDoc.notes.some((n) => n.text.includes('Verified suspicious offshore'));
  const hasAuditNote = updatedDoc.notes.some((n) => n.text.includes('Status changed from OPEN to INVESTIGATING'));

  console.log(`      - Assigned Analyst        : ${updatedDoc.assignedTo}`);
  console.log(`      - Custom Analyst Note     : ${hasAnalystNote ? 'Recorded' : 'MISSING'}`);
  console.log(`      - Automatic Audit Log     : ${hasAuditNote ? 'Recorded' : 'MISSING'}`);

  const statusPassed = unauthPassed && authPassed && hasAnalystNote && hasAuditNote;
  if (statusPassed) {
    console.log('      >>> [PASSED] Status update & API Key authentication verified with audit notes!');
  } else {
    console.error('      >>> [FAILED] Status update validation failed.');
  }

  // Cleanup
  console.log('\nCleaning up verification resources...');
  socketClient.disconnect();
  await dedupProducer.disconnect();
  alertProc.kill('SIGTERM');
  ruleEngineProc.kill('SIGTERM');
  ingestionProc.kill('SIGTERM');
  await mongoose.disconnect();
  await redis.quit();

  console.log('\n===============================================================');
  console.log('              DAY 7 VERIFICATION SUMMARY                       ');
  console.log('===============================================================');
  console.log(`Pipeline Consistency (Rule == Mongo == Socket) : ${countsMatch ? 'PASS' : 'FAIL'}`);
  console.log(`GET /alerts/stats Aggregation Verification      : ${statsMatch ? 'PASS' : 'FAIL'}`);
  console.log(`At-Least-Once Deduplication (Mongo & WS)        : ${dedupPassed ? 'PASS' : 'FAIL'}`);
  console.log(`API Key Auth & Status Audit Tracking            : ${statusPassed ? 'PASS' : 'FAIL'}`);
  console.log('===============================================================\n');

  if (countsMatch && statsMatch && dedupPassed && statusPassed) {
    console.log('>>> ALL DAY 7 VERIFICATION CRITERIA PASSED SUCCESSFULLY! <<<\n');
    process.exit(0);
  } else {
    console.error('>>> SOME VERIFICATION CHECKS FAILED <<<\n');
    process.exit(1);
  }
}

runDay7Verification().catch((err) => {
  console.error('FATAL in Day 7 Verification:', err);
  process.exit(1);
});
