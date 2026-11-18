const { Server } = require('socket.io');
const { createLogger } = require('@finguard/shared');
const config = require('../config');

const logger = createLogger(config.serviceName);

class WebSocketService {
  constructor(server = null, options = {}) {
    this.io = null;
    this.activeConnections = 0;
    this.dashboardOrigins = options.dashboardOrigins || config.dashboardOrigins || ['http://localhost:5173'];

    if (server) {
      this.attach(server);
    }
  }

  attach(server) {
    if (this.io) return;

    this.io = new Server(server, {
      cors: {
        origin: this.dashboardOrigins.length === 1 ? this.dashboardOrigins[0] : this.dashboardOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingTimeout: 20000,
      pingInterval: 25000,
    });

    this.io.on('connection', (socket) => {
      this.activeConnections++;
      logger.info(
        { socketId: socket.id, activeConnections: this.activeConnections },
        'WebSocket client connected to Alert Service'
      );

      // Default: new clients join 'all-alerts' to receive every incoming alert
      socket.join('all-alerts');

      // Room-based subscription (e.g., 'severity:CRITICAL', 'severity:HIGH')
      socket.on('subscribe', (room) => {
        if (typeof room === 'string' && room.trim().length > 0) {
          const cleanRoom = room.trim();

          // If subscribing to a specific severity filter, leave default 'all-alerts'
          if (cleanRoom.startsWith('severity:')) {
            socket.leave('all-alerts');
          }

          socket.join(cleanRoom);
          logger.debug({ socketId: socket.id, room: cleanRoom }, 'Client subscribed to room');
          socket.emit('subscribed', { room: cleanRoom, status: 'ok' });
        }
      });

      // Unsubscribe or reset back to 'all-alerts'
      socket.on('unsubscribe', (room) => {
        if (typeof room === 'string' && room.trim().length > 0) {
          const cleanRoom = room.trim();
          socket.leave(cleanRoom);

          // If client has no specific rooms left, fall back to 'all-alerts'
          const remainingRooms = Array.from(socket.rooms).filter((r) => r !== socket.id);
          if (remainingRooms.length === 0) {
            socket.join('all-alerts');
          }

          logger.debug({ socketId: socket.id, room: cleanRoom }, 'Client unsubscribed from room');
          socket.emit('unsubscribed', { room: cleanRoom, status: 'ok' });
        }
      });

      socket.on('disconnect', (reason) => {
        this.activeConnections = Math.max(0, this.activeConnections - 1);
        logger.info(
          { socketId: socket.id, reason, activeConnections: this.activeConnections },
          'WebSocket client disconnected from Alert Service'
        );
      });
    });
  }

  /**
   * Broadcasts a fraud alert to connected operators.
   * Emits to 'all-alerts' room and specific severity room (e.g. 'severity:CRITICAL')
   *
   * @param {Object} alert
   */
  broadcastAlert(alert) {
    if (!this.io) {
      logger.warn('Cannot broadcast alert: WebSocket server is not attached');
      return;
    }

    const payload = {
      alertId: alert.alertId,
      txnId: alert.txnId,
      userId: alert.userId,
      amount: alert.amount,
      currency: alert.currency || 'USD',
      merchant: alert.merchant,
      location: alert.location,
      matchedRules: alert.matchedRules,
      riskScore: alert.riskScore,
      severity: alert.severity,
      status: alert.status,
      flaggedAt: alert.flaggedAt,
      createdAt: alert.createdAt,
    };

    // 1. Emit to clients listening to all alerts (default)
    this.io.to('all-alerts').emit('alert:new', payload);

    // 2. Emit to clients specifically subscribed to this severity
    if (alert.severity) {
      const room = `severity:${alert.severity.toUpperCase()}`;
      this.io.to(room).emit('alert:new', payload);
    }

    logger.debug(
      {
        alertId: alert.alertId,
        txnId: alert.txnId,
        severity: alert.severity,
        activeConnections: this.activeConnections,
      },
      'Dispatched alert:new event via Socket.io'
    );
  }

  getActiveConnections() {
    return this.activeConnections;
  }

  async close() {
    if (this.io) {
      await new Promise((resolve) => this.io.close(resolve));
      this.io = null;
      this.activeConnections = 0;
      logger.info('Socket.io server closed');
    }
  }
}

const wsService = new WebSocketService();

module.exports = {
  WebSocketService,
  wsService,
};
