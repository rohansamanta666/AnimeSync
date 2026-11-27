import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Flame,
  TrendingUp,
  Clock,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Loader2,
  Captions,
  Mic,
  Film,
  Radio,
} from 'lucide-react';
import { api } from '../services/api';
import { BrowseAnimeItem, ProviderHealthResponse } from '../types';
import { AnimeSearch } from '../components/browse/AnimeSearch';
import { AnimeCard } from '../components/browse/AnimeCard';
import { DownloadManager } from '../components/browse/DownloadManager';
import { Button } from '../components/common/Button';

type ProviderCategory =
  | 'top-airing'
  | 'most-popular'
  | 'recently-updated'
  | 'subbed-anime'
  | 'dubbed-anime'
  | 'movie';

const CATEGORY_TABS: Array<{ id: ProviderCategory; label: string; icon: React.ReactNode }> = [
  { id: 'top-airing', label: 'Trending / Airing', icon: <Flame className="w-3.5 h-3.5" /> },
  { id: 'most-popular', label: 'Most Popular', icon: <TrendingUp className="w-3.5 h-3.5" /> },
  { id: 'recently-updated', label: 'Recently Updated', icon: <Clock className="w-3.5 h-3.5" /> },
  { id: 'subbed-anime', label: 'Subbed', icon: <Captions className="w-3.5 h-3.5" /> },
  { id: 'dubbed-anime', label: 'Dubbed', icon: <Mic className="w-3.5 h-3.5" /> },
  { id: 'movie', label: 'Movies', icon: <Film className="w-3.5 h-3.5" /> },
];

export const BrowsePage: React.FC = () => {
  const navigate = useNavigate();
  const [category, setCategory] = useState<ProviderCategory>('top-airing');
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [page, setPage] = useState(1);

  const [results, setResults] = useState<BrowseAnimeItem[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRandomLoading, setIsRandomLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<string>('anime_provider');

  const [providerHealth, setProviderHealth] = useState<ProviderHealthResponse | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [topSearches, setTopSearches] = useState<Array<{ title: string; link: string; id: string | null }>>([]);
  const [openCatalog, setOpenCatalog] = useState<BrowseAnimeItem[]>([]);

  useEffect(() => {
    api.getProviderHealth()
      .then(setProviderHealth)
      .catch(() => setProviderHealth({ available: false, url: '' }));

    api.getProviderGenres()
      .then((res) => setGenres(res.genres || []))
      .catch(() => setGenres([]));

    api.getProviderTopSearch()
      .then((res) => setTopSearches((res.results || []).slice(0, 8)))
      .catch(() => setTopSearches([]));

    api.getProviderCatalog()
      .then((res) => setOpenCatalog(res.results))
      .catch(() => setOpenCatalog([]));
  }, []);

  const fetchCatalog = useCallback(
    async (cat: ProviderCategory, genre: string, q: string, pageNum: number) => {
      setIsLoading(true);
      setMetadataError(null);
      try {
        if (q.trim()) {
          const res = await api.searchBrowseAnime(q.trim(), pageNum, 20, 'auto');
          setResults(res.results);
          setHasNextPage(res.has_next_page);
          setActiveSource(res.source || 'anime_provider');
          if (!res.metadata_available && res.error) {
            setMetadataError(res.error);
          }
          return;
        }

        if (genre) {
          const res = await api.listProviderAnime('genre', genre, pageNum);
          setResults(res.results);
          setHasNextPage(res.has_next_page);
          setActiveSource('anime_provider');
          return;
        }

        try {
          const res = await api.listProviderAnime(cat, undefined, pageNum);
          setResults(res.results);
          setHasNextPage(res.has_next_page);
          setActiveSource('anime_provider');
        } catch {
          const fallbackCategory =
            cat === 'top-airing' ? 'trending' : cat === 'recently-updated' ? 'recent' : 'popular';
          const res = await api.discoverAnime(fallbackCategory, pageNum, 18, 'anilist');
          setResults(res.results);
          setHasNextPage(res.has_next_page);
          setActiveSource('anilist');
          if (!res.metadata_available && res.error) {
            setMetadataError(res.error);
          }
        }
      } catch (err: any) {
        setMetadataError(err?.message || 'Failed to fetch anime catalog');
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchCatalog(category, selectedGenre, activeQuery, page);
  }, [category, selectedGenre, activeQuery, page, fetchCatalog]);

  const handleCategoryChange = (nextCat: ProviderCategory) => {
    setActiveQuery('');
    setSearchInput('');
    setSelectedGenre('');
    setCategory(nextCat);
    setPage(1);
  };

  const handleGenreChange = (nextGenre: string) => {
    setActiveQuery('');
    setSearchInput('');
    setSelectedGenre(nextGenre);
    setPage(1);
  };

  const handleSearchSubmit = (q: string) => {
    setSelectedGenre('');
    setActiveQuery(q.trim());
    setPage(1);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setActiveQuery('');
    setPage(1);
  };

  const handleRandomAnime = async () => {
    setIsRandomLoading(true);
    try {
      const res = await api.getProviderRandom();
      if (res?.id) {
        navigate(`/browse/${encodeURIComponent(res.id)}`);
      }
    } catch (err: any) {
      setMetadataError(err?.message || 'Unable to load random anime');
    } finally {
      setIsRandomLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header & Search */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Browse Anime
            </h1>
            {providerHealth && (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono border ${
                  providerHealth.available
                    ? 'bg-emerald-950/70 border-emerald-700/60 text-emerald-300'
                    : 'bg-amber-950/70 border-amber-700/60 text-amber-300'
                }`}
              >
                <Radio className="w-3 h-3" />
                {providerHealth.available
                  ? 'Provider Online'
                  : activeSource === 'anilist'
                  ? 'AniList Fallback'
                  : 'Provider Offline'}
              </span>
            )}
          </div>
          <p className="text-sm text-ink-muted mt-1">
            Search anime, browse episodes, stream directly in your browser, or launch a Watch Together room.
          </p>
        </div>

        <AnimeSearch
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={handleSearchSubmit}
          onClear={handleClearSearch}
          onRandomClick={handleRandomAnime}
          isLoading={isLoading}
          isRandomLoading={isRandomLoading}
        />
      </div>

      {/* Top Trending Search Pills */}
      {topSearches.length > 0 && !activeQuery && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-dim font-mono mr-1">Top searches:</span>
          {topSearches.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={() => {
                setSearchInput(item.title);
                handleSearchSubmit(item.title);
              }}
              className="px-2.5 py-1 rounded-full bg-void-900 border border-void-800 text-ink-muted hover:text-white hover:border-violet-500/70 transition-colors text-[11px]"
            >
              {item.title}
            </button>
          ))}
        </div>
      )}

      {/* Category Tabs & Genre Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-void-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORY_TABS.map((tab) => {
            const active = !activeQuery && !selectedGenre && category === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleCategoryChange(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-violet-600 text-white shadow-lg shadow-violet-900/30'
                    : 'bg-void-900 text-ink-muted hover:text-white border border-void-800'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}

          {genres.length > 0 && (
            <select
              value={selectedGenre}
              onChange={(e) => handleGenreChange(e.target.value)}
              aria-label="Filter by genre"
              className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors bg-void-900 ${
                selectedGenre
                  ? 'border-violet-500 text-violet-200'
                  : 'border-void-800 text-ink-muted hover:text-white'
              }`}
            >
              <option value="">All Genres</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g.replace(/\b\w/g, (c) => c.toUpperCase())}
                </option>
              ))}
            </select>
          )}
        </div>

        {(activeQuery || selectedGenre) && (
          <p className="text-xs text-ink-muted font-mono">
            {activeQuery ? (
              <>
                Showing results for "<span className="text-white">{activeQuery}</span>" (Page {page})
              </>
            ) : (
              <>
                Genre: <span className="text-white capitalize">{selectedGenre}</span> (Page {page})
              </>
            )}
          </p>
        )}
      </div>

      {/* Metadata Error Notice */}
      {metadataError && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{metadataError}</span>
        </div>
      )}

      {/* Catalog Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-ink-muted gap-2 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
          <span>Loading anime catalog...</span>
        </div>
      ) : results.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-dim">
          No anime results found. Try another search or check the Open-Licensed Catalog below.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {results.map((item) => (
            <AnimeCard key={item.id} anime={item} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {(page > 1 || hasNextPage) && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ChevronLeft className="w-4 h-4" />}
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs font-mono text-ink-muted">Page {page}</span>
          <Button
            variant="secondary"
            size="sm"
            rightIcon={<ChevronRight className="w-4 h-4" />}
            disabled={!hasNextPage || isLoading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Authorized Open-Licensed & Self-Hosted Provider Catalog */}
      {openCatalog.length > 0 && (
        <section className="space-y-4 pt-4 border-t border-void-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <h2 className="text-base font-bold text-white">
              Authorized Open-Licensed & Self-Hosted Catalog
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {openCatalog.map((item) => (
              <AnimeCard key={item.id} anime={item} />
            ))}
          </div>
        </section>
      )}

      {/* Local Episode Download Manager */}
      <section className="pt-4 border-t border-void-800">
        <DownloadManager />
      </section>
    </div>
  );
};
