import React from 'react';
import { Link } from 'react-router-dom';
import { Film, Star } from 'lucide-react';
import { BrowseAnimeItem } from '../../types';

export interface AnimeCardProps {
  anime: BrowseAnimeItem;
}

export const AnimeCard: React.FC<AnimeCardProps> = ({ anime }) => {
  const isOpenCatalog = anime.provider === 'open_catalog';

  return (
    <Link
      to={`/browse/${encodeURIComponent(anime.id)}`}
      className="group flex flex-col rounded-xl overflow-hidden border border-void-800 bg-void-900/80 hover:border-violet-500/80 hover:-translate-y-0.5 transition-all duration-200 shadow-lg"
    >
      <div className="aspect-[3/4] bg-void-950 relative overflow-hidden">
        {anime.cover_image ? (
          <img
            src={anime.cover_image}
            alt={anime.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-8 h-8 text-ink-dim" />
          </div>
        )}

        <div className="absolute top-2 left-2 flex items-center gap-1">
          {anime.rating != null && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-amber-300">
              <Star className="w-2.5 h-2.5 fill-amber-300" />
              {(anime.rating / 10).toFixed(1)}
            </span>
          )}
        </div>

        <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-white">
          {anime.episodes_count} EP
        </span>

        {isOpenCatalog && (
          <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-700/60 text-[10px] font-mono text-emerald-300">
            Open License
          </span>
        )}
      </div>

      <div className="p-3 flex-1 flex flex-col justify-between gap-2">
        <div>
          <h3 className="text-xs sm:text-sm font-semibold text-white line-clamp-2 group-hover:text-violet-300 transition-colors">
            {anime.title}
          </h3>
          <p className="text-[11px] text-ink-dim mt-1 truncate">
            {[anime.release_year, anime.status].filter(Boolean).join(' • ')}
          </p>
        </div>

        {anime.genres && anime.genres.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {anime.genres.slice(0, 2).map((genre) => (
              <span
                key={genre}
                className="px-1.5 py-0.5 rounded bg-void-950 border border-void-800 text-[10px] text-ink-muted"
              >
                {genre}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
};
