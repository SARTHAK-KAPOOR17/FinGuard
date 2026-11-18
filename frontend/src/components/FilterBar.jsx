import React from 'react';
import { Search, Filter, ArrowUpDown, X } from 'lucide-react';

const SEVERITIES = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const STATUSES = ['ALL', 'OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'];

export default function FilterBar({
  severity = 'ALL',
  setSeverity,
  status = 'ALL',
  setStatus,
  userId = '',
  setUserId,
  sort = 'createdAt',
  setSort,
  onResetFilters,
}) {
  const isFiltered = severity !== 'ALL' || status !== 'ALL' || Boolean(userId && userId.trim());

  return (
    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Severity Tabs / Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-400 mr-1 uppercase flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-slate-400" /> Severity:
          </span>
          {SEVERITIES.map((sev) => {
            const isActive = severity === sev;
            return (
              <button
                key={sev}
                type="button"
                onClick={() => setSeverity(sev)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? sev === 'CRITICAL'
                      ? 'bg-red-500/20 text-red-300 border border-red-500/40 shadow-sm'
                      : sev === 'HIGH'
                      ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40 shadow-sm'
                      : sev === 'MEDIUM'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                      : sev === 'LOW'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm'
                      : 'bg-indigo-600 text-white font-semibold shadow-sm'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-700/80 border border-slate-700/40'
                }`}
              >
                {sev}
              </button>
            );
          })}
        </div>

        {/* Sort & Status Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Select */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="status-select" className="text-xs text-slate-400">Status:</label>
            <select
              id="status-select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Select */}
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="createdAt">Newest First</option>
              <option value="riskScore">Highest Risk Score</option>
            </select>
          </div>
        </div>
      </div>

      {/* User ID Search & Filter Summary */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by User ID (e.g. user_123)..."
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full bg-slate-950/70 border border-slate-700/70 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {isFiltered && (
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Clear Active Filters
          </button>
        )}
      </div>
    </div>
  );
}
