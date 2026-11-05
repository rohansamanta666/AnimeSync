/**
 * CountdownOverlay — Phase 4
 *
 * Full-screen overlay shown when the synchronized countdown is active.
 * Displays the live seconds remaining, animates each number, and auto-dismisses
 * when the countdown expires (the server emits `playback_start`).
 */
import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { CountdownState } from '../../hooks/useReadyState';

interface CountdownOverlayProps {
  countdown: CountdownState;
  /** Called when the user wants to cancel (un-ready themselves). */
  onCancel: () => void;
}

export const CountdownOverlay: React.FC<CountdownOverlayProps> = ({ countdown, onCancel }) => {
  const [prevSeconds, setPrevSeconds] = useState(countdown.secondsRemaining);
  const [animKey, setAnimKey] = useState(0);

  // Bump animKey on each second transition to re-trigger CSS animation
  useEffect(() => {
    if (countdown.secondsRemaining !== prevSeconds) {
      setPrevSeconds(countdown.secondsRemaining);
      setAnimKey((k) => k + 1);
    }
  }, [countdown.secondsRemaining, prevSeconds]);

  if (!countdown.active) return null;

  const displaySecs = Math.max(0, countdown.secondsRemaining);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-void-950/95 backdrop-blur-md">
      {/* Ambient glow rings */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        aria-hidden="true"
      >
        <div
          className="w-96 h-96 rounded-full border border-violet-500/20 animate-ping"
          style={{ animationDuration: '1.5s' }}
        />
        <div
          className="absolute w-72 h-72 rounded-full border border-pink-500/15 animate-ping"
          style={{ animationDuration: '1.8s', animationDelay: '0.3s' }}
        />
      </div>

      {/* Main content */}
      <div className="relative text-center select-none">
        {/* Label */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <Sparkles className="w-5 h-5 text-violet-400 animate-pulse" />
          <span className="text-sm font-mono uppercase tracking-widest text-violet-300">
            Synchronized start in
          </span>
          <Sparkles className="w-5 h-5 text-violet-400 animate-pulse" />
        </div>

        {/* Countdown digit */}
        <div
          key={animKey}
          className="text-[160px] font-black leading-none countdown-digit"
          style={{
            background: 'linear-gradient(135deg, #a78bfa 0%, #f472b6 50%, #22d3ee 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            textShadow: 'none',
            animation: 'countdownPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          }}
        >
          {displaySecs}
        </div>

        {/* Sub-label */}
        <p className="text-sm text-ink-muted mt-4 font-mono tracking-wide">
          Both players will start automatically
        </p>

        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="mt-8 text-xs font-mono text-ink-dim hover:text-rose-400 transition-colors underline underline-offset-4 decoration-dotted"
        >
          Cancel — I'm not ready
        </button>
      </div>

      <style>{`
        @keyframes countdownPop {
          0% { transform: scale(1.4); opacity: 0; }
          60% { transform: scale(0.95); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

