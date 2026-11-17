const http = require('http');
const { io: Client } = require('socket.io-client');
const { WebSocketService } = require('../src/services/websocket.service');

describe('WebSocketService (Socket.io Real-Time Alerts)', () => {
  let httpServer;
  let wsService;
  let serverPort;

  beforeAll((done) => {
    httpServer = http.createServer();
    wsService = new WebSocketService(httpServer, {
      dashboardOrigin: '*', // Allow test client connection
    });

    httpServer.listen(() => {
      serverPort = httpServer.address().port;
      done();
    });
  });

  afterAll(async () => {
    await wsService.close();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it('should track active connections as clients connect and disconnect', (done) => {
    expect(wsService.getActiveConnections()).toBe(0);

    const clientSocket = Client(`http://localhost:${serverPort}`);

    clientSocket.on('connect', () => {
      expect(wsService.getActiveConnections()).toBe(1);

      clientSocket.disconnect();
    });

    clientSocket.on('disconnect', () => {
      setTimeout(() => {
        expect(wsService.getActiveConnections()).toBe(0);
        done();
      }, 50);
    });
  });

  it('should broadcast alert:new event with full payload to default all-alerts client', (done) => {
    const clientSocket = Client(`http://localhost:${serverPort}`);

    const sampleAlert = {
      alertId: 'alt-broad-123',
      txnId: 'txn-broad-456',
      userId: 'usr-broad-789',
      amount: 19999,
      currency: 'USD',
      merchant: 'Luxury Watches Zurich',
      location: { city: 'Zurich', country: 'CH', lat: 47.37, lng: 8.54 },
      matchedRules: [
        { ruleId: 'R1', ruleName: 'High Amount', severity: 'HIGH', reason: 'exceeds $10k' },
      ],
      riskScore: 75,
      severity: 'HIGH',
      status: 'OPEN',
      flaggedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    clientSocket.on('connect', () => {
      // Broadcast alert
      wsService.broadcastAlert(sampleAlert);
    });

    clientSocket.on('alert:new', (payload) => {
      expect(payload).toBeDefined();
      expect(payload.alertId).toBe('alt-broad-123');
      expect(payload.txnId).toBe('txn-broad-456');
      expect(payload.amount).toBe(19999);
      expect(payload.severity).toBe('HIGH');
      expect(payload.status).toBe('OPEN');
      expect(payload.merchant).toBe('Luxury Watches Zurich');
      expect(payload.matchedRules.length).toBe(1);

      clientSocket.disconnect();
      done();
    });
  });

  it('should properly isolate alerts by severity room subscription', (done) => {
    const criticalClient = Client(`http://localhost:${serverPort}`);
    const lowClient = Client(`http://localhost:${serverPort}`);
    const defaultClient = Client(`http://localhost:${serverPort}`);

    let criticalReceived = 0;
    let lowReceived = 0;
    let defaultReceived = 0;

    let connectedCount = 0;
    const checkAllConnected = () => {
      connectedCount++;
      if (connectedCount === 3) {
        criticalClient.emit('subscribe', 'severity:CRITICAL');
        lowClient.emit('subscribe', 'severity:LOW');

        // Allow subscriptions to register
        setTimeout(() => {
          const criticalAlert = {
            alertId: 'alt-crit-101',
            txnId: 'txn-crit-101',
            userId: 'usr-crit',
            amount: 50000,
            currency: 'USD',
            merchant: 'Private Jet Rental',
            severity: 'CRITICAL',
            riskScore: 95,
            status: 'OPEN',
            matchedRules: [{ ruleId: 'R2', ruleName: 'Private Jet', severity: 'CRITICAL', reason: 'High risk' }],
            flaggedAt: new Date().toISOString(),
          };

          // Broadcast CRITICAL alert
          wsService.broadcastAlert(criticalAlert);

          setTimeout(() => {
            // criticalClient receives it
            expect(criticalReceived).toBe(1);
            // defaultClient receives it
            expect(defaultReceived).toBe(1);
            // lowClient must NOT receive the CRITICAL alert
            expect(lowReceived).toBe(0);

            criticalClient.disconnect();
            lowClient.disconnect();
            defaultClient.disconnect();
            done();
          }, 100);
        }, 50);
      }
    };

    criticalClient.on('connect', checkAllConnected);
    lowClient.on('connect', checkAllConnected);
    defaultClient.on('connect', checkAllConnected);

    criticalClient.on('alert:new', () => {
      criticalReceived++;
    });

    lowClient.on('alert:new', () => {
      lowReceived++;
    });

    defaultClient.on('alert:new', () => {
      defaultReceived++;
    });
  });
});
