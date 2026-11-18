import React from 'react';
import SeverityBadge from './SeverityBadge';
import RiskScoreBar from './RiskScoreBar';
import { ExternalLink, AlertCircle, MapPin, Store, User, Clock, ChevronLeft, ChevronRight, Radio } from 'lucide-react';

const STATUS_BADGE = {
  OPEN: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  INVESTIGATING: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  RESOLVED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  DISMISSED: 'bg-slate-700/30 text-slate-400 border-slate-700/50',
};

export default function AlertFeed({
  alerts = [],
  recentAlertIds = new Set(),
  onSelectAlert,
  isLoading = false,
  page = 1,
  setPage,
  totalPages = 1,
  totalCount = 0,
  limit = 20,
}) {
  if (isLoading && alerts.length === 0) {
    return (
      <div className="p-12 text-center rounded-xl bg-slate-900/60 border border-slate-800">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-500 border-t-transparent mb-3" />
        <p className="text-sm text-slate-400">Loading incoming alert stream...</p>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="p-12 text-center rounded-xl bg-slate-900/60 border border-slate-800">
        <AlertCircle className="w-10 h-10 text-slate-600 mx-auto mb-2" />
        <h3 className="text-base font-semibold text-slate-300">No alerts match the current filter</h3>
        <p className="text-xs text-slate-500 mt-1">
          Waiting for live events or adjust your active severity, status, or User ID filters.
        </p>
      </div>
    );
  }

  const isLiveActive = page === 1;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm overflow-hidden flex flex-col">
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              <th className="py-3 px-4">Time</th>
              <th className="py-3 px-4">Severity</th>
              <th className="py-3 px-4">Risk Score</th>
              <th className="py-3 px-4">Amount</th>
              <th className="py-3 px-4">User ID</th>
              <th className="py-3 px-4">Merchant / City</th>
              <th className="py-3 px-4">Triggered Rules</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Inspect</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-xs">
            {alerts.map((alert) => {
              const isRecent = recentAlertIds.has(alert.alertId);
              const statusClass = STATUS_BADGE[alert.status] || STATUS_BADGE.OPEN;
              const formattedDate = alert.flaggedAt
                ? new Date(alert.flaggedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : 'Now';

              return (
                <tr
                  key={alert.alertId || alert._id}
                  onClick={() => onSelectAlert(alert)}
                  className={`cursor-pointer transition-colors duration-150 hover:bg-slate-800/50 ${
                    isRecent ? 'animate-new-alert' : ''
                  }`}
                >
                  {/* Timestamp */}
                  <td className="py-3 px-4 whitespace-nowrap text-slate-400 font-mono text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      {formattedDate}
                    </div>
                  </td>

                  {/* Severity */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <SeverityBadge severity={alert.severity} size="sm" />
                  </td>

                  {/* Risk Score */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <RiskScoreBar score={alert.riskScore} />
                  </td>

                  {/* Amount */}
                  <td className="py-3 px-4 whitespace-nowrap font-mono font-bold text-white">
                    ${Number(alert.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>

                  {/* User ID */}
                  <td className="py-3 px-4 whitespace-nowrap font-mono text-indigo-300 font-medium">
                    <div className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-500" />
                      {alert.userId}
                    </div>
                  </td>

                  {/* Merchant & Location */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="text-slate-200 font-medium flex items-center gap-1">
                        <Store className="w-3 h-3 text-cyan-400" />
                        {alert.merchant || 'General Merchant'}
                      </span>
                      <span className="text-[11px] text-slate-500 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-rose-400" />
                        {alert.location?.city || alert.location?.country || 'Global'}
                      </span>
                    </div>
                  </td>

                  {/* Triggered Rules */}
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {alert.matchedRules && alert.matchedRules.length > 0 ? (
                        alert.matchedRules.map((rule, idx) => (
                          <span
                            key={idx}
                            className="inline-block px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300"
                          >
                            {rule.ruleId}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-500 text-[11px]">N/A</span>
                      )}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${statusClass}`}
                    >
                      {alert.status}
                    </span>
                  </td>

                  {/* Action */}
                  <td className="py-3 px-4 whitespace-nowrap text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAlert(alert);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
                      title="Inspect Alert"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-4 py-3 border-t border-slate-800 bg-slate-950/40 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-400">
          {isLiveActive ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              Live prepending active (Page 1)
            </span>
          ) : (
            <span className="text-amber-400">
              Historical mode (Page {page}) - Live prepending paused
            </span>
          )}
          <span className="text-slate-600">|</span>
          <span>
            Total: <strong className="text-slate-200">{totalCount.toLocaleString()}</strong> alerts
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-slate-400">
            Page <strong className="text-slate-200">{page}</strong> of{' '}
            <strong className="text-slate-200">{totalPages || 1}</strong>
          </span>

          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(Math.max(1, page - 1))}
            className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
            title="Previous Page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
            title="Next Page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
