/**
 * useVideoSync — Phase 5 Tasks 5.3 & 5.4
 *
 * Client-to-Server Playback Controls, Sequence Number Loop Prevention,
 * and Adaptive Playback Drift Correction.
 *
 * Task 5.3:
 * - Connects VideoPlayer controls (Play, Pause, Seek, Rate Change) to backend `playback_action`.
 * - Applies remote `playback_sync` events through VideoPlayerHandle.
 * - Suppresses self-echoes using originating_socket_id.
 * - Enforces monotonic sequence numbers.
 * - Protects against feedback loops using execution locks.
 *
 * Task 5.4:
 * - 2-second periodic drift evaluation while playback is active.
 * - Drift < 0.25s: Within tolerance (restores intended rate if nudging was active).
 * - Drift [0.25s, 1.5s): Micro-drift -> ±5% temporary playback speed adjustment.
 *   - Behind (drift < 0) -> +5% speed up (intendedRate * 1.05)
 *   - Ahead (drift > 0) -> -5% slow down (intendedRate * 0.95)
 * - Drift >= 1.5s: Macro-drift -> hard seek directly to authoritative position.
 * - Paused playback: Does not adjust rate when paused.
 * - Clean teardown and interval management.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { PlaybackActionType, PlaybackSyncPayload } from '../types';
import { VideoPlayerHandle } from '../components/video/VideoPlayer';
import {
  evaluateDriftCorrection,
  AuthoritativePlaybackSnapshot,
  DRIFT_CHECK_INTERVAL_MS,
  DRIFT_ACTION_COOLDOWN_MS,
} from '../services/drift';

export interface UseVideoSyncOptions {
  socket: Socket | null;
  playerRef: React.RefObject<VideoPlayerHandle>;
  roomCode: string | undefined;
  isEnabled: boolean;
}

export interface UseVideoSyncResult {
  /** Play callback to pass to VideoPlayer */
  handlePlay: () => void;
  /** Pause callback to pass to VideoPlayer */
  handlePause: () => void;
  /** Seek callback to pass to VideoPlayer */
  handleSeek: (time: number) => void;
  /** Playback rate change callback to pass to VideoPlayer */
  handlePlaybackRateChange: (rate: number) => void;
  /** Monotonic server sequence number of the most recently applied action */
  currentSequence: number;
  /** Most recent applied playback action */
  lastAction: PlaybackActionType | null;
  /** Current measured drift relative to authoritative time (in seconds) */
  driftSeconds: number;
  /** Whether adaptive ±5% speed nudging is currently active */
  isNudging: boolean;
}

export function useVideoSync({
  socket,
  playerRef,
  roomCode,
  isEnabled,
}: UseVideoSyncOptions): UseVideoSyncResult {
  const [currentSequence, setCurrentSequence] = useState<number>(0);
  const [lastAction, setLastAction] = useState<PlaybackActionType | null>(null);
  const [driftSeconds, setDriftSeconds] = useState<number>(0);
  const [isNudging, setIsNudging] = useState<boolean>(false);

  // Highest sequence number applied so far (avoids out-of-order or duplicate updates)
  const lastAppliedSequenceRef = useRef<number>(0);

  // Guard flag active while applying remote updates to prevent event echoes
  const isApplyingRemoteRef = useRef<boolean>(false);

  // Authoritative server state snapshot
  const authoritativeSnapshotRef = useRef<AuthoritativePlaybackSnapshot | null>(null);

  // User's intended playback speed (e.g. 1.0, 1.25, 1.5, 2.0)
  const userPlaybackRateRef = useRef<number>(1.0);

  // Ref tracking nudging status for synchronous access inside interval
  const isNudgingRef = useRef<boolean>(false);

  // Inactivity timestamp to prevent drift corrections right after user or remote actions
  const lastActionTimeRef = useRef<number>(0);

  // 1. Client-to-server action emitters
  const handlePlay = useCallback(() => {
    if (isApplyingRemoteRef.current) return;
    if (!socket || !isEnabled || !roomCode) return;

    lastActionTimeRef.current = Date.now();
    if (isNudgingRef.current && playerRef.current) {
      playerRef.current.setPlaybackRate(userPlaybackRateRef.current);
      isNudgingRef.current = false;
      setIsNudging(false);
    }

    const player = playerRef.current;
    const currentTime = player ? player.getCurrentTime() : 0;

    socket.emit('playback_action', {
      action: 'PLAY',
      timestamp: currentTime,
      room_code: roomCode.toUpperCase(),
    });
  }, [socket, isEnabled, roomCode, playerRef]);

  const handlePause = useCallback(() => {
    if (isApplyingRemoteRef.current) return;
    if (!socket || !isEnabled || !roomCode) return;

    lastActionTimeRef.current = Date.now();
    if (isNudgingRef.current && playerRef.current) {
      playerRef.current.setPlaybackRate(userPlaybackRateRef.current);
      isNudgingRef.current = false;
      setIsNudging(false);
    }

    const player = playerRef.current;
    const currentTime = player ? player.getCurrentTime() : 0;

    socket.emit('playback_action', {
      action: 'PAUSE',
      timestamp: currentTime,
      room_code: roomCode.toUpperCase(),
    });
  }, [socket, isEnabled, roomCode, playerRef]);

  const handleSeek = useCallback(
    (time: number) => {
      if (isApplyingRemoteRef.current) return;
      if (!socket || !isEnabled || !roomCode) return;

      lastActionTimeRef.current = Date.now();
      if (isNudgingRef.current && playerRef.current) {
        playerRef.current.setPlaybackRate(userPlaybackRateRef.current);
        isNudgingRef.current = false;
        setIsNudging(false);
      }

      socket.emit('playback_action', {
        action: 'SEEK',
        timestamp: Math.max(0, time),
        room_code: roomCode.toUpperCase(),
      });
    },
    [socket, isEnabled, roomCode, playerRef]
  );

  const handlePlaybackRateChange = useCallback(
    (rate: number) => {
      if (isApplyingRemoteRef.current) return;
      if (!socket || !isEnabled || !roomCode) return;

      lastActionTimeRef.current = Date.now();
      userPlaybackRateRef.current = rate;
      if (isNudgingRef.current) {
        isNudgingRef.current = false;
        setIsNudging(false);
      }

      socket.emit('playback_action', {
        action: 'RATE_CHANGE',
        playback_rate: rate,
        room_code: roomCode.toUpperCase(),
      });
    },
    [socket, isEnabled, roomCode]
  );

  // 2. Fetch initial playback state when enabled
  useEffect(() => {
    if (!socket || !isEnabled) return;

    socket.emit(
      'get_playback_state',
      {},
      (res: { status?: string; state?: { is_playing?: boolean; current_time?: number; playback_speed?: number; updated_at?: number; sequence_number?: number } }) => {
        if (res?.status === 'OK' && res.state) {
          const st = res.state;
          const rate = typeof st.playback_speed === 'number' ? st.playback_speed : 1.0;
          userPlaybackRateRef.current = rate;
          authoritativeSnapshotRef.current = {
            isPlaying: !!st.is_playing,
            currentTime: typeof st.current_time === 'number' ? st.current_time : 0,
            playbackSpeed: rate,
            updatedAt: typeof st.updated_at === 'number' ? st.updated_at : Date.now() / 1000,
            serverSequence: st.sequence_number ?? 0,
            localReceivedAt: Date.now(),
          };
        }
      }
    );
  }, [socket, isEnabled]);

  // 3. Server-to-client remote sync listener with loop prevention
  useEffect(() => {
    if (!socket || !isEnabled) return;

    const handlePlaybackSync = (data: PlaybackSyncPayload) => {
      if (!data) return;

      const nowMs = Date.now();
      const incomingTime = data.current_time ?? data.timestamp ?? 0;
      const incomingRate = data.playback_rate ?? data.playback_speed ?? 1.0;
      const isPlaying = !!data.is_playing;
      const updatedAt = data.updated_at ?? data.server_time ?? nowMs / 1000;
      const incomingSeq = data.server_sequence ?? data.sequence_number ?? 0;

      // Always update authoritative server snapshot so client has authoritative position
      authoritativeSnapshotRef.current = {
        isPlaying,
        currentTime: incomingTime,
        playbackSpeed: incomingRate,
        updatedAt,
        serverSequence: incomingSeq,
        localReceivedAt: nowMs,
      };

      if (data.action === 'RATE_CHANGE') {
        userPlaybackRateRef.current = incomingRate;
      }

      // Rule 1: Ignore own socket actions to suppress self-echoes
      if (data.originating_socket_id && socket.id && data.originating_socket_id === socket.id) {
        return;
      }

      // Rule 2: Ignore stale or duplicate sequence numbers
      if (incomingSeq <= lastAppliedSequenceRef.current) {
        return;
      }
      lastAppliedSequenceRef.current = incomingSeq;
      setCurrentSequence(incomingSeq);
      setLastAction(data.action);
      lastActionTimeRef.current = nowMs;

      // Reset nudging on remote action
      if (isNudgingRef.current) {
        isNudgingRef.current = false;
        setIsNudging(false);
      }

      const player = playerRef.current;
      if (!player) return;

      // Rule 3: Set lock while applying remote actions to prevent feedback loops
      isApplyingRemoteRef.current = true;

      try {
        const action = data.action?.toUpperCase();
        const targetTime = incomingTime;
        const targetRate = incomingRate;

        if (action === 'PLAY') {
          if (typeof targetTime === 'number' && !isNaN(targetTime)) {
            player.seek(targetTime);
          }
          if (typeof targetRate === 'number' && !isNaN(targetRate)) {
            player.setPlaybackRate(targetRate);
          }
          player.play().catch((err) => {
            console.warn('Sync play error:', err);
          });
        } else if (action === 'PAUSE') {
          if (typeof targetTime === 'number' && !isNaN(targetTime)) {
            player.seek(targetTime);
          }
          player.pause();
        } else if (action === 'SEEK') {
          if (typeof targetTime === 'number' && !isNaN(targetTime)) {
            player.seek(targetTime);
          }
        } else if (action === 'RATE_CHANGE') {
          if (typeof targetRate === 'number' && !isNaN(targetRate)) {
            player.setPlaybackRate(targetRate);
          }
          if (typeof targetTime === 'number' && !isNaN(targetTime)) {
            player.seek(targetTime);
          }
        }
      } finally {
        setTimeout(() => {
          isApplyingRemoteRef.current = false;
        }, 120);
      }
    };

    const handlePlaybackStart = (data: { room_code: string; timestamp?: number }) => {
      const nowMs = Date.now();
      lastActionTimeRef.current = nowMs;
      authoritativeSnapshotRef.current = {
        isPlaying: true,
        currentTime: 0.0,
        playbackSpeed: 1.0,
        updatedAt: data?.timestamp || nowMs / 1000,
        localReceivedAt: nowMs,
      };
      userPlaybackRateRef.current = 1.0;
      isNudgingRef.current = false;
      setIsNudging(false);

      const player = playerRef.current;
      if (player) {
        isApplyingRemoteRef.current = true;
        player.seek(0);
        player.setPlaybackRate(1.0);
        player.play().catch((err) => {
          console.warn('Playback start error:', err);
        });
        setTimeout(() => {
          isApplyingRemoteRef.current = false;
        }, 150);
      }
    };

    const handleEpisodeChanged = () => {
      // Reset state on new episode
      lastAppliedSequenceRef.current = 0;
      setCurrentSequence(0);
      setLastAction(null);
      authoritativeSnapshotRef.current = null;
      userPlaybackRateRef.current = 1.0;
      isNudgingRef.current = false;
      setIsNudging(false);
      setDriftSeconds(0);
    };

    socket.on('playback_sync', handlePlaybackSync);
    socket.on('playback_start', handlePlaybackStart);
    socket.on('episode_changed', handleEpisodeChanged);

    return () => {
      socket.off('playback_sync', handlePlaybackSync);
      socket.off('playback_start', handlePlaybackStart);
      socket.off('episode_changed', handleEpisodeChanged);
    };
  }, [socket, isEnabled, playerRef]);

  // 4. Adaptive Playback Drift Correction Engine (Task 5.4)
  // Runs every 2 seconds during active playback
  useEffect(() => {
    if (!socket || !isEnabled) return;

    const intervalId = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      const video = player.getVideoElement();
      if (!video || video.readyState < 2) return;

      // Do not correct drift during action cooldown window (1200ms)
      if (Date.now() - lastActionTimeRef.current < DRIFT_ACTION_COOLDOWN_MS) {
        return;
      }

      const isLocalPaused = player.isPaused();
      const snapshot = authoritativeSnapshotRef.current;

      // If paused locally or on server: do not adjust rate, restore rate if previously nudged
      if (!snapshot || !snapshot.isPlaying || isLocalPaused) {
        if (isNudgingRef.current) {
          isApplyingRemoteRef.current = true;
          player.setPlaybackRate(userPlaybackRateRef.current);
          isNudgingRef.current = false;
          setIsNudging(false);
          setTimeout(() => {
            isApplyingRemoteRef.current = false;
          }, 100);
        }
        return;
      }

      const localTime = player.getCurrentTime();
      const evaluation = evaluateDriftCorrection({
        snapshot,
        localTime,
        intendedRate: userPlaybackRateRef.current,
        isLocalPaused,
        isNudging: isNudgingRef.current,
      });

      setDriftSeconds(evaluation.driftSeconds);

      // Tier 3: Macro-drift (>= 1.5s) -> Hard seek directly to authoritative position
      if (evaluation.action === 'HARD_SEEK' && typeof evaluation.targetTime === 'number') {
        isApplyingRemoteRef.current = true;
        player.seek(evaluation.targetTime);
        if (isNudgingRef.current) {
          player.setPlaybackRate(userPlaybackRateRef.current);
          isNudgingRef.current = false;
          setIsNudging(false);
        }
        lastActionTimeRef.current = Date.now();
        setTimeout(() => {
          isApplyingRemoteRef.current = false;
        }, 150);
      }
      // Tier 2: Micro-drift (0.25s to 1.5s) -> Temporary ±5% playback speed adjustment
      else if (
        (evaluation.action === 'NUDGE_FASTER' || evaluation.action === 'NUDGE_SLOWER') &&
        typeof evaluation.targetRate === 'number'
      ) {
        isApplyingRemoteRef.current = true;
        player.setPlaybackRate(evaluation.targetRate);
        isNudgingRef.current = true;
        setIsNudging(true);
        setTimeout(() => {
          isApplyingRemoteRef.current = false;
        }, 100);
      }
      // Tier 1: Drift returned within tolerance (< 0.25s) -> Restore user intended speed
      else if (
        evaluation.action === 'RESTORE_RATE' &&
        typeof evaluation.targetRate === 'number'
      ) {
        isApplyingRemoteRef.current = true;
        player.setPlaybackRate(evaluation.targetRate);
        isNudgingRef.current = false;
        setIsNudging(false);
        setTimeout(() => {
          isApplyingRemoteRef.current = false;
        }, 100);
      }
    }, DRIFT_CHECK_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      // On unmount: restore intended rate if hook unmounts while nudging
      if (isNudgingRef.current && playerRef.current) {
        playerRef.current.setPlaybackRate(userPlaybackRateRef.current);
        isNudgingRef.current = false;
      }
    };
  }, [socket, isEnabled, playerRef]);

  return {
    handlePlay,
    handlePause,
    handleSeek,
    handlePlaybackRateChange,
    currentSequence,
    lastAction,
    driftSeconds,
    isNudging,
  };
}
