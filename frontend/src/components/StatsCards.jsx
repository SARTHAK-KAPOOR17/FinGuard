import React from 'react';
import { AlertOctagon, Activity, ShieldAlert, CheckCircle2, TrendingUp } from 'lucide-react';

export default function StatsCards({ stats = {} }) {
  const total = stats.total || 0;
  const bySeverity = stats.bySeverity || { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const byStatus = stats.byStatus || { OPEN: 0, INVESTIGATING: 0, RESOLVED: 0, DISMISSED: 0 };
  const avgRiskScore = typeof stats.avgRiskScore === 'number' ? stats.avgRiskScore.toFixed(1) : '0.0';

  const criticalCount = bySeverity.CRITICAL || 0;
  const elevatedCount = (bySeverity.HIGH || 0) + (bySeverity.MEDIUM || 0);
  const openCount = (byStatus.OPEN || 0) + (byStatus.INVESTIGATING || 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {/* Total Alerts */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-semibold uppercase tracking-wider">Total Alerts</span>
          <Activity className="w-4 h-4 text-indigo-400" />
        </div>
        <div className="mt-2">
          <div className="text-2xl font-bold font-mono text-white tracking-tight">{total.toLocaleString()}</div>
          <span className="text-[11px] text-slate-500">All-time detected</span>
        </div>
      </div>

      {/* Critical Alerts */}
      <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/40 backdrop-blur-sm flex flex-col justify-between">
        <div className="flex items-center justify-between text-red-400">
          <span className="text-xs font-semibold uppercase tracking-wider">Critical</span>
          <AlertOctagon className="w-4 h-4 text-red-400" />
        </div>
        <div className="mt-2">
          <div className="text-2xl font-bold font-mono text-red-300 tracking-tight">{criticalCount.toLocaleString()}</div>
          <span className="text-[11px] text-red-500/80">Immediate attention</span>
        </div>
      </div>

      {/* High & Medium */}
      <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-900/40 backdrop-blur-sm flex flex-col justify-between">
        <div className="flex items-center justify-between text-amber-400">
          <span className="text-xs font-semibold uppercase tracking-wider">High / Med</span>
          <ShieldAlert className="w-4 h-4 text-amber-400" />
        </div>
        <div className="mt-2">
          <div className="text-2xl font-bold font-mono text-amber-300 tracking-tight">{elevatedCount.toLocaleString()}</div>
          <span className="text-[11px] text-amber-500/80">Velocity & thresholds</span>
        </div>
      </div>

      {/* Open / Investigating */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-semibold uppercase tracking-wider">Active Queue</span>
          <CheckCircle2 className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="mt-2">
          <div className="text-2xl font-bold font-mono text-cyan-300 tracking-tight">{openCount.toLocaleString()}</div>
          <span className="text-[11px] text-slate-500">Open or in-review</span>
        </div>
      </div>

      {/* Average Risk Score */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm flex flex-col justify-between col-span-2 md:col-span-1">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-semibold uppercase tracking-wider">Avg Risk Score</span>
          <TrendingUp className="w-4 h-4 text-purple-400" />
        </div>
        <div className="mt-2">
          <div className="text-2xl font-bold font-mono text-purple-300 tracking-tight">{avgRiskScore}</div>
          <span className="text-[11px] text-slate-500">Out of 100 max</span>
        </div>
      </div>
    </div>
  );
}
