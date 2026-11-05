/**
 * useEpisodeQueue — Phase 6 Hook
 *
 * Coordinates episode queue state, video ended events, intermission countdowns,
 * and automatic next-episode transitions over Socket.IO and REST APIs.
 */
import { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { Episode, IntermissionData, QueueAdvancedData, RoomAuth } from '../types';
import { api } from '../services/api';

export interface UseEpisodeQueueProps {
  socket: Socket | null;
  auth: RoomAuth | null;
  initialEpisodes?: Episode[];
  initialCurrentEpisodeId?: string | null;
  onEpisodeAdvanced?: (nextEpisode: Episode) => void;
}

export function useEpisodeQueue({
  socket,
  auth,
  initialEpisodes = [],
  initialCurrentEpisodeId = null,
  onEpisodeAdvanced,
}: UseEpisodeQueueProps) {
  const [queue, setQueue] = useState<Episode[]>(initialEpisodes);
  const [currentEpisodeId, setCurrentEpisodeId] = useState<string | null>(
    initialCurrentEpisodeId
  );
  const [intermission, setIntermission] = useState<IntermissionData | null>(null);
  const [isQueueFinished, setIsQueueFinished] = useState(false);

  // Sync initial props
  useEffect(() => {
    if (initialEpisodes.length > 0) {
      setQueue(initialEpisodes);
    }
  }, [initialEpisodes]);

  useEffect(() => {
    if (initialCurrentEpisodeId) {
      setCurrentEpisodeId(initialCurrentEpisodeId);
    }
  }, [initialCurrentEpisodeId]);

  // Socket.IO event listeners for Phase 6 queue & intermission
  useEffect(() => {
    if (!socket) return;

    const handleQueueUpdated = (data: {
      room_code: string;
      episodes: Episode[];
      current_episode_id: string | null;
    }) => {
      setQueue(data.episodes);
      if (data.current_episode_id !== undefined) {
        setCurrentEpisodeId(data.current_episode_id);
      }
    };

    const handleIntermissionStarted = (data: IntermissionData) => {
      setIntermission(data);
      setIsQueueFinished(false);
    };

    const handleIntermissionCancelled = () => {
      setIntermission(null);
    };

    const handleQueueAdvanced = (data: QueueAdvancedData) => {
      setIntermission(null);
      setCurrentEpisodeId(data.current_episode_id);
      onEpisodeAdvanced?.(data.episode);
    };

    const handleQueueFinished = () => {
      setIntermission(null);
      setIsQueueFinished(true);
    };

    socket.on('queue_updated', handleQueueUpdated);
    socket.on('intermission_started', handleIntermissionStarted);
    socket.on('intermission_cancelled', handleIntermissionCancelled);
    socket.on('queue_advanced', handleQueueAdvanced);
    socket.on('queue_finished', handleQueueFinished);

    return () => {
      socket.off('queue_updated', handleQueueUpdated);
      socket.off('intermission_started', handleIntermissionStarted);
      socket.off('intermission_cancelled', handleIntermissionCancelled);
      socket.off('queue_advanced', handleQueueAdvanced);
      socket.off('queue_finished', handleQueueFinished);
    };
  }, [socket, onEpisodeAdvanced]);

  // Video ended callback (Task 6.3)
  const handleVideoEnded = useCallback(() => {
    if (!socket || !currentEpisodeId) return;
    socket.emit('playback_ended', { episode_id: currentEpisodeId });
  }, [socket, currentEpisodeId]);

  // Reorder queue (Task 6.1)
  const handleReorderQueue = useCallback(
    async (orderedIds: string[]) => {
      if (!auth) return;
      // Optimistic update
      const epMap = new Map(queue.map((e) => [e.id, e]));
      const optimisticallyOrdered = orderedIds
        .map((id) => epMap.get(id))
        .filter((e): e is Episode => !!e);
      setQueue(optimisticallyOrdered);

      try {
        if (socket) {
          socket.emit('reorder_queue', { ordered_episode_ids: orderedIds });
        } else {
          await api.reorderQueue(auth.room.code, orderedIds, {
            participantId: auth.participant_id,
            sessionToken: auth.session_token,
          });
        }
      } catch (err) {
        console.error('Failed to reorder queue:', err);
      }
    },
    [auth, queue, socket]
  );

  // Remove episode from queue (Task 6.1)
  const handleRemoveEpisode = useCallback(
    async (episodeId: string) => {
      if (!auth) return;
      // Optimistic remove
      setQueue((prev) => prev.filter((e) => e.id !== episodeId));

      try {
        if (socket) {
          socket.emit('remove_from_queue', { episode_id: episodeId });
        } else {
          await api.removeFromQueue(auth.room.code, episodeId, {
            participantId: auth.participant_id,
            sessionToken: auth.session_token,
          });
        }
      } catch (err) {
        console.error('Failed to remove episode:', err);
      }
    },
    [auth, socket]
  );

  // Select episode (Task 6.1)
  const handleSelectEpisode = useCallback(
    async (episodeId: string) => {
      if (!auth) return;
      setCurrentEpisodeId(episodeId);

      try {
        if (socket) {
          socket.emit('select_episode', { episode_id: episodeId });
        } else {
          await api.selectEpisode(auth.room.code, episodeId, {
            participantId: auth.participant_id,
            sessionToken: auth.session_token,
          });
        }
      } catch (err) {
        console.error('Failed to select episode:', err);
      }
    },
    [auth, socket]
  );

  // Skip intermission (Task 6.4)
  const handleSkipIntermission = useCallback(() => {
    if (!socket) return;
    socket.emit('skip_intermission', {});
  }, [socket]);

  // Cancel intermission (Task 6.4)
  const handleCancelIntermission = useCallback(() => {
    if (!socket) return;
    socket.emit('cancel_intermission', {});
  }, [socket]);

  return {
    queue,
    currentEpisodeId,
    intermission,
    isQueueFinished,
    handleVideoEnded,
    handleReorderQueue,
    handleRemoveEpisode,
    handleSelectEpisode,
    handleSkipIntermission,
    handleCancelIntermission,
    setIsQueueFinished,
  };
}
