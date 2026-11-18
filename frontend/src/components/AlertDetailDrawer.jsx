import React, { useState } from 'react';
import { X, ShieldAlert, MapPin, Clock, DollarSign, User, Store, Check, AlertCircle, FileText, Send, RotateCcw } from 'lucide-react';
import SeverityBadge from './SeverityBadge';
import RiskScoreBar from './RiskScoreBar';
import { updateAlertStatus } from '../services/api';

const STATUS_CONFIG = {
  OPEN: { bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  INVESTIGATING: { bg: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  RESOLVED: { bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  DISMISSED: { bg: 'bg-slate-700/30 text-slate-400 border-slate-700/50' },
};

export default function AlertDetailDrawer({ alert: initialAlert, onClose, onStatusUpdated }) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [analystNote, setAnalystNote] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [alert, setAlert] = useState(initialAlert);

  React.useEffect(() => {
    setAlert(initialAlert);
  }, [initialAlert]);

  if (!alert) return null;

  const statusStyle = STATUS_CONFIG[alert.status] || STATUS_CONFIG.OPEN;

  // Strict transitions allowed by FinGuard Alert State Machine
  // OPEN -> INVESTIGATING, DISMISSED
  // INVESTIGATING -> RESOLVED, DISMISSED, OPEN
  // RESOLVED -> INVESTIGATING (reopen)
  // DISMISSED -> INVESTIGATING (reopen)
  const canInvestigate = alert.status === 'OPEN';
  const canReopen = alert.status === 'RESOLVED' || alert.status === 'DISMISSED';
  const canResolve = alert.status === 'INVESTIGATING';
  const canDismiss = alert.status === 'OPEN' || alert.status === 'INVESTIGATING';
  const canReQueue = alert.status === 'INVESTIGATING';
  const canAddNoteOnly = alert.status === 'INVESTIGATING';

  const handleStatusChange = async (newStatus) => {
    setIsUpdating(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const updated = await updateAlertStatus(alert.alertId, {
        status: newStatus,
        analyst: 'analyst_lead_sarah',
        note: analystNote.trim(),
      });
      setAlert(updated);
      setSuccessMsg(`Status successfully transitioned to ${newStatus}`);
      setAnalystNote('');
      if (onStatusUpdated) {
        onStatusUpdated(updated);
      }
    } catch (err) {
      const msg = err.message || 'Status transition failed';
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('missing or invalid api key')) {
        setErrorMsg('401 Unauthorized: Invalid or missing API key.');
      } else if (msg.includes('400') || msg.toLowerCase().includes('validation')) {
        setErrorMsg(`400 Bad Request: ${msg}`);
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end">
      <div className="w-full max-w-xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-3">
            <SeverityBadge severity={alert.severity} size="md" />
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase border ${statusStyle.bg}`}>
              {alert.status}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Alert Title & Identifiers */}
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Alert Inspection</h2>
            <div className="mt-1 space-y-0.5 text-xs font-mono text-slate-400">
              <p>Alert ID: <span className="text-slate-200 font-semibold">{alert.alertId}</span></p>
              <p>Txn ID: <span className="text-slate-400">{alert.txnId}</span></p>
            </div>
          </div>

          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Amount
              </span>
              <div className="mt-1 text-lg font-bold text-white font-mono">
                ${Number(alert.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-purple-400" /> Risk Score
              </span>
              <div className="mt-1">
                <RiskScoreBar score={alert.riskScore} />
              </div>
            </div>
          </div>

          {/* Transaction Metadata */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Transaction Details</h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-start gap-2">
                <User className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-slate-500 block">User Account</span>
                  <span className="text-white font-mono font-medium">{alert.userId}</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Store className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-slate-500 block">Merchant</span>
                  <span className="text-white font-medium">{alert.merchant || 'Unknown Merchant'}</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-slate-500 block">Location</span>
                  <span className="text-white font-medium">
                    {alert.location?.country || 'N/A'}, {alert.location?.city || 'N/A'}
                  </span>
                  {alert.location?.lat !== undefined && (
                    <span className="block text-[11px] text-slate-500 font-mono">
                      {alert.location.lat.toFixed(4)}, {alert.location.lng?.toFixed(4)}
                    </span>
                  )}
                  {alert.location?.latitude !== undefined && (
                    <span className="block text-[11px] text-slate-500 font-mono">
                      {alert.location.latitude.toFixed(4)}, {alert.location.longitude?.toFixed(4)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-slate-500 block">Flagged Timestamp</span>
                  <span className="text-white font-mono text-[11px]">
                    {alert.flaggedAt ? new Date(alert.flaggedAt).toLocaleString() : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Triggered Rules Breakdown */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Triggered Rules ({alert.matchedRules?.length || 0})
            </h3>
            <div className="space-y-2">
              {alert.matchedRules && alert.matchedRules.length > 0 ? (
                alert.matchedRules.map((rule, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-indigo-300">{rule.ruleId}</span>
                      <SeverityBadge severity={rule.severity} size="sm" />
                    </div>
                    {rule.reason && (
                      <p className="text-xs text-slate-300 leading-relaxed">{rule.reason}</p>
                    )}
                    {rule.metadata && Object.keys(rule.metadata).length > 0 && (
                      <div className="text-[11px] font-mono text-slate-400 bg-slate-900/80 p-2 rounded border border-slate-800/80 mt-1">
                        {Object.entries(rule.metadata).map(([key, val]) => (
                          <div key={key} className="flex justify-between">
                            <span className="text-slate-500">{key}:</span>
                            <span className="text-slate-300 font-semibold">{String(val)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500 italic">No detailed rule metadata available.</p>
              )}
            </div>
          </div>

          {/* Audit Notes Timeline */}
          <div id="notes-timeline" className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-slate-400" /> Notes Timeline ({alert.notes?.length || 0})
            </h3>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {alert.notes && alert.notes.length > 0 ? (
                alert.notes.map((note, idx) => {
                  const isAudit = note.text?.startsWith('Status changed');
                  return (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-lg border text-xs ${
                        isAudit
                          ? 'bg-amber-950/20 border-amber-900/40 text-amber-200/90'
                          : 'bg-slate-950/50 border-slate-800/70 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                          {note.author}
                          {isAudit && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                              AUDIT
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {note.createdAt ? new Date(note.createdAt).toLocaleString() : ''}
                        </span>
                      </div>
                      <p className={isAudit ? 'text-amber-300 font-mono text-[11px]' : 'text-slate-300'}>
                        {note.text}
                      </p>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-slate-500 italic">No analyst notes recorded yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Drawer Footer: Actions */}
        <div className="p-5 border-t border-slate-800 bg-slate-950/80 space-y-3 shrink-0">
          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-800/80 text-red-300 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMsg('')}
                className="text-red-400 hover:text-red-200 p-0.5 rounded"
                title="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {successMsg && (
            <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Optional Note Input with Analyst Indicator */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Investigation Note</span>
              <span className="text-[10px] text-indigo-400 font-mono">Analyst: analyst_lead_sarah</span>
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder="Add investigation or audit note..."
                value={analystNote}
                onChange={(e) => setAnalystNote(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Action Transition Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canInvestigate && (
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => handleStatusChange('INVESTIGATING')}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                Mark Investigating
              </button>
            )}

            {canReopen && (
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => handleStatusChange('INVESTIGATING')}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reopen Investigation
              </button>
            )}

            {canResolve && (
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => handleStatusChange('RESOLVED')}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                Resolve Threat
              </button>
            )}

            {canReQueue && (
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => handleStatusChange('OPEN')}
                className="px-3 py-1.5 rounded-lg bg-blue-600/80 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                Return to Queue
              </button>
            )}

            {canAddNoteOnly && analystNote.trim().length > 0 && (
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => handleStatusChange('INVESTIGATING')}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center gap-1"
              >
                <Send className="w-3 h-3" />
                Add Note Only
              </button>
            )}

            {canDismiss && (
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => handleStatusChange('DISMISSED')}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 border border-slate-700 text-xs font-semibold transition-colors"
              >
                Dismiss False Positive
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
