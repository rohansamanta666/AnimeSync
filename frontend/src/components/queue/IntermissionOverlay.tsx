/**
 * IntermissionOverlay — Phase 6 Task 6.4
 *
 * Full-stage ambient intermission screen shown when an episode finishes.
 * Displays countdown to the next episode, up next metadata, and host
 * options to skip or cancel auto-next.
 */
import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  FastForward,
  X,
  Film,
  ShieldCheck,
  Clock,
} from 'lucide-react';
import { IntermissionData } from '../../types';
import { Button } from '../common/Button';

export interface IntermissionOverlayProps {
  intermission: IntermissionData;
  isHost: boolean;
  onSkip: () => void;
  onCancel: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const IntermissionOverlay: React.FC<IntermissionOverlayProps> = ({
  intermission,
  isHost,
  onSkip,
  onCancel,
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(
    intermission.seconds_remaining
  );

  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now() / 1000;
      const left = Math.max(0, Math.ceil(intermission.target_advance_time - now));
      setSecondsRemaining(left);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 250);
    return () => clearInterval(interval);
  }, [intermission.target_advance_time]);

  const totalSeconds = intermission.seconds_remaining || 15;
  const progressPercent = Math.max(
    0,
    Math.min(100, ((totalSeconds - secondsRemaining) / totalSeconds) * 100)
  );

  const nextEp = intermission.next_episode;

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center p-6 bg-void-950/95 backdrop-blur-md text-center animate-in fade-in duration-300">
      {/* Background glow orb */}
      <div className="absolute w-72 h-72 rounded-full bg-violet-600/15 blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-md w-full space-y-6">
        {/* Celebration Header */}
        <div className="space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-600/30 to-pink-600/30 border border-violet-500/40 flex items-center justify-center mx-auto text-violet-300 shadow-xl shadow-violet-950/50">
            <Sparkles className="w-7 h-7 text-pink-400 animate-pulse" />
          </div>
          <h3 className="text-xl font-black text-white tracking-wide uppercase">
            Episode Complete!
          </h3>
          <p className="text-xs text-ink-muted">
            Auto-advancing to the next episode in queue
          </p>
        </div>

        {/* Up Next Preview Card */}
        {nextEp && (
          <div className="p-4 rounded-xl bg-void-900/90 border border-void-700/80 text-left space-y-2 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-pink-400 font-bold flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5" />
                Up Next
              </span>
              <span className="text-[10px] font-mono text-ink-dim">
                {formatBytes(nextEp.file_size_bytes)}
              </span>
            </div>

            <div>
              <h4 className="text-sm font-bold text-white truncate">
                {nextEp.anime_title}
              </h4>
              <p className="text-xs font-mono text-ink-dim">
                Season {nextEp.season} • Episode {nextEp.episode_number}
                {nextEp.display_title ? ` — ${nextEp.display_title}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Countdown Ticker & Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 text-violet-300 font-mono text-sm font-bold">
            <Clock className="w-4 h-4 animate-spin text-pink-400" />
            <span>Advancing in {secondsRemaining}s</span>
          </div>

          <div className="w-full h-2 rounded-full bg-void-800 overflow-hidden border border-void-700">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-pink-500 transition-all duration-300 ease-linear"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Readiness Note */}
        <div className="flex items-center justify-center gap-2 text-[11px] text-ink-muted">
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>Both participants will verify their file before watch begins</span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-center gap-3 pt-2">
          {isHost ? (
            <>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<FastForward className="w-4 h-4" />}
                onClick={onSkip}
              >
                Play Next Now
              </Button>
              <Button
                variant="outline"
                size="sm"
                leftIcon={<X className="w-4 h-4 text-rose-400" />}
                onClick={onCancel}
              >
                Cancel Auto-Next
              </Button>
            </>
          ) : (
            <p className="text-xs font-mono text-ink-dim">
              Waiting for host or countdown completion...
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
