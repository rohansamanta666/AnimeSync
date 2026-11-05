/**
 * EpisodeQueue — Phase 6 Task 6.2
 *
 * Displays the room's ordered episode queue, allows host to reorder,
 * remove, and switch active episodes, and allows participants to download
 * upcoming episodes ahead of time.
 */
import React from 'react';
import {
  Film,
  Play,
  Trash2,
  ChevronUp,
  ChevronDown,
  Plus,
  CheckCircle2,
  Download,
  ListOrdered,
} from 'lucide-react';
import { Episode } from '../../types';
import { Button } from '../common/Button';

export interface EpisodeQueueProps {
  episodes: Episode[];
  currentEpisodeId: string | null;
  isHost: boolean;
  onSelectEpisode: (episodeId: string) => void;
  onRemoveEpisode: (episodeId: string) => void;
  onReorderQueue: (orderedIds: string[]) => void;
  onOpenUploadModal: () => void;
  onDownloadEpisode?: (episode: Episode) => void;
  verifiedEpisodeId?: string | null;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const EpisodeQueue: React.FC<EpisodeQueueProps> = ({
  episodes,
  currentEpisodeId,
  isHost,
  onSelectEpisode,
  onRemoveEpisode,
  onReorderQueue,
  onOpenUploadModal,
  onDownloadEpisode,
  verifiedEpisodeId,
  className = '',
}) => {
  // Move episode up in queue
  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const newOrder = [...episodes];
    const temp = newOrder[index - 1];
    newOrder[index - 1] = newOrder[index];
    newOrder[index] = temp;
    onReorderQueue(newOrder.map((e) => e.id));
  };

  // Move episode down in queue
  const handleMoveDown = (index: number) => {
    if (index >= episodes.length - 1) return;
    const newOrder = [...episodes];
    const temp = newOrder[index + 1];
    newOrder[index + 1] = newOrder[index];
    newOrder[index] = temp;
    onReorderQueue(newOrder.map((e) => e.id));
  };

  return (
    <div className={`p-4 glass-panel rounded-2xl space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-void-700/60">
        <div className="flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Episode Queue ({episodes.length})
          </h3>
        </div>

        {isHost && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Plus className="w-3.5 h-3.5 text-violet-400" />}
            onClick={onOpenUploadModal}
            className="text-xs font-medium py-1 px-2.5 h-7"
          >
            Add Episode
          </Button>
        )}
      </div>

      {/* Empty State */}
      {episodes.length === 0 ? (
        <div className="py-8 text-center space-y-2">
          <div className="w-10 h-10 rounded-xl bg-void-800/80 border border-void-700 flex items-center justify-center mx-auto text-ink-muted">
            <Film className="w-5 h-5" />
          </div>
          <p className="text-xs text-ink-muted">No episodes in queue</p>
          {isHost && (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Plus className="w-3.5 h-3.5" />}
              onClick={onOpenUploadModal}
              className="mt-2 text-xs"
            >
              Upload First Episode
            </Button>
          )}
        </div>
      ) : (
        /* Episode List */
        <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1 scrollbar-thin">
          {episodes.map((ep, idx) => {
            const isCurrent = ep.id === currentEpisodeId;
            const isVerified = ep.id === verifiedEpisodeId;

            return (
              <div
                key={ep.id}
                className={`p-3 rounded-xl border transition-all duration-200 flex items-center justify-between gap-3 ${
                  isCurrent
                    ? 'bg-violet-950/40 border-violet-500/50 shadow-lg shadow-violet-950/20'
                    : 'bg-void-900/80 border-void-700/60 hover:border-void-600'
                }`}
              >
                {/* Left: Position & Title Info */}
                <div className="flex items-center gap-3 min-w-0">
                  {/* Position number pill */}
                  <span
                    className={`w-6 h-6 rounded-lg text-xs font-mono font-bold flex items-center justify-center shrink-0 ${
                      isCurrent
                        ? 'bg-violet-600 text-white'
                        : 'bg-void-800 text-ink-muted border border-void-700'
                    }`}
                  >
                    {idx + 1}
                  </span>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white truncate max-w-[160px] sm:max-w-[220px]">
                        {ep.anime_title}
                      </span>
                      {isCurrent && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase bg-violet-900/80 text-violet-300 px-1.5 py-0.5 rounded border border-violet-700 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                          Playing
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-ink-dim">
                      <span>
                        S{ep.season}:E{ep.episode_number}
                      </span>
                      <span>•</span>
                      <span>{formatBytes(ep.file_size_bytes)}</span>
                      {isVerified && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-400 flex items-center gap-0.5">
                            <CheckCircle2 className="w-3 h-3" /> Verified
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Download button for peers/hosts who need to download upcoming episodes */}
                  {onDownloadEpisode && !isCurrent && (
                    <button
                      onClick={() => onDownloadEpisode(ep)}
                      className="p-1.5 rounded-lg text-ink-dim hover:text-cyan-400 hover:bg-void-800 transition-colors"
                      title="Download this episode to your device"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Host Reorder Controls */}
                  {isHost && (
                    <>
                      <button
                        onClick={() => handleMoveUp(idx)}
                        disabled={idx === 0}
                        className={`p-1 rounded text-ink-dim hover:text-white hover:bg-void-800 transition-colors ${
                          idx === 0 ? 'opacity-30 cursor-not-allowed' : ''
                        }`}
                        title="Move Up"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleMoveDown(idx)}
                        disabled={idx === episodes.length - 1}
                        className={`p-1 rounded text-ink-dim hover:text-white hover:bg-void-800 transition-colors ${
                          idx === episodes.length - 1 ? 'opacity-30 cursor-not-allowed' : ''
                        }`}
                        title="Move Down"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>

                      {/* Select/Play Button (if not already current) */}
                      {!isCurrent && (
                        <button
                          onClick={() => onSelectEpisode(ep.id)}
                          className="p-1.5 rounded-lg text-ink-dim hover:text-violet-400 hover:bg-void-800 transition-colors"
                          title="Switch to this episode now"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Remove from queue */}
                      <button
                        onClick={() => onRemoveEpisode(ep.id)}
                        className="p-1.5 rounded-lg text-ink-dim hover:text-rose-400 hover:bg-void-800 transition-colors"
                        title="Remove from queue"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
