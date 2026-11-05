/**
 * useReadyState — Phase 4: Ready-to-Watch System
 *
 * Manages the client-side ready state machine:
 *  - Sends `set_ready` / `set_unready` to the server.
 *  - Listens for `countdown_started`, `countdown_cancelled`, `playback_start`,
 *    `ready_acknowledged`, `unready_acknowledged`, and `ready_rejected`.
 *  - Derives a live countdown ticker from `target_start_timestamp` using
 *    `requestAnimationFrame` so the display is smooth without extra intervals.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';

export interface CountdownState {
  /** Whether a synchronized countdown is currently active for this room. */
  active: boolean;
  /** Seconds remaining (rounded down). -1 when no countdown. */
  secondsRemaining: number;
  /** Exact UNIX timestamp (seconds) at which playback will start. */
  targetTimestamp: number | null;
  /** Episode ID associated with the countdown. */
  episodeId: string | null;
}

export interface UseReadyStateResult {
  /** Whether THIS participant has status == READY on the server. */
  isReady: boolean;
  /** Whether a readiness operation is in progress (waiting for server ack). */
  isPending: boolean;
  /** Most recent rejection reason from the server, if any. */
  rejectionReason: string | null;
  /** Live countdown state for the room. */
  countdown: CountdownState;
  /** Mark this participant as ready. No-op if already READY or not VERIFIED. */
  markReady: () => void;
  /** Withdraw ready status. No-op if not READY. */
  markUnready: () => void;
  /** Whether playback_start has fired (time to open the player). */
  playbackStarted: boolean;
  /** Episode ID from playback_start event. */
  playbackEpisodeId: string | null;
  /** Reset playbackStarted flag after consumer reacts to it. */
  acknowledgePlayback: () => void;
}

const INITIAL_COUNTDOWN: CountdownState = {
  active: false,
  secondsRemaining: -1,
  targetTimestamp: null,
  episodeId: null,
};

export function useReadyState(
  socket: Socket | null,
  currentStatus: string | undefined
): UseReadyStateResult {
  const [isReady, setIsReady] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<CountdownState>(INITIAL_COUNTDOWN);
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const [playbackEpisodeId, setPlaybackEpisodeId] = useState<string | null>(null);

  // Tracks requestAnimationFrame id for cleanup
  const rafRef = useRef<number | null>(null);
  const countdownTargetRef = useRef<number | null>(null);
  const countdownEpisodeRef = useRef<string | null>(null);

  // Keep local isReady in sync with authoritative server status from presence
  useEffect(() => {
    setIsReady(currentStatus === 'READY');
  }, [currentStatus]);

  // rAF ticker: updates secondsRemaining every animation frame
  const startTicker = useCallback((targetTimestamp: number, episodeId: string) => {
    countdownTargetRef.current = targetTimestamp;
    countdownEpisodeRef.current = episodeId;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    const tick = () => {
      const remaining = Math.max(0, (countdownTargetRef.current ?? 0) - Date.now() / 1000);
      setCountdown({
        active: true,
        secondsRemaining: Math.ceil(remaining),
        targetTimestamp: countdownTargetRef.current,
        episodeId: countdownEpisodeRef.current,
      });

      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Countdown finished; playback_start event from server will handle the rest
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopTicker = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    countdownTargetRef.current = null;
    countdownEpisodeRef.current = null;
    setCountdown(INITIAL_COUNTDOWN);
  }, []);

  // Wire up socket listeners
  useEffect(() => {
    if (!socket) return;

    const handleReadyAck = () => {
      setIsReady(true);
      setIsPending(false);
      setRejectionReason(null);
    };

    const handleUnreadyAck = () => {
      setIsReady(false);
      setIsPending(false);
    };

    const handleReadyRejected = (data: { reason: string; message: string }) => {
      setIsPending(false);
      setRejectionReason(data.message || data.reason || 'Cannot mark ready right now.');
    };

    const handleCountdownStarted = (data: {
      room_code: string;
      episode_id: string;
      target_start_timestamp: number;
      countdown_seconds: number;
    }) => {
      setRejectionReason(null);
      startTicker(data.target_start_timestamp, data.episode_id);
    };

    const handleCountdownCancelled = (_data: {
      room_code: string;
      cancelled_by: string;
      reason: string;
    }) => {
      stopTicker();
    };

    const handlePlaybackStart = (data: { room_code: string; episode_id: string; timestamp: number }) => {
      stopTicker();
      setPlaybackEpisodeId(data.episode_id);
      setPlaybackStarted(true);
    };

    const handleEpisodeChanged = () => {
      // Server reset all statuses; local state reflects that via presence_updated
      stopTicker();
      setIsReady(false);
      setIsPending(false);
      setRejectionReason(null);
    };

    socket.on('ready_acknowledged', handleReadyAck);
    socket.on('unready_acknowledged', handleUnreadyAck);
    socket.on('ready_rejected', handleReadyRejected);
    socket.on('countdown_started', handleCountdownStarted);
    socket.on('countdown_cancelled', handleCountdownCancelled);
    socket.on('playback_start', handlePlaybackStart);
    socket.on('episode_changed', handleEpisodeChanged);

    return () => {
      socket.off('ready_acknowledged', handleReadyAck);
      socket.off('unready_acknowledged', handleUnreadyAck);
      socket.off('ready_rejected', handleReadyRejected);
      socket.off('countdown_started', handleCountdownStarted);
      socket.off('countdown_cancelled', handleCountdownCancelled);
      socket.off('playback_start', handlePlaybackStart);
      socket.off('episode_changed', handleEpisodeChanged);
    };
  }, [socket, startTicker, stopTicker]);

  // Cleanup ticker on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const markReady = useCallback(() => {
    if (!socket || isPending || isReady) return;
    setIsPending(true);
    setRejectionReason(null);
    socket.emit('set_ready', {});
  }, [socket, isPending, isReady]);

  const markUnready = useCallback(() => {
    if (!socket || isPending || !isReady) return;
    setIsPending(true);
    socket.emit('set_unready', {});
  }, [socket, isPending, isReady]);

  const acknowledgePlayback = useCallback(() => {
    setPlaybackStarted(false);
  }, []);

  return {
    isReady,
    isPending,
    rejectionReason,
    countdown,
    markReady,
    markUnready,
    playbackStarted,
    playbackEpisodeId,
    acknowledgePlayback,
  };
}
