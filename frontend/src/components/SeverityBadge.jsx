import React from 'react';
import { AlertOctagon, AlertTriangle, Info, ShieldAlert } from 'lucide-react';

const SEVERITY_CONFIG = {
  CRITICAL: {
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    border: 'border-red-500/30',
    icon: AlertOctagon,
    label: 'CRITICAL',
  },
  HIGH: {
    bg: 'bg-orange-500/15',
    text: 'text-orange-400',
    border: 'border-orange-500/30',
    icon: ShieldAlert,
    label: 'HIGH',
  },
  MEDIUM: {
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    icon: AlertTriangle,
    label: 'MEDIUM',
  },
  LOW: {
    bg: 'bg-blue-500/15',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
    icon: Info,
    label: 'LOW',
  },
};

export default function SeverityBadge({ severity, size = 'sm' }) {
  const norm = (severity || 'LOW').toUpperCase();
  const conf = SEVERITY_CONFIG[norm] || SEVERITY_CONFIG.LOW;
  const IconComponent = conf.icon;

  const isSmall = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium tracking-wide uppercase ${conf.bg} ${conf.text} ${conf.border} ${
        isSmall ? 'text-xs' : 'text-sm'
      }`}
    >
      <IconComponent className={isSmall ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      {conf.label}
    </span>
  );
}
