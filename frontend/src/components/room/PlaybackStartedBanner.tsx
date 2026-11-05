/**
 * PlaybackStartedBanner — Phase 4 placeholder
 *
 * Shown briefly after `playback_start` is received while the full
 * synchronized video player (Phase 5) is not yet built.
 * Gives users clear visual confirmation that sync is complete.
 */
import React, { useEffect } from 'react';
import { Play } from 'lucide-react';
import { Button } from '../common/Button';

interface PlaybackStartedBannerProps {
  episodeId: string | null; // reserved for Phase 5 player integration
  onDismiss: () => void;
}

export const PlaybackStartedBanner: React.FC<PlaybackStartedBannerProps> = ({
  episodeId: _episodeId, // reserved for Phase 5 player integration
  onDismiss,
}) => {
  // Auto-dismiss after 6 seconds
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed inset-x-0 top-0 z-40 flex justify-center pt-4 pointer-events-none">
      <div
        className="pointer-events-auto flex items-center gap-4 px-6 py-4 rounded-2xl
          bg-emerald-950/95 border border-emerald-700 shadow-2xl backdrop-blur-md
          animate-in slide-in-from-top-4 duration-500"
      >
        <div className="w-10 h-10 rounded-full bg-emerald-900 border border-emerald-700 flex items-center justify-center">
          <Play className="w-5 h-5 text-emerald-400 fill-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-bold text-emerald-300">Synchronized Playback Started!</p>
          <p className="text-xs text-emerald-500 font-mono mt-0.5">
            Both players are now in sync. Open your local video file and begin watching.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss} className="text-emerald-400">
          Dismiss
        </Button>
      </div>
    </div>
  );
};
