import React, { useMemo, useState } from 'react';
import { Play, Search } from 'lucide-react';
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
  const [filterText, setFilterText] = useState('');

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return episodes;
    return episodes.filter(
      (ep) =>
        String(ep.episode_number).includes(q) ||
        (ep.title || '').toLowerCase().includes(q) ||
        (ep.alternative_title || '').toLowerCase().includes(q)
    );
  }, [episodes, filterText]);

  if (!episodes || episodes.length === 0) {
    return (
      <p className="text-xs text-ink-dim py-3">
        No episode metadata available for this title.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {episodes.length > 15 && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-ink-dim absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Jump to episode # or title..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-void-950 border border-void-800 text-xs text-white placeholder-ink-dim focus:outline-none focus:border-violet-500"
          />
        </div>
      )}

      <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1">
        {filtered.map((ep) => {
          const isActive = ep.episode_number === selectedEpisodeNumber;
          return (
            <button
              key={`${ep.episode_id || ep.episode_number}`}
              type="button"
              onClick={() => onSelectEpisode(ep)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors flex items-center justify-between gap-2 ${
                isActive
                  ? 'bg-violet-950/75 border-violet-500 text-white'
                  : ep.is_filler
                  ? 'bg-amber-950/20 border-amber-800/40 text-ink-muted hover:border-amber-600/60 hover:text-white'
                  : 'bg-void-900/70 border-void-800 text-ink-muted hover:border-void-600 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Play className={`w-3 h-3 shrink-0 ${isActive ? 'text-violet-400' : 'text-ink-dim'}`} />
                <span className="font-mono text-[11px] text-ink-dim shrink-0">
                  {ep.episode_number}.
                </span>
                <span className="truncate font-medium">{ep.title}</span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {ep.is_filler && (
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-700/60">
                    FILLER
                  </span>
                )}
                {ep.sub && (
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                    SUB
                  </span>
                )}
                {ep.dub && (
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60">
                    DUB
                  </span>
                )}
                {ep.stream_url && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                    {ep.format?.toUpperCase() || 'READY'}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
