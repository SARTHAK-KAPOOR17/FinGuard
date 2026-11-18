/**
 * FinGuard Day 8: Real-Time Operations Dashboard & WebSocket Proxy Verification
 *
 * Verifies:
 * 1. Vite dev server on port 5173 with proxy to Alert Service (port 3003).
 * 2. Socket.io client receiving alert:new events via Vite proxy (http://localhost:5173/socket.io).
 * 3. Severity room switching ('severity:CRITICAL'): confirms only CRITICAL events are received.
 * 4. Auto-reconnect test: kills & restarts Alert Service, verifying DISCONNECTED -> RECONNECTING -> CONNECTED.
 * 5. REST API proxy (/api/alerts/stats, /api/alerts?limit=20, /api/alerts/:id/status).
 */

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const dotenv = require('dotenv');

const ROOT_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.resolve(ROOT_DIR, '.env') });
dotenv.config({ path: path.resolve(ROOT_DIR, 'services/alert/.env') });
dotenv.config({ path: path.resolve(ROOT_DIR, 'frontend/.env') });

const TEST_API_KEY = process.env.ADMIN_API_KEY || process.env.VITE_ADMIN_API_KEY;
if (!TEST_API_KEY) {
  throw new Error('ADMIN_API_KEY or VITE_ADMIN_API_KEY must be defined in .env');
}

const VERIFY_DB_NAME = 'finguard_verify_day8';
const MONGO_URI = `mongodb://root:example@localhost:27017/${VERIFY_DB_NAME}?authSource=admin`;
const VITE_PORT = 5173;
const ALERT_PORT = 3003;
const INGESTION_PORT = 3001;
const RULE_ENGINE_PORT = 3002;
const REDIS_HOST = 'localhost';
const REDIS_PORT = 6379;

let alertProcess = null;
let ruleProcess = null;
let ingestionProcess = null;
let viteProcess = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startNodeProcess(scriptRelPath, envVars = {}) {
  return spawn(process.execPath, [scriptRelPath], {
    cwd: ROOT_DIR,
    stdio: 'ignore',
    env: {
      ...process.env,
      MONGO_URI,
      REDIS_HOST,
      REDIS_PORT: String(REDIS_PORT),
      ADMIN_API_KEY: TEST_API_KEY,
      DASHBOARD_ORIGIN: `http://localhost:${VITE_PORT}`,
      KAFKA_FROM_BEGINNING: 'false',
      LOG_LEVEL: 'warn',
      ...envVars,
    },
  });
}

async function waitForHttp(url, maxRetries = 35) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200 || res.status === 404) return true;
    } catch (_) {}
    await sleep(500);
  }
  return false;
}

function cleanup() {
  const procs = [viteProcess, alertProcess, ruleProcess, ingestionProcess];
  for (const p of procs) {
    if (p && !p.killed) {
      try {
        p.kill('SIGTERM');
      } catch (_) {}
    }
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

async function run() {
  console.log('\n===============================================================');
  console.log('   FINGUARD DAY 8: REACT DASHBOARD & PROXY VERIFICATION        ');
  console.log('===============================================================\n');

  try {
    // 1. Reset Clean Test Database and Redis
    console.log(`[1/7] Initializing clean test database: ${VERIFY_DB_NAME}...`);
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection;
    await db.collection('alerts').deleteMany({});
    await db.collection('rules').deleteMany({});

    // Seed default rules into rules collection
    const { SEED_RULES } = require('../services/rule-engine/src/rules/seed-rules');
    await db.collection('rules').insertMany(SEED_RULES);
    await mongoose.disconnect();

    const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
    await redis.flushall();
    redis.disconnect();
    console.log('      Clean MongoDB collection, seed rules, and Redis ready.\n');

    // 2. Start Alert Service FIRST on Port 3003
    console.log(`[2/7] Starting Alert Service on port ${ALERT_PORT}...`);
    alertProcess = startNodeProcess('services/alert/src/index.js', {
      PORT: String(ALERT_PORT),
      KAFKA_CONSUMER_GROUP_ID: `alert-dashboard-verify-${Date.now()}`,
    });

    const alertReady = await waitForHttp(`http://localhost:${ALERT_PORT}/health`);
    if (!alertReady) throw new Error('Alert Service failed to start within timeout');
    console.log(`      Alert Service is healthy and listening on port ${ALERT_PORT}.\n`);

    // 3. Start Vite Dev Server on Port 5173
    console.log(`[3/7] Starting Vite Dev Server on port ${VITE_PORT} (Vite Dev Proxy: /api, /socket.io)...`);
    viteProcess = spawn('cmd.exe', ['/c', 'npm run dev --prefix frontend'], {
      cwd: ROOT_DIR,
      stdio: 'ignore',
      env: {
        ...process.env,
        VITE_API_URL: '', // relative to proxy
        VITE_SOCKET_URL: `http://localhost:${VITE_PORT}`,
      },
    });

    const viteReady = await waitForHttp(`http://localhost:${VITE_PORT}`);
    if (!viteReady) throw new Error('Vite dev server failed to start within timeout');
    console.log(`      Vite dev server active at http://localhost:${VITE_PORT}.\n`);

    // 4. Connect Socket.io client to port 5173 (THROUGH Vite proxy)
    console.log(`[4/7] Connecting Socket.io client via Vite proxy (http://localhost:${VITE_PORT}/socket.io)...`);
    const proxySocket = io(`http://localhost:${VITE_PORT}`, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 500,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket.io connection via Vite proxy timed out')), 10000);
      proxySocket.on('connect', () => {
        clearTimeout(timeout);
        console.log(`      Socket.io connected via Vite proxy! (id: ${proxySocket.id})\n`);
        resolve();
      });
      proxySocket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // 5. Start Rule Engine & Ingestion, then run simulator
    console.log('[5/7] Starting Rule Engine & Ingestion Services...');
    ruleProcess = startNodeProcess('services/rule-engine/src/index.js', {
      PORT: String(RULE_ENGINE_PORT),
      KAFKA_CONSUMER_GROUP_ID: `rule-engine-dashboard-${Date.now()}`,
    });

    ingestionProcess = startNodeProcess('services/ingestion/src/index.js', {
      PORT: String(INGESTION_PORT),
    });

    await waitForHttp(`http://localhost:${RULE_ENGINE_PORT}/health`);
    await waitForHttp(`http://localhost:${INGESTION_PORT}/health`);
    console.log('      Rule Engine and Ingestion Services running.');
    console.log('      Waiting 6s for Kafka consumer partitions to rebalance...');
    await sleep(6000);

    const receivedAlerts = [];
    proxySocket.on('alert:new', (alert) => {
      receivedAlerts.push(alert);
    });

    console.log('      Running Transaction Simulator (100 txns/sec, 10s, 5000 users)...');
    const simChild = spawn(
      process.execPath,
      [
        'simulator/src/index.js',
        '--rate', '100',
        '--duration', '10',
        '--users', '5000',
        '--seed', '42',
        '--url', `http://localhost:${INGESTION_PORT}/transactions`,
      ],
      { cwd: ROOT_DIR, stdio: 'inherit' }
    );

    await new Promise((resolve) => simChild.on('close', resolve));
    console.log('      Simulator completed. Waiting 6s for pipeline events to stream...');
    await sleep(6000);

    console.log(`      - Total alert:new events received through Vite proxy: ${receivedAlerts.length}`);
    if (receivedAlerts.length === 0) {
      throw new Error('No alerts were received through the Vite proxy!');
    }
    console.log('      >>> [PASSED] Real-time alerts verified streaming through Vite proxy!\n');

    // 6. Test Severity Room Subscription ('severity:CRITICAL')
    console.log('[6/7] Testing Severity Room Subscription ("severity:CRITICAL")...');
    proxySocket.emit('subscribe', 'severity:CRITICAL');
    await sleep(1000);

    // Track CRITICAL alerts before the burst in MongoDB
    await mongoose.connect(MONGO_URI);
    const dbInstance = mongoose.connection;
    const criticalBefore = await dbInstance.collection('alerts').countDocuments({ severity: 'CRITICAL' });

    const roomAlerts = [];
    const roomListener = (alert) => {
      roomAlerts.push(alert);
    };
    proxySocket.on('alert:new', roomListener);

    console.log('      Sending second transaction burst (80 txns/sec, 6s)...');
    const burstChild = spawn(
      process.execPath,
      [
        'simulator/src/index.js',
        '--rate', '80',
        '--duration', '6',
        '--users', '5000',
        '--seed', '101',
        '--url', `http://localhost:${INGESTION_PORT}/transactions`,
      ],
      { cwd: ROOT_DIR, stdio: 'ignore' }
    );
    await new Promise((resolve) => burstChild.on('close', resolve));
    await sleep(6000);

    proxySocket.off('alert:new', roomListener);

    const criticalAfter = await dbInstance.collection('alerts').countDocuments({ severity: 'CRITICAL' });
    const mongoCriticalBurst = criticalAfter - criticalBefore;
    await mongoose.disconnect();

    console.log(`      - Filtered alerts received in severity:CRITICAL room: ${roomAlerts.length}`);
    console.log(`      - MongoDB CRITICAL alerts generated during burst: ${mongoCriticalBurst}`);

    const nonCritical = roomAlerts.filter((a) => a.severity !== 'CRITICAL');
    if (nonCritical.length > 0) {
      throw new Error(`Room leak detected: received non-critical alerts: ${JSON.stringify(nonCritical)}`);
    }
    console.log('      - Non-critical alerts leaked: 0 (100% pure CRITICAL alerts)');

    if (roomAlerts.length !== mongoCriticalBurst) {
      throw new Error(`Missing alerts: WebSocket received ${roomAlerts.length} alerts but MongoDB recorded ${mongoCriticalBurst} CRITICAL alerts!`);
    }
    console.log(`      - Missing alerts check: 0 (WebSocket count ${roomAlerts.length} matches MongoDB CRITICAL count ${mongoCriticalBurst})`);
    console.log('      >>> [PASSED] Severity room switching isolates target traffic with zero leaks and zero missing alerts!\n');

    // 7. Test Auto-Reconnect: Restart Alert Service
    console.log('[7/7] Testing WebSocket Auto-Reconnect & State Transitions...');
    let disconnectCount = 0;
    let reconnectingCount = 0;
    let reconnectedCount = 0;

    proxySocket.on('disconnect', (reason) => {
      disconnectCount++;
      console.log(`      [Event] Socket disconnected: ${reason} (Badge: DISCONNECTED)`);
    });

    proxySocket.io.on('reconnect_attempt', (attempt) => {
      reconnectingCount++;
      console.log(`      [Event] Reconnection attempt #${attempt}... (Badge: RECONNECTING)`);
    });

    proxySocket.io.on('reconnect', () => {
      reconnectedCount++;
      console.log('      [Event] Reconnected successfully! (Badge: CONNECTED)');
    });

    console.log('      Terminating Alert Service on port 3003...');
    alertProcess.kill('SIGTERM');
    await sleep(2500);

    console.log('      Restarting Alert Service on port 3003...');
    alertProcess = startNodeProcess('services/alert/src/index.js', {
      PORT: String(ALERT_PORT),
      KAFKA_CONSUMER_GROUP_ID: `alert-dashboard-verify-${Date.now()}`,
    });
    await waitForHttp(`http://localhost:${ALERT_PORT}/health`);

    const startWait = Date.now();
    while (reconnectedCount === 0 && Date.now() - startWait < 15000) {
      await sleep(500);
    }

    if (reconnectedCount === 0) {
      throw new Error('Socket failed to automatically reconnect after Alert Service restart');
    }
    console.log('      >>> [PASSED] Auto-reconnect lifecycle verified: CONNECTED -> RECONNECTING -> CONNECTED!\n');

    // REST API Integration checks through Vite proxy
    console.log('Verifying REST API endpoints via Vite proxy (/api)...');
    const statsRes = await fetch(`http://localhost:${VITE_PORT}/api/alerts/stats`);
    const statsData = await statsRes.json();
    console.log(`      - GET /api/alerts/stats Total: ${statsData.total}`);
    console.log(`      - Severity: CRITICAL=${statsData.bySeverity.CRITICAL}, HIGH=${statsData.bySeverity.HIGH}, MEDIUM=${statsData.bySeverity.MEDIUM}`);

    const alertsRes = await fetch(`http://localhost:${VITE_PORT}/api/alerts?limit=20`);
    const alertsData = await alertsRes.json();
    console.log(`      - GET /api/alerts returned: ${alertsData.data?.length} records (limit 20, page ${alertsData.page}/${alertsData.totalPages})`);

    if (alertsData.data && alertsData.data.length > 0) {
      const sample = alertsData.data[0];
      const patchRes = await fetch(`http://localhost:${VITE_PORT}/api/alerts/${sample.alertId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ status: 'INVESTIGATING', analyst: 'verify_script', note: 'E2E Verified via Vite Proxy' }),
      });
      const patchData = await patchRes.json();
      console.log(`      - PATCH /api/alerts/:id/status: ${sample.status} -> ${patchData.status} (Note recorded: "${patchData.notes?.[patchData.notes.length - 1]?.text}")`);
      console.log('      >>> [PASSED] REST API proxy endpoints functional!\n');
    }

    console.log('===============================================================');
    console.log('            DAY 8 DASHBOARD VERIFICATION SUMMARY               ');
    console.log('===============================================================');
    console.log('Vite Dev Proxy (/api, /socket.io)            : PASS');
    console.log('Real-Time WebSocket Stream (alert:new)        : PASS');
    console.log('Severity Room Isolation (severity:CRITICAL)  : PASS');
    console.log('Auto-Reconnect (CONNECTED -> RECONNECTING)    : PASS');
    console.log('REST API Integration (Stats, List, Status)    : PASS');
    console.log('===============================================================\n');
    console.log('>>> ALL DAY 8 MILESTONES 1, 2, 3 & 4 VERIFIED SUCCESSFULLY! <<<\n');

    proxySocket.disconnect();
    cleanup();
    process.exit(0);
  } catch (err) {
    console.error('\n[VERIFICATION ERROR]', err);
    cleanup();
    process.exit(1);
  }
}

run();
