import React from 'react';

export default function RiskScoreBar({ score = 0, showBar = true }) {
  const numericScore = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));

  // Color gradient according to risk score
  let textColor = 'text-blue-400';
  let barColor = 'bg-blue-500';
  let badgeBg = 'bg-blue-500/10 border-blue-500/20';

  if (numericScore >= 80) {
    textColor = 'text-red-400';
    barColor = 'bg-red-500';
    badgeBg = 'bg-red-500/10 border-red-500/20';
  } else if (numericScore >= 60) {
    textColor = 'text-orange-400';
    barColor = 'bg-orange-500';
    badgeBg = 'bg-orange-500/10 border-orange-500/20';
  } else if (numericScore >= 40) {
    textColor = 'text-amber-400';
    barColor = 'bg-amber-500';
    badgeBg = 'bg-amber-500/10 border-amber-500/20';
  }

  return (
    <div className="flex flex-col gap-1 min-w-[90px]">
      <div className="flex items-center justify-between">
        <span
          className={`inline-block px-1.5 py-0.5 rounded border text-xs font-mono font-bold ${textColor} ${badgeBg}`}
        >
          {numericScore}
        </span>
        <span className="text-[10px] text-slate-500 font-medium">/ 100</span>
      </div>
      {showBar && (
        <div className="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 rounded-full ${barColor}`}
            style={{ width: `${numericScore}%` }}
          />
        </div>
      )}
    </div>
  );
}
