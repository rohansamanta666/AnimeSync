import React from 'react';
import { Play } from 'lucide-react';
import { BrowseEpisodeItem } from '../../types';

export interface EpisodeListProps {
  episodes: BrowseEpisodeItem[];
  selectedEpisodeNumber: number;
  onSelectEpisode: (episode: BrowseEpisodeItem) => void;
}

export const EpisodeList: React.FC<EpisodeListProps> = ({
  episodes,
  selectedEpisodeNumber,
  onSelectEpisode,
}) => {
  if (!episodes || episodes.length === 0) {
    return (
      <p className="text-xs text-ink-dim py-3">
        No episode metadata available for this title.
      </p>
    );
  }

  return (
    <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
      {episodes.map((ep) => {
        const isActive = ep.episode_number === selectedEpisodeNumber;
        return (
          <button
            key={ep.episode_number}
            type="button"
            onClick={() => onSelectEpisode(ep)}
            className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors flex items-center justify-between gap-2 ${
              isActive
                ? 'bg-violet-950/75 border-violet-500 text-white'
                : 'bg-void-900/70 border-void-800 text-ink-muted hover:border-void-600 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Play className={`w-3 h-3 shrink-0 ${isActive ? 'text-violet-400' : 'text-ink-dim'}`} />
              <span className="truncate font-medium">{ep.title}</span>
            </div>
            {ep.stream_url ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shrink-0">
                {ep.format?.toUpperCase() || 'READY'}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-ink-dim shrink-0">EP {ep.episode_number}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
