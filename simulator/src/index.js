#!/usr/bin/env node
const { Command } = require('commander');
const { SimulatorRunner } = require('./runner');

const program = new Command();

program
  .name('finguard-simulator')
  .description('FinGuard Real-time Financial Transaction Simulator CLI')
  .version('1.0.0')
  .option('-r, --rate <number>', 'Target transactions per second (txns/sec)', (val) => parseInt(val, 10), 10)
  .option('-d, --duration <number>', 'Duration to run in seconds', (val) => parseInt(val, 10), 10)
  .option('-s, --seed <string>', 'Random seed for reproducible traffic and fraud patterns')
  .option('-u, --url <string>', 'Target Ingestion endpoint URL', 'http://localhost:3001/transactions')
  .option('-b, --batch <number>', 'Batch size for batch ingestion', (val) => parseInt(val, 10), 1)
  .option('--fraud-ratio <number>', 'Ratio of fraud-like transactions (0.0 - 1.0)', (val) => parseFloat(val), 0.05)
  .action(async (options) => {
    // If batch > 1 and user didn't change default URL, point to /batch
    let targetUrl = options.url;
    if (options.batch > 1 && targetUrl === 'http://localhost:3001/transactions') {
      targetUrl = 'http://localhost:3001/transactions/batch';
    }

    const runner = new SimulatorRunner({
      rate: options.rate,
      duration: options.duration,
      seed: options.seed,
      url: targetUrl,
      batchSize: options.batch,
      fraudRatio: options.fraudRatio,
    });

    process.on('SIGINT', () => {
      console.log('\nStopping simulation early (SIGINT)...');
      runner.stop();
    });

    process.on('SIGTERM', () => {
      console.log('\nStopping simulation early (SIGTERM)...');
      runner.stop();
    });

    try {
      await runner.run();
      process.exit(0);
    } catch (err) {
      console.error('\nSimulator terminated with error:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
