import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import StatsCards from './components/StatsCards';
import FilterBar from './components/FilterBar';
import AlertFeed from './components/AlertFeed';
import AlertDetailDrawer from './components/AlertDetailDrawer';
import { fetchAlerts, fetchAlertStats } from './services/api';
import { socketManager } from './services/socket';

const MAX_BUFFER_CAP = 200;
const BATCH_FLUSH_INTERVAL_MS = 250;
const PAGE_LIMIT = 20;

export default function App() {
  const [connectionState, setConnectionState] = useState('disconnected');
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    byStatus: { OPEN: 0, INVESTIGATING: 0, RESOLVED: 0, DISMISSED: 0 },
    avgRiskScore: 0,
  });

  // Filter & Pagination state
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [sortOrder, setSortOrder] = useState('-createdAt');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [recentAlertIds, setRecentAlertIds] = useState(new Set());

  // Ref buffer for batching incoming WebSocket events every 250ms
  const pendingBatchRef = useRef([]);

  // Active filters and page ref for asynchronous socket callbacks
  const filterStateRef = useRef({
    severity: severityFilter,
    status: statusFilter,
    userId: userIdFilter,
    page: 1,
    isAllAlertsRoom: true,
  });

  useEffect(() => {
    filterStateRef.current = {
      severity: severityFilter,
      status: statusFilter,
      userId: userIdFilter,
      page,
      isAllAlertsRoom: severityFilter === 'ALL',
    };
  }, [severityFilter, statusFilter, userIdFilter, page]);

  // Load stats from REST API
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

  // Load alerts with current filters & pagination from REST API
  const loadAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchAlerts({
        page,
        limit: PAGE_LIMIT,
        severity: severityFilter,
        status: statusFilter,
        userId: userIdFilter,
        sort: sortOrder,
      });

      const fetchedAlerts = result.data || [];
      setTotalPages(result.totalPages || 1);
      setTotalCount(result.total || 0);

      setAlerts((prev) => {
        // If on page 1, merge with any live alerts that arrived recently without duplicate keys
        if (page === 1) {
          const fetchedIds = new Set(fetchedAlerts.map((a) => a.alertId));
          const existingRecent = prev.filter((a) => !fetchedIds.has(a.alertId));
          return [...existingRecent, ...fetchedAlerts].slice(0, MAX_BUFFER_CAP);
        }
        return fetchedAlerts;
      });
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [page, severityFilter, statusFilter, userIdFilter, sortOrder]);

  // Reset to page 1 whenever filters change
  const handleSeverityChange = (newSev) => {
    setSeverityFilter(newSev);
    setPage(1);
  };

  const handleStatusChange = (newStat) => {
    setStatusFilter(newStat);
    setPage(1);
  };

  const handleUserIdChange = (newUid) => {
    setUserIdFilter(newUid);
    setPage(1);
  };

  const handleSortChange = (newSort) => {
    setSortOrder(newSort);
    setPage(1);
  };

  const handleResetFilters = () => {
    setSeverityFilter('ALL');
    setStatusFilter('ALL');
    setUserIdFilter('');
    setSortOrder('-createdAt');
    setPage(1);
  };

  // Reload alerts whenever filters or page changes (with debounced search)
  useEffect(() => {
    const timer = setTimeout(() => {
      loadAlerts();
    }, 200);
    return () => clearTimeout(timer);
  }, [loadAlerts]);

  // Subscribe/unsubscribe socket room when severity filter changes
  useEffect(() => {
    socketManager.subscribeToRoom(severityFilter);
  }, [severityFilter]);

  // Dynamic stats polling: 5s if filtered room, 30s if all-alerts
  useEffect(() => {
    loadStats();
    const isAll = severityFilter === 'ALL';
    const intervalMs = isAll ? 30000 : 5000;
    const statsTimer = setInterval(loadStats, intervalMs);

    return () => clearInterval(statsTimer);
  }, [severityFilter, loadStats]);

  // 250ms batch flushing loop
  useEffect(() => {
    const flushInterval = setInterval(() => {
      if (pendingBatchRef.current.length === 0) return;

      // Drain pending queue
      const batch = pendingBatchRef.current;
      pendingBatchRef.current = [];

      // Only prepend to live feed if user is on Page 1
      if (filterStateRef.current.page === 1) {
        setAlerts((prev) => {
          // Deduplicate within batch and against previous alerts
          const seen = new Set();
          const uniqueBatch = [];
          for (const item of batch) {
            if (!seen.has(item.alertId)) {
              seen.add(item.alertId);
              uniqueBatch.push(item);
            }
          }

          const existingWithoutBatch = prev.filter((a) => !seen.has(a.alertId));
          return [...uniqueBatch, ...existingWithoutBatch].slice(0, MAX_BUFFER_CAP);
        });

        // Trigger red alert pulse animation on newly arrived IDs
        const newIds = batch.map((a) => a.alertId);
        setRecentAlertIds((prev) => {
          const next = new Set(prev);
          newIds.forEach((id) => next.add(id));
          return next;
        });

        setTimeout(() => {
          setRecentAlertIds((prev) => {
            const next = new Set(prev);
            newIds.forEach((id) => next.delete(id));
            return next;
          });
        }, 2000);
      }
    }, BATCH_FLUSH_INTERVAL_MS);

    return () => clearInterval(flushInterval);
  }, []);

  // Socket connection and incoming event handling
  useEffect(() => {
    socketManager.connect();

    const unsubStatus = socketManager.onStatusChange((status) => {
      setConnectionState(status);
    });

    const unsubAlert = socketManager.onAlert((incomingAlert) => {
      const { isAllAlertsRoom, severity, status, userId } = filterStateRef.current;

      // FIX B (1): Only increment global counters if in all-alerts room.
      // If room is filtered, stats polling handles accuracy.
      if (isAllAlertsRoom) {
        setStats((prev) => {
          const sev = incomingAlert.severity || 'LOW';
          const st = incomingAlert.status || 'OPEN';
          const currentBySev = { ...prev.bySeverity };
          const currentBySt = { ...prev.byStatus };

          currentBySev[sev] = (currentBySev[sev] || 0) + 1;
          currentBySt[st] = (currentBySt[st] || 0) + 1;

          return {
            ...prev,
            total: prev.total + 1,
            bySeverity: currentBySev,
            byStatus: currentBySt,
          };
        });
      }

      // Check client-side filter match
      const matchesSeverity = severity === 'ALL' || incomingAlert.severity === severity;
      const matchesStatus = status === 'ALL' || incomingAlert.status === status;
      const matchesUser =
        !userId ||
        !userId.trim() ||
        (incomingAlert.userId && incomingAlert.userId.toLowerCase().includes(userId.toLowerCase().trim()));

      if (matchesSeverity && matchesStatus && matchesUser) {
        // FIX B (2): Push to pending buffer for 250ms batch flushing
        pendingBatchRef.current.push(incomingAlert);
        setTotalCount((c) => c + 1);
      }
    });

    return () => {
      unsubStatus();
      unsubAlert();
    };
  }, []);

  // Handle status update from AlertDetailDrawer
  const handleStatusUpdated = (updatedAlert) => {
    setAlerts((prev) =>
      prev.map((a) => (a.alertId === updatedAlert.alertId ? updatedAlert : a))
    );
    setSelectedAlert(updatedAlert);
    loadStats();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header & Connection Status */}
      <Header
        connectionState={connectionState}
        bufferCount={alerts.length}
        isMaxReached={alerts.length >= MAX_BUFFER_CAP}
      />

      {/* Main Operations Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Real-time Global Stats Cards (Now with Separate High & Medium Cards) */}
        <StatsCards stats={stats} />

        {/* Filter & Search Bar */}
        <FilterBar
          severity={severityFilter}
          setSeverity={handleSeverityChange}
          status={statusFilter}
          setStatus={handleStatusChange}
          userId={userIdFilter}
          setUserId={handleUserIdChange}
          sort={sortOrder}
          setSort={handleSortChange}
          onResetFilters={handleResetFilters}
        />

        {/* Live Alerts Feed Table with Pagination Controls */}
        <AlertFeed
          alerts={alerts}
          recentAlertIds={recentAlertIds}
          onSelectAlert={setSelectedAlert}
          isLoading={isLoading}
          page={page}
          setPage={setPage}
          totalPages={totalPages}
          totalCount={totalCount}
          limit={PAGE_LIMIT}
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
