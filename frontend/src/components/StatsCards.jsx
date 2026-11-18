import React from 'react';
import { AlertOctagon, Activity, ShieldAlert, AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react';

export default function StatsCards({ stats = {} }) {
  const total = stats.total || 0;
  const bySeverity = stats.bySeverity || { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const byStatus = stats.byStatus || { OPEN: 0, INVESTIGATING: 0, RESOLVED: 0, DISMISSED: 0 };
  const avgRiskScore = typeof stats.avgRiskScore === 'number'
    ? stats.avgRiskScore.toFixed(1)
    : !isNaN(Number(stats.avgRiskScore))
    ? Number(stats.avgRiskScore).toFixed(1)
    : '0.0';

  const criticalCount = bySeverity.CRITICAL || 0;
  const highCount = bySeverity.HIGH || 0;
  const mediumCount = bySeverity.MEDIUM || 0;
  const openCount = (byStatus.OPEN || 0) + (byStatus.INVESTIGATING || 0);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {/* Total Alerts */}
      <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-[11px] font-semibold uppercase tracking-wider">Total</span>
          <Activity className="w-3.5 h-3.5 text-indigo-400" />
        </div>
        <div className="mt-2">
          <div className="text-xl font-bold font-mono text-white tracking-tight">{total.toLocaleString()}</div>
          <span className="text-[10px] text-slate-500">All-time detected</span>
        </div>
      </div>

      {/* Critical Alerts */}
      <div className="p-3.5 rounded-xl bg-red-950/20 border border-red-900/40 backdrop-blur-sm flex flex-col justify-between">
        <div className="flex items-center justify-between text-red-400">
          <span className="text-[11px] font-semibold uppercase tracking-wider">Critical</span>
          <AlertOctagon className="w-3.5 h-3.5 text-red-400" />
        </div>
        <div className="mt-2">
          <div className="text-xl font-bold font-mono text-red-300 tracking-tight">{criticalCount.toLocaleString()}</div>
          <span className="text-[10px] text-red-500/80">Geo & suspicious</span>
        </div>
      </div>

      {/* High Severity */}
      <div className="p-3.5 rounded-xl bg-orange-950/20 border border-orange-900/40 backdrop-blur-sm flex flex-col justify-between">
        <div className="flex items-center justify-between text-orange-400">
          <span className="text-[11px] font-semibold uppercase tracking-wider">High</span>
          <ShieldAlert className="w-3.5 h-3.5 text-orange-400" />
        </div>
        <div className="mt-2">
          <div className="text-xl font-bold font-mono text-orange-300 tracking-tight">{highCount.toLocaleString()}</div>
          <span className="text-[10px] text-orange-500/80">Large amounts</span>
        </div>
      </div>

      {/* Medium Severity */}
      <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-900/40 backdrop-blur-sm flex flex-col justify-between">
        <div className="flex items-center justify-between text-amber-400">
          <span className="text-[11px] font-semibold uppercase tracking-wider">Medium</span>
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <div className="mt-2">
          <div className="text-xl font-bold font-mono text-amber-300 tracking-tight">{mediumCount.toLocaleString()}</div>
          <span className="text-[10px] text-amber-500/80">Velocity bursts</span>
        </div>
      </div>

      {/* Active Queue */}
      <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-[11px] font-semibold uppercase tracking-wider">Active Queue</span>
          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
        </div>
        <div className="mt-2">
          <div className="text-xl font-bold font-mono text-cyan-300 tracking-tight">{openCount.toLocaleString()}</div>
          <span className="text-[10px] text-slate-500">Open & triage</span>
        </div>
      </div>

      {/* Average Risk Score */}
      <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-[11px] font-semibold uppercase tracking-wider">Avg Risk</span>
          <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
        </div>
        <div className="mt-2">
          <div className="text-xl font-bold font-mono text-purple-300 tracking-tight">{avgRiskScore}</div>
          <span className="text-[10px] text-slate-500">Max score 100</span>
        </div>
      </div>
    </div>
  );
}
