
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { TrafficGenerator } = require('./generator/traffic-generator');

class SimulatorRunner {
  /**
   * @param {object} options
   * @param {number} [options.rate=10] - Target transactions per second
   * @param {number} [options.duration=10] - Duration in seconds
   * @param {number|string} [options.seed] - Seed for PRNG
   * @param {string} [options.url='http://localhost:3001/transactions'] - Ingestion URL
   * @param {number} [options.batchSize=1] - Batch size
   * @param {number} [options.fraudRatio=0.05]
   */
  constructor(options = {}) {
    this.targetRate = options.rate || 10;
    this.durationSeconds = options.duration || 10;
    this.seed = options.seed !== undefined ? options.seed : Date.now();
    this.url = options.url || 'http://localhost:3001/transactions';
    this.batchSize = options.batchSize || 1;
    this.fraudRatio = options.fraudRatio !== undefined ? options.fraudRatio : 0.05;

    this.generator = new TrafficGenerator({
      seed: this.seed,
      fraudRatio: this.fraudRatio,
    });

    const parsedUrl = new URL(this.url);
    this.isHttps = parsedUrl.protocol === 'https:';
    this.agent = this.isHttps
      ? new https.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 64 })
      : new http.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 64 });

    this.stats = {
      totalGenerated: 0,
      totalSent: 0,
      totalSuccess: 0,
      totalFailed: 0,
      patterns: {
        normal: 0,
        large_amount: 0,
        rapid_velocity: 0,
        location_jump: 0,
      },
      startTime: null,
      endTime: null,
      actualRate: 0,
    };

    this.isRunning = false;
  }

  /**
   * Sends an HTTP POST request to the ingestion service.
   *
   * @param {object|Array} data
   * @returns {Promise<{ ok: boolean, statusCode: number, responseText: string }>}
   */
  async _sendHttpRequest(data) {
    const payload = JSON.stringify(data);
    const parsedUrl = new URL(this.url);

    return new Promise((resolve) => {
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (this.isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        agent: this.agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Connection': 'keep-alive',
        },
        timeout: 5000,
      };

      const client = this.isHttps ? https : http;
      const req = client.request(options, (res) => {
        let responseText = '';
        res.on('data', (chunk) => {
          responseText += chunk;
        });
        res.on('end', () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          resolve({ ok, statusCode: res.statusCode, responseText });
        });
      });

      req.on('error', (err) => {
        resolve({ ok: false, statusCode: 0, responseText: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, statusCode: 408, responseText: 'Request timeout' });
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Starts running the traffic simulation.
   */
  async run() {
    this.isRunning = true;
    this.stats.startTime = Date.now();
    const durationMs = this.durationSeconds * 1000;
    const endTime = this.stats.startTime + durationMs;

    console.log('\n======================================================');
    console.log('       FINGUARD TRANSACTION TRAFFIC SIMULATOR         ');
    console.log('======================================================');
    console.log(`Target Rate:      ${this.targetRate} txns/sec`);
    console.log(`Duration:         ${this.durationSeconds} seconds (Target: ~${this.targetRate * this.durationSeconds} txns)`);
    console.log(`Target URL:       ${this.url}`);
    console.log(`Seed:             ${this.seed}`);
    console.log(`Batch Size:       ${this.batchSize}`);
    console.log(`Fraud Ratio:      ${(this.fraudRatio * 100).toFixed(1)}%`);
    console.log('------------------------------------------------------');
    console.log('Simulation starting in progress...\n');

    // Dynamic wall-clock pacing to achieve precise target rate despite Windows timer jitter
    const tickIntervalMs = 25;
    const inFlightRequests = [];

    const progressTimer = setInterval(() => {
      const elapsedSec = ((Date.now() - this.stats.startTime) / 1000).toFixed(1);
      const currentRate = (this.stats.totalSent / Math.max(0.1, parseFloat(elapsedSec))).toFixed(1);
      process.stdout.write(
        `\r[Progress: ${elapsedSec}s / ${this.durationSeconds}s] Sent: ${this.stats.totalSent} | Success: ${this.stats.totalSuccess} | Failed: ${this.stats.totalFailed} | Rate: ${currentRate} tps`
      );
    }, 500);

    while (Date.now() < endTime && this.isRunning) {
      const elapsedSec = (Date.now() - this.stats.startTime) / 1000;
      const expectedTotal = Math.min(
        this.targetRate * this.durationSeconds,
        Math.floor(elapsedSec * this.targetRate)
      );
      const countToSend = Math.max(0, expectedTotal - this.stats.totalGenerated);

      if (countToSend > 0) {
        if (this.batchSize > 1) {
          // Send in batches
          const batchItems = [];
          for (let i = 0; i < countToSend; i++) {
            const { txn, pattern } = this.generator.nextTransaction();
            this.stats.totalGenerated++;
            this.stats.patterns[pattern] = (this.stats.patterns[pattern] || 0) + 1;
            batchItems.push(txn);
          }

          const reqPromise = this._sendHttpRequest(batchItems).then((res) => {
            this.stats.totalSent += batchItems.length;
            if (res.ok) {
              this.stats.totalSuccess += batchItems.length;
            } else {
              this.stats.totalFailed += batchItems.length;
            }
          });
          inFlightRequests.push(reqPromise);
        } else {
          // Send single transactions
          for (let i = 0; i < countToSend; i++) {
            const { txn, pattern } = this.generator.nextTransaction();
            this.stats.totalGenerated++;
            this.stats.patterns[pattern] = (this.stats.patterns[pattern] || 0) + 1;

            const reqPromise = this._sendHttpRequest(txn).then((res) => {
              this.stats.totalSent++;
              if (res.ok) {
                this.stats.totalSuccess++;
              } else {
                this.stats.totalFailed++;
              }
            });
            inFlightRequests.push(reqPromise);
          }
        }
      }

      // Cleanup resolved requests to prevent memory growth
      if (inFlightRequests.length > 500) {
        await Promise.race(inFlightRequests);
      }

      await new Promise((resolve) => setTimeout(resolve, tickIntervalMs));
    }

    clearInterval(progressTimer);

    // Drain all remaining in-flight requests
    await Promise.allSettled(inFlightRequests);

    this.stats.endTime = Date.now();
    const elapsedSeconds = (this.stats.endTime - this.stats.startTime) / 1000;
    this.stats.actualRate = parseFloat((this.stats.totalSent / Math.max(0.001, elapsedSeconds)).toFixed(2));

    this.printSummary();
    return this.stats;
  }

  /**
   * Prints the comprehensive simulation summary table.
   */
  printSummary() {
    const elapsedSeconds = ((this.stats.endTime - this.stats.startTime) / 1000).toFixed(2);
    const totalFraud =
      this.stats.patterns.large_amount +
      this.stats.patterns.rapid_velocity +
      this.stats.patterns.location_jump;

    const fraudPercentage = this.stats.totalGenerated > 0
      ? ((totalFraud / this.stats.totalGenerated) * 100).toFixed(2)
      : '0.00';

    console.log('\n\n======================================================');
    console.log('              SIMULATION SUMMARY RESULTS              ');
    console.log('======================================================');
    console.log(`Execution Time:          ${elapsedSeconds} seconds`);
    console.log(`Target Rate:             ${this.targetRate} txns/sec`);
    console.log(`Actual Rate Achieved:    ${this.stats.actualRate} txns/sec`);
    console.log(`Seed:                    ${this.seed}`);
    console.log('------------------------------------------------------');
    console.log(`Total Sent:              ${this.stats.totalSent}`);
    console.log(`Total Successful (202):  ${this.stats.totalSuccess}`);
    console.log(`Total Failed:            ${this.stats.totalFailed}`);
    console.log('------------------------------------------------------');
    console.log(`Normal Transactions:     ${this.stats.patterns.normal} (${(100 - parseFloat(fraudPercentage)).toFixed(2)}%)`);
    console.log(`Total Fraud-Like:        ${totalFraud} (${fraudPercentage}%)`);
    console.log(`  - Large Amount (> $10k): ${this.stats.patterns.large_amount}`);
    console.log(`  - Rapid Velocity:        ${this.stats.patterns.rapid_velocity}`);
    console.log(`  - Location Jumps:        ${this.stats.patterns.location_jump}`);
    console.log('======================================================\n');
  }

  stop() {
    this.isRunning = false;
  }
}

module.exports = { SimulatorRunner };
