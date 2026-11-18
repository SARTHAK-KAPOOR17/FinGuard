import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3003';

class SocketManager {
  constructor() {
    this.socket = null;
    this.currentRoom = 'all-alerts';
    this.statusListeners = new Set();
    this.alertListeners = new Set();
    this.connectionState = 'disconnected'; // 'connected' | 'reconnecting' | 'disconnected'
  }

  connect() {
    if (this.socket) return;

    this.socket = io(SOCKET_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      this.connectionState = 'connected';
      this.notifyStatus('connected');
      
      // Re-join current room after reconnect
      if (this.currentRoom && this.currentRoom !== 'all-alerts') {
        this.socket.emit('subscribe', this.currentRoom);
      }
    });

    this.socket.on('disconnect', (reason) => {
      this.connectionState = 'disconnected';
      this.notifyStatus('disconnected', reason);
    });

    this.socket.io.on('reconnect_attempt', (attempt) => {
      this.connectionState = 'reconnecting';
      this.notifyStatus('reconnecting', attempt);
    });

    this.socket.io.on('reconnect', () => {
      this.connectionState = 'connected';
      this.notifyStatus('connected');
    });

    this.socket.io.on('reconnect_error', (error) => {
      this.connectionState = 'reconnecting';
      this.notifyStatus('reconnecting', error);
    });

    this.socket.on('alert:new', (alert) => {
      this.alertListeners.forEach((callback) => callback(alert));
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connectionState = 'disconnected';
      this.notifyStatus('disconnected');
    }
  }

  subscribeToRoom(newRoom) {
    if (!this.socket) return;
    const target = newRoom && newRoom !== 'ALL' ? `severity:${newRoom}` : 'all-alerts';

    if (this.currentRoom === target) return;

    // Leave previous room if changing from a specific room
    if (this.currentRoom && this.currentRoom !== 'all-alerts') {
      this.socket.emit('unsubscribe', this.currentRoom);
    }

    this.currentRoom = target;
    this.socket.emit('subscribe', target);
  }

  onAlert(callback) {
    this.alertListeners.add(callback);
    return () => this.alertListeners.delete(callback);
  }

  onStatusChange(callback) {
    this.statusListeners.add(callback);
    // Immediate notification of current status
    callback(this.connectionState);
    return () => this.statusListeners.delete(callback);
  }

  notifyStatus(status, detail) {
    this.statusListeners.forEach((callback) => callback(status, detail));
  }
}

export const socketManager = new SocketManager();
