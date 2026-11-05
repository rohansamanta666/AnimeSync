/**
 * useVideoSync — Phase 5 Task 5.3
 *
 * Client-to-Server Playback Controls & Sequence Number Loop Prevention.
 *
 * Connects VideoPlayer controls (Play, Pause, Seek, Rate Change) to the
 * backend `playback_action` Socket.IO event and applies remote `playback_sync`
 * events through VideoPlayerHandle.
 *
 * Loop Prevention Invariants:
 * 1. Self-echo suppression: Ignores events matching socket.id via originating_socket_id.
 * 2. Sequence monotonicity: Drops any stale or duplicate events where seq <= lastAppliedSequence.
 * 3. Remote execution lock: Suppresses local event propagation while applying remote updates.
 * 4. Proper listener lifecycle: Binds and unbinds socket listeners cleanly on mount/unmount.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { PlaybackActionType, PlaybackSyncPayload } from '../types';
import { VideoPlayerHandle } from '../components/video/VideoPlayer';

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
}

export function useVideoSync({
  socket,
  playerRef,
  roomCode,
  isEnabled,
}: UseVideoSyncOptions): UseVideoSyncResult {
  const [currentSequence, setCurrentSequence] = useState<number>(0);
  const [lastAction, setLastAction] = useState<PlaybackActionType | null>(null);

  // Highest sequence number applied so far (avoids out-of-order or duplicate updates)
  const lastAppliedSequenceRef = useRef<number>(0);

  // Guard flag active while applying remote updates to prevent event echoes
  const isApplyingRemoteRef = useRef<boolean>(false);

  // 1. Client-to-server action emitters
  const handlePlay = useCallback(() => {
    if (isApplyingRemoteRef.current) return;
    if (!socket || !isEnabled || !roomCode) return;

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

      socket.emit('playback_action', {
        action: 'SEEK',
        timestamp: Math.max(0, time),
        room_code: roomCode.toUpperCase(),
      });
    },
    [socket, isEnabled, roomCode]
  );

  const handlePlaybackRateChange = useCallback(
    (rate: number) => {
      if (isApplyingRemoteRef.current) return;
      if (!socket || !isEnabled || !roomCode) return;

      socket.emit('playback_action', {
        action: 'RATE_CHANGE',
        playback_rate: rate,
        room_code: roomCode.toUpperCase(),
      });
    },
    [socket, isEnabled, roomCode]
  );

  // 2. Server-to-client remote sync listener with loop prevention
  useEffect(() => {
    if (!socket || !isEnabled) return;

    const handlePlaybackSync = (data: PlaybackSyncPayload) => {
      if (!data) return;

      // Rule 1: Ignore own socket actions to suppress self-echoes
      if (data.originating_socket_id && socket.id && data.originating_socket_id === socket.id) {
        return;
      }

      // Rule 2: Ignore stale or duplicate sequence numbers
      const incomingSeq = data.server_sequence ?? data.sequence_number ?? 0;
      if (incomingSeq <= lastAppliedSequenceRef.current) {
        return;
      }
      lastAppliedSequenceRef.current = incomingSeq;
      setCurrentSequence(incomingSeq);
      setLastAction(data.action);

      const player = playerRef.current;
      if (!player) return;

      // Rule 3: Set lock while applying remote actions to prevent feedback loops
      isApplyingRemoteRef.current = true;

      try {
        const action = data.action?.toUpperCase();
        const targetTime = data.current_time ?? data.timestamp;
        const targetRate = data.playback_rate ?? data.playback_speed;

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

    const handleEpisodeChanged = () => {
      // Reset sequence counter on new episode
      lastAppliedSequenceRef.current = 0;
      setCurrentSequence(0);
      setLastAction(null);
    };

    socket.on('playback_sync', handlePlaybackSync);
    socket.on('episode_changed', handleEpisodeChanged);

    return () => {
      socket.off('playback_sync', handlePlaybackSync);
      socket.off('episode_changed', handleEpisodeChanged);
    };
  }, [socket, isEnabled, playerRef]);

  return {
    handlePlay,
    handlePause,
    handleSeek,
    handlePlaybackRateChange,
    currentSequence,
    lastAction,
  };
}
