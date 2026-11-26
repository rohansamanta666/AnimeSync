import React, { useEffect, useState, useCallback } from 'react';
import {
  Download,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  HardDrive,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { api } from '../../services/api';
import { DownloadTaskItem } from '../../types';
import { formatBytes } from '../../services/mediaUtils';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';

export interface DownloadManagerProps {
  refreshTrigger?: number;
}

export const DownloadManager: React.FC<DownloadManagerProps> = ({ refreshTrigger = 0 }) => {
  const [downloads, setDownloads] = useState<DownloadTaskItem[]>([]);
  const [storage, setStorage] = useState<{
    download_dir_bytes: number;
    disk_free_bytes: number;
    disk_total_bytes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDownloads = useCallback(async () => {
    try {
      const data = await api.listDownloads();
      setDownloads(data.downloads);
      setStorage(data.storage);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load downloads');
    }
  }, []);

  useEffect(() => {
    loadDownloads();
  }, [loadDownloads, refreshTrigger]);

  // Poll while any download is active
  useEffect(() => {
    const hasActive = downloads.some((d) => d.status === 'PENDING' || d.status === 'DOWNLOADING');
    if (!hasActive) return;
    const timer = setInterval(loadDownloads, 1200);
    return () => clearInterval(timer);
  }, [downloads, loadDownloads]);

  const handleAction = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await loadDownloads();
    } catch (err: any) {
      setError(err?.message || 'Download action failed');
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Download className="w-4 h-4 text-violet-400" />
          Downloaded Episodes ({downloads.length})
        </h3>
        {storage && (
          <div className="flex items-center gap-2 text-[11px] font-mono text-ink-muted">
            <HardDrive className="w-3.5 h-3.5 text-violet-400" />
            <span>Used: {formatBytes(storage.download_dir_bytes)}</span>
            <span>•</span>
            <span>Free: {formatBytes(storage.disk_free_bytes)}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800/60 text-xs text-rose-200 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {downloads.length === 0 ? (
        <p className="text-xs text-ink-dim">
          No downloaded episodes yet. Direct MP4/WebM sources can be saved locally with SHA-256 verification.
        </p>
      ) : (
        <div className="space-y-2.5">
          {downloads.map((task) => {
            const badgeVariant =
              task.status === 'COMPLETED'
                ? 'green'
                : task.status === 'FAILED'
                ? 'rose'
                : task.status === 'PAUSED'
                ? 'amber'
                : 'violet';

            return (
              <div
                key={task.id}
                className="p-3 rounded-lg bg-void-950/90 border border-void-800 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">
                      {task.anime_title} — Episode {task.episode_number}
                    </p>
                    <p className="text-[11px] text-ink-dim font-mono truncate">{task.filename}</p>
                  </div>
                  <Badge variant={badgeVariant}>{task.status}</Badge>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="w-full h-1.5 bg-void-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 transition-all duration-300"
                      style={{ width: `${task.progress_percent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-ink-muted">
                    <span>
                      {formatBytes(task.downloaded_bytes)}
                      {task.total_bytes > 0 ? ` / ${formatBytes(task.total_bytes)}` : ''}
                    </span>
                    <span>{task.progress_percent.toFixed(0)}%</span>
                  </div>
                </div>

                {task.sha256_hash && (
                  <p className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 truncate">
                    <ShieldCheck className="w-3 h-3 shrink-0" />
                    SHA-256: {task.sha256_hash}
                  </p>
                )}

                {task.error_message && (
                  <p className="text-[11px] text-rose-400">{task.error_message}</p>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  {task.status === 'DOWNLOADING' && (
                    <button
                      type="button"
                      onClick={() => handleAction(() => api.pauseDownload(task.id))}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-void-800 hover:bg-void-700 text-ink-text"
                    >
                      <Pause className="w-3 h-3" /> Pause
                    </button>
                  )}

                  {task.status === 'PAUSED' && (
                    <button
                      type="button"
                      onClick={() => handleAction(() => api.resumeDownload(task.id))}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-violet-900/70 hover:bg-violet-800 text-white"
                    >
                      <Play className="w-3 h-3" /> Resume
                    </button>
                  )}

                  {task.status === 'FAILED' && (
                    <button
                      type="button"
                      onClick={() => handleAction(() => api.retryDownload(task.id))}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-900/70 hover:bg-amber-800 text-white"
                    >
                      <RotateCcw className="w-3 h-3" /> Retry
                    </button>
                  )}

                  {task.status === 'COMPLETED' && (
                    <a
                      href={`/api/downloads/${encodeURIComponent(task.id)}/file`}
                      download={task.filename}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/70"
                    >
                      <Download className="w-3 h-3" /> Save Copy
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => handleAction(() => api.deleteDownload(task.id))}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-void-800 hover:bg-rose-950 text-ink-muted hover:text-rose-300"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};
