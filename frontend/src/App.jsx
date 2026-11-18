import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import StatsCards from './components/StatsCards';
import FilterBar from './components/FilterBar';
import AlertFeed from './components/AlertFeed';
import AlertDetailDrawer from './components/AlertDetailDrawer';
import { fetchAlerts, fetchAlertStats } from './services/api';
import { socketManager } from './services/socket';

const MAX_BUFFER_CAP = 200;

export default function App() {
  const [connectionState, setConnectionState] = useState('disconnected');
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    byStatus: { OPEN: 0, INVESTIGATING: 0, RESOLVED: 0, DISMISSED: 0 },
    avgRiskScore: 0,
  });

  // Filter state
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [sortOrder, setSortOrder] = useState('createdAt');

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [recentAlertIds, setRecentAlertIds] = useState(new Set());

  // References to keep filter state accessible in socket callback
  const filtersRef = useRef({
    severity: severityFilter,
    status: statusFilter,
    userId: userIdFilter,
  });

  useEffect(() => {
    filtersRef.current = {
      severity: severityFilter,
      status: statusFilter,
      userId: userIdFilter,
    };
  }, [severityFilter, statusFilter, userIdFilter]);

  // Load initial stats from REST API
  const loadStats = useCallback(async () => {
    try {
      const data = await fetchAlertStats();
      setStats({
        total: data.total || 0,
        bySeverity: data.bySeverity || { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
        byStatus: data.byStatus || { OPEN: 0, INVESTIGATING: 0, RESOLVED: 0, DISMISSED: 0 },
        avgRiskScore: data.avgRiskScore || 0,
      });
    } catch (err) {
      console.error('Failed to load alert stats:', err);
    }
  }, []);

  // Load alerts with current filters from REST API
  const loadAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchAlerts({
        page: 1,
        limit: 100,
        severity: severityFilter,
        status: statusFilter,
        userId: userIdFilter,
        sort: sortOrder,
      });
      setAlerts(result.data || []);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [severityFilter, statusFilter, userIdFilter, sortOrder]);

  // Reload alerts when filters change
  useEffect(() => {
    const timer = setTimeout(() => {
      loadAlerts();
    }, 250); // slight debounce for search input
    return () => clearTimeout(timer);
  }, [loadAlerts]);

  // Handle severity room switching on filter change
  useEffect(() => {
    socketManager.subscribeToRoom(severityFilter);
  }, [severityFilter]);

  // WebSocket listener setup & periodic stats sync
  useEffect(() => {
    socketManager.connect();

    const unsubStatus = socketManager.onStatusChange((status) => {
      setConnectionState(status);
    });

    const unsubAlert = socketManager.onAlert((incomingAlert) => {
      // 1. Immediately update global stats counters
      setStats((prev) => {
        const sev = incomingAlert.severity || 'LOW';
        const st = incomingAlert.status || 'OPEN';
        const newTotal = prev.total + 1;
        const currentBySev = { ...prev.bySeverity };
        const currentBySt = { ...prev.byStatus };

        currentBySev[sev] = (currentBySev[sev] || 0) + 1;
        currentBySt[st] = (currentBySt[st] || 0) + 1;

        return {
          ...prev,
          total: newTotal,
          bySeverity: currentBySev,
          byStatus: currentBySt,
        };
      });

      // 2. Check if incoming alert matches active client-side filters
      const { severity, status, userId } = filtersRef.current;
      const matchesSeverity = severity === 'ALL' || incomingAlert.severity === severity;
      const matchesStatus = status === 'ALL' || incomingAlert.status === status;
      const matchesUser =
        !userId ||
        !userId.trim() ||
        (incomingAlert.userId && incomingAlert.userId.toLowerCase().includes(userId.toLowerCase().trim()));

      if (matchesSeverity && matchesStatus && matchesUser) {
        // Prepend to alerts list, capping at 200 items (FIFO ring buffer)
        setAlerts((prev) => {
          // Avoid duplicate keys if duplicate event arrives
          const filtered = prev.filter((a) => a.alertId !== incomingAlert.alertId);
          return [incomingAlert, ...filtered].slice(0, MAX_BUFFER_CAP);
        });

        // Trigger flash pulse animation for 2 seconds
        setRecentAlertIds((prev) => new Set(prev).add(incomingAlert.alertId));
        setTimeout(() => {
          setRecentAlertIds((prev) => {
            const next = new Set(prev);
            next.delete(incomingAlert.alertId);
            return next;
          });
        }, 2000);
      }
    });

    // Initial stats load
    loadStats();

    // 30s periodic resync with MongoDB authoritative aggregation
    const statsInterval = setInterval(loadStats, 30000);

    return () => {
      unsubStatus();
      unsubAlert();
      clearInterval(statsInterval);
    };
  }, [loadStats]);

  // Handle status update from AlertDetailDrawer
  const handleStatusUpdated = (updatedAlert) => {
    // Update local alert in list
    setAlerts((prev) =>
      prev.map((a) => (a.alertId === updatedAlert.alertId ? updatedAlert : a))
    );
    setSelectedAlert(updatedAlert);
    // Refresh stats
    loadStats();
  };

  const handleResetFilters = () => {
    setSeverityFilter('ALL');
    setStatusFilter('ALL');
    setUserIdFilter('');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation & Connection Status */}
      <Header
        connectionState={connectionState}
        bufferCount={alerts.length}
        isMaxReached={alerts.length >= MAX_BUFFER_CAP}
      />

      {/* Main Operations Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Real-time Global Stats Cards */}
        <StatsCards stats={stats} />

        {/* Filter & Search Bar */}
        <FilterBar
          severity={severityFilter}
          setSeverity={setSeverityFilter}
          status={statusFilter}
          setStatus={setStatusFilter}
          userId={userIdFilter}
          setUserId={setUserIdFilter}
          sort={sortOrder}
          setSort={setSortOrder}
          onResetFilters={handleResetFilters}
        />

        {/* Live Alerts Feed Table */}
        <AlertFeed
          alerts={alerts}
          recentAlertIds={recentAlertIds}
          onSelectAlert={setSelectedAlert}
          isLoading={isLoading}
        />
      </main>

      {/* Alert Inspection & Action Drawer */}
      {selectedAlert && (
        <AlertDetailDrawer
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onStatusUpdated={handleStatusUpdated}
        />
      )}
    </div>
  );
}
