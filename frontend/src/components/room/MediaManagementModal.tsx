/**
 * MediaManagementModal — Phase 8 Task 8.6
 *
 * Host-only Media Management Dashboard:
 * - Real-time host disk storage metrics (Total, Free, AnimeSync Videos, Temp Chunks)
 * - Visual storage utilization gauge
 * - Stored episode video files list with size, status, and currently playing indicators
 * - Safe host-side deletion with mandatory confirmation
 * - Temporary chunk purge tool for clearing orphaned uploads
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  HardDrive,
  Trash2,
  RefreshCw,
  X,
  AlertTriangle,
  Film,
  CheckCircle2,
  Sparkles,
  Layers,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '../common/Button';
import { api } from '../../services/api';
import { MediaStorageResponse, MediaEpisode } from '../../types';
import { formatBytes, calculateStoragePercent, formatEpisodeCode } from '../../services/mediaUtils';

export interface MediaManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomCode: string;
  auth: { participant_id: string; session_token: string; is_host?: boolean };
  onEpisodeDeleted?: (episodeId: string) => void;
}

export const MediaManagementModal: React.FC<MediaManagementModalProps> = ({
  isOpen,
  onClose,
  roomCode,
  auth,
  onEpisodeDeleted,
}) => {
  const [data, setData] = useState<MediaStorageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Deletion confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  // Fetch dashboard data
  const fetchDashboard = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMediaDashboard(roomCode, auth);
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load media management dashboard');
    } finally {
      setLoading(false);
    }
  }, [isOpen, roomCode, auth]);

  useEffect(() => {
    if (isOpen) {
      fetchDashboard();
      setConfirmDeleteId(null);
      setSuccessNotice(null);
    }
  }, [isOpen, fetchDashboard]);

  // Handle permanent deletion of an episode video
  const handleDeleteEpisode = async (episode: MediaEpisode) => {
    setIsDeleting(true);
    setError(null);
    try {
      const res = await api.deleteMediaFile(roomCode, episode.id, auth);
      setSuccessNotice(`Deleted ${episode.filename} (${formatBytes(res.freed_bytes)} freed)`);
      setTimeout(() => setSuccessNotice(null), 4000);
      setConfirmDeleteId(null);
      onEpisodeDeleted?.(episode.id);
      await fetchDashboard();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete episode file');
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle purging of temporary upload chunks
  const handlePurgeTemp = async () => {
    setIsPurging(true);
    setError(null);
    try {
      const res = await api.purgeTempMedia(roomCode, auth);
      setSuccessNotice(`Purged ${res.purged_count} session(s) (${formatBytes(res.freed_bytes)} freed)`);
      setTimeout(() => setSuccessNotice(null), 4000);
      await fetchDashboard();
    } catch (err: any) {
      setError(err?.message || 'Failed to purge temporary storage');
    } finally {
      setIsPurging(false);
    }
  };

  if (!isOpen) return null;

  const storage = data?.storage;
  const episodes = data?.episodes || [];

  // Compute storage percentages
  const freePercent = storage
    ? calculateStoragePercent(storage.free_disk_bytes, storage.total_disk_bytes)
    : 0;
  const animeSyncPercent = storage
    ? calculateStoragePercent(storage.animesync_used_bytes, storage.total_disk_bytes)
    : 0;
  const otherUsedPercent = storage
    ? Math.max(0, 100 - freePercent - animeSyncPercent)
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl glass-panel rounded-2xl border border-void-600/80 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-void-700/60 bg-void-950/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-950/80 border border-violet-800/80 flex items-center justify-center text-violet-400 shadow-md">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-wide">
                  Media & Disk Storage Dashboard
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-950 text-violet-300 border border-violet-800 font-bold">
                  HOST ONLY
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                Manage host video files, inspect storage utilization, and purge temp files
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchDashboard}
              disabled={loading}
              className="p-1.5 rounded-lg text-ink-muted hover:text-white hover:bg-void-800 transition-colors disabled:opacity-50"
              title="Refresh Storage Metrics"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-violet-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-ink-muted hover:text-white hover:bg-void-800 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Notices & Alerts */}
        {error && (
          <div className="m-4 mb-0 p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center gap-2 shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}
        {successNotice && (
          <div className="m-4 mb-0 p-3 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2 shrink-0 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* Scrollable Content Body */}
        <div className="p-5 overflow-y-auto space-y-6 flex-1 scrollbar-thin">
          {/* Storage Metrics Panel */}
          {storage && (
            <div className="p-4 rounded-xl bg-void-900/80 border border-void-700/80 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-violet-300">
                    Host Disk Storage
                  </h4>
                  <p className="text-[11px] text-ink-muted">
                    Total Capacity: <span className="text-white font-mono">{formatBytes(storage.total_disk_bytes)}</span>
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-[10px] font-mono uppercase text-ink-muted block">AnimeSync Usage</span>
                    <span className="text-xs font-mono font-bold text-violet-400">
                      {formatBytes(storage.animesync_used_bytes)}
                    </span>
                  </div>
                  <div className="h-6 w-px bg-void-700" />
                  <div className="text-right">
                    <span className="text-[10px] font-mono uppercase text-ink-muted block">Available Free</span>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      {formatBytes(storage.free_disk_bytes)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div>
                <div className="h-3 rounded-full bg-void-950 overflow-hidden flex border border-void-700/50 shadow-inner">
                  {/* AnimeSync Videos (Violet) */}
                  <div
                    className="h-full bg-gradient-to-r from-violet-600 to-indigo-500 transition-all duration-300"
                    style={{
                      width: `${calculateStoragePercent(storage.video_storage_bytes, storage.total_disk_bytes)}%`,
                    }}
                    title={`Videos: ${formatBytes(storage.video_storage_bytes)}`}
                  />
                  {/* AnimeSync Temp (Pink) */}
                  <div
                    className="h-full bg-pink-500 transition-all duration-300"
                    style={{
                      width: `${calculateStoragePercent(storage.temp_storage_bytes, storage.total_disk_bytes)}%`,
                    }}
                    title={`Temp Chunks: ${formatBytes(storage.temp_storage_bytes)}`}
                  />
                  {/* Other Disk Usage (Dark Slate) */}
                  <div
                    className="h-full bg-void-600/70 transition-all duration-300"
                    style={{ width: `${otherUsedPercent}%` }}
                    title={`System / Other: ${formatBytes(storage.total_disk_bytes - storage.free_disk_bytes - storage.animesync_used_bytes)}`}
                  />
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center justify-between text-[10px] font-mono text-ink-muted mt-2 gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-violet-500 inline-block" />
                      <span>Anime Videos ({formatBytes(storage.video_storage_bytes)})</span>
                    </div>
                    {storage.temp_storage_bytes > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-pink-500 inline-block" />
                        <span>Temp Chunks ({formatBytes(storage.temp_storage_bytes)})</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-void-600 inline-block" />
                      <span>Other Apps / OS</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                    <span>{freePercent}% Free Space</span>
                  </div>
                </div>
              </div>

              {/* Purge temp storage button */}
              <div className="flex items-center justify-between pt-2 border-t border-void-800/80">
                <span className="text-[11px] text-ink-muted">
                  Orphaned upload chunks or incomplete upload sessions taking up disk space:
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Sparkles className="w-3.5 h-3.5 text-pink-400" />}
                  onClick={handlePurgeTemp}
                  disabled={isPurging}
                  className="text-xs"
                >
                  {isPurging ? 'Purging...' : 'Purge Temp Chunks'}
                </Button>
              </div>
            </div>
          )}

          {/* Stored Episode Files Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-violet-400" />
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                  Stored Episode Files ({episodes.length})
                </h4>
              </div>
              <span className="text-[11px] font-mono text-ink-muted">
                Host Video Storage Directory: <code className="text-violet-300">storage/videos/</code>
              </span>
            </div>

            {episodes.length === 0 ? (
              <div className="text-center py-8 px-4 rounded-xl border border-dashed border-void-700 bg-void-950/40">
                <Layers className="w-8 h-8 text-ink-dim mx-auto mb-2" />
                <p className="text-xs text-ink-muted">No video files stored in this room's queue yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-void-800 rounded-xl border border-void-700/80 bg-void-900/60 overflow-hidden">
                {episodes.map((ep) => {
                  const isConfirming = confirmDeleteId === ep.id;

                  return (
                    <div
                      key={ep.id}
                      className={`p-3.5 transition-colors ${
                        ep.is_active ? 'bg-violet-950/30' : 'hover:bg-void-800/50'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        {/* Episode Info */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-void-800 text-violet-300 border border-void-700">
                              {formatEpisodeCode(ep.season, ep.episode_number)}
                            </span>
                            <span className="text-xs font-bold text-white truncate max-w-sm">
                              {ep.anime_title}
                            </span>
                            {ep.display_title && (
                              <span className="text-xs text-ink-muted truncate max-w-xs">
                                — {ep.display_title}
                              </span>
                            )}
                            {ep.is_active && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-600 text-white font-bold flex items-center gap-1 shadow-sm">
                                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                                PLAYING NOW
                              </span>
                            )}
                            {ep.file_exists_on_disk ? (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                                ON DISK
                              </span>
                            ) : (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-950 text-rose-400 border border-rose-800">
                                MISSING FILE
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-[11px] font-mono text-ink-muted">
                            <span className="truncate max-w-xs text-ink-dim" title={ep.filename}>
                              {ep.filename}
                            </span>
                            <span>•</span>
                            <span className="text-white font-semibold">
                              {formatBytes(ep.file_size_bytes)}
                            </span>
                            {ep.created_at && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1 text-ink-dim">
                                  <Clock className="w-3 h-3" />
                                  {new Date(ep.created_at).toLocaleDateString()}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Actions / Confirmation */}
                        <div className="shrink-0 flex items-center gap-2">
                          {isConfirming ? (
                            <div className="flex items-center gap-1.5 bg-rose-950/80 border border-rose-700/80 rounded-xl p-1.5 animate-in fade-in duration-150">
                              <span className="text-[11px] font-mono text-rose-200 px-2 font-bold flex items-center gap-1">
                                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                                Permanently delete?
                              </span>
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => handleDeleteEpisode(ep)}
                                disabled={isDeleting}
                                className="text-xs py-1 px-2.5"
                              >
                                {isDeleting ? 'Deleting...' : 'Delete'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={isDeleting}
                                className="text-xs py-1 px-2 text-ink-muted hover:text-white"
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(ep.id)}
                              className="p-2 rounded-lg text-ink-muted hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                              title="Permanently Delete Episode File from Host Disk"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-void-700/60 bg-void-950/70 flex items-center justify-between text-xs font-mono text-ink-muted shrink-0">
          <span>Deletion immediately removes files from the host machine and cleans queue positions.</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
