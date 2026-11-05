/**
 * AnimeSync — Sync Health UI Badge & Controls (Phase 5 Task 5.6)
 *
 * Displays live synchronization diagnostics and manual Resync trigger:
 * - Status indicator: Synced (emerald), Nudging (amber), Buffering (violet), Paused (zinc)
 * - Live network latency (ping/pong round-trip ms)
 * - Live playback drift (ms offset from server-authoritative time)
 * - One-click Manual Resync button with rotation animation
 */
import React from 'react';
import { RefreshCw, Activity, CheckCircle2, Sliders, Loader2, Pause } from 'lucide-react';
import { SyncStatusState } from '../../services/drift';

export interface SyncHealthBadgeProps {
  status: SyncStatusState;
  driftSeconds: number;
  latencyMs: number | null;
  isResyncing: boolean;
  onResync: () => void;
  compact?: boolean;
  className?: string;
}

export const SyncHealthBadge: React.FC<SyncHealthBadgeProps> = ({
  status,
  driftSeconds,
  latencyMs,
  isResyncing,
  onResync,
  compact = false,
  className = '',
}) => {
  const driftMs = Math.round(driftSeconds * 1000);

  // Status visual attributes
  const statusConfig = {
    SYNCED: {
      label: 'Synced',
      dotClass: 'bg-emerald-400',
      badgeClass: 'bg-emerald-950/70 border-emerald-800/80 text-emerald-300',
      icon: <CheckCircle2 className="w-3 h-3 text-emerald-400" />,
    },
    NUDGING: {
      label: 'Nudging',
      dotClass: 'bg-amber-400 animate-ping',
      badgeClass: 'bg-amber-950/80 border-amber-800/80 text-amber-300',
      icon: <Sliders className="w-3 h-3 text-amber-400" />,
    },
    BUFFERING: {
      label: 'Buffering',
      dotClass: 'bg-violet-400 animate-pulse',
      badgeClass: 'bg-violet-950/80 border-violet-800/80 text-violet-300',
      icon: <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />,
    },
    PAUSED: {
      label: 'Paused',
      dotClass: 'bg-void-400',
      badgeClass: 'bg-void-800/80 border-void-700/80 text-ink-muted',
      icon: <Pause className="w-3 h-3 text-ink-dim" />,
    },
  }[status];

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {/* Compact status pill */}
        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono shadow-sm ${statusConfig.badgeClass}`}
          title={`Status: ${statusConfig.label} | Drift: ${driftMs}ms | Ping: ${
            latencyMs !== null ? `${latencyMs}ms` : '--'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dotClass}`} />
          <span className="font-semibold">{statusConfig.label}</span>
          <span className="text-ink-dim font-normal">({driftMs > 0 ? `+${driftMs}` : driftMs}ms)</span>
        </div>

        {/* Compact Resync button */}
        <button
          onClick={onResync}
          disabled={isResyncing}
          className="p-1 rounded-lg hover:bg-white/10 text-ink-muted hover:text-white transition-colors disabled:opacity-50"
          title="Manual Resync: align with authoritative server timestamp"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isResyncing ? 'animate-spin text-cyan-400' : ''}`} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2 p-1 pl-2.5 pr-1.5 rounded-xl bg-void-900/90 border border-void-700/70 shadow-lg text-xs font-mono select-none ${className}`}
    >
      {/* 1. Sync Status Badge */}
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${statusConfig.dotClass}`} />
        <span className="font-bold text-white tracking-wide">{statusConfig.label}</span>
      </div>

      <span className="text-void-600">|</span>

      {/* 2. Measured Drift */}
      <div className="flex items-center gap-1 text-[11px] text-ink-dim">
        <span className="text-ink-muted">Drift:</span>
        <span
          className={`font-semibold ${
            Math.abs(driftMs) > 250
              ? 'text-amber-400'
              : Math.abs(driftMs) > 1500
              ? 'text-rose-400'
              : 'text-cyan-300'
          }`}
        >
          {driftMs > 0 ? `+${driftMs}` : driftMs}ms
        </span>
      </div>

      <span className="text-void-600">|</span>

      {/* 3. Live Latency Ping */}
      <div className="flex items-center gap-1 text-[11px] text-ink-dim">
        <Activity className="w-3 h-3 text-cyan-400" />
        <span className="text-ink-muted">Ping:</span>
        <span className="font-semibold text-white">
          {latencyMs !== null ? `${latencyMs}ms` : '--'}
        </span>
      </div>

      {/* 4. Manual Resync Action Button */}
      <button
        onClick={onResync}
        disabled={isResyncing}
        className="ml-1 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-void-800 hover:bg-void-700 border border-void-600 text-white text-[11px] font-medium transition-all hover:border-cyan-500/50 hover:text-cyan-300 disabled:opacity-50 shadow-sm"
        title="Query authoritative server state and hard-align local player"
      >
        <RefreshCw className={`w-3 h-3 ${isResyncing ? 'animate-spin text-cyan-400' : ''}`} />
        <span>{isResyncing ? 'Syncing...' : 'Resync'}</span>
      </button>
    </div>
  );
};
