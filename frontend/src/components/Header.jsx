import React from 'react';
import { ShieldCheck, Wifi, WifiOff, Loader2, Radio } from 'lucide-react';

export default function Header({ connectionState = 'disconnected', bufferCount = 0, isMaxReached = false }) {
  const isConnected = connectionState === 'connected';
  const isReconnecting = connectionState === 'reconnecting';

  return (
    <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
        {/* Brand & Title */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/20 to-blue-600/30 border border-indigo-500/30 text-indigo-400 shadow-inner">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                FinGuard <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">SOC</span>
              </h1>
            </div>
            <p className="text-xs text-slate-400">Real-Time Threat Surveillance & Fraud Alerts</p>
          </div>
        </div>

        {/* Live Status Indicators */}
        <div className="flex items-center gap-4">
          {/* Buffer Capacity Badge */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50 text-xs text-slate-300">
            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span>
              Live Buffer: <strong className="text-white font-mono">{bufferCount}</strong>
              <span className="text-slate-500"> / 200</span>
            </span>
          </div>

          {/* Connection Status Badge */}
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium tracking-wide transition-colors ${
              isConnected
                ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                : isReconnecting
                ? 'bg-amber-950/60 text-amber-400 border-amber-800/60'
                : 'bg-rose-950/60 text-rose-400 border-rose-800/60'
            }`}
          >
            {isConnected ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>LIVE FEED CONNECTED</span>
              </>
            ) : isReconnecting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span>RECONNECTING...</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                <span>DISCONNECTED</span>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
