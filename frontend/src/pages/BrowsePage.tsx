import React, { useEffect, useState, useCallback } from 'react';
import { Flame, TrendingUp, Clock, Sparkles, ChevronLeft, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { BrowseAnimeItem } from '../types';
import { AnimeSearch } from '../components/browse/AnimeSearch';
import { AnimeCard } from '../components/browse/AnimeCard';
import { DownloadManager } from '../components/browse/DownloadManager';
import { Button } from '../components/common/Button';

type DiscoverCategory = 'trending' | 'popular' | 'recent';

export const BrowsePage: React.FC = () => {
  const [category, setCategory] = useState<DiscoverCategory>('trending');
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [page, setPage] = useState(1);

  const [results, setResults] = useState<BrowseAnimeItem[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  const [openCatalog, setOpenCatalog] = useState<BrowseAnimeItem[]>([]);

  const fetchDiscoveryOrSearch = useCallback(
    async (cat: DiscoverCategory, q: string, pageNum: number) => {
      setIsLoading(true);
      setMetadataError(null);
      try {
        const res = q.trim()
          ? await api.searchBrowseAnime(q.trim(), pageNum, 18)
          : await api.discoverAnime(cat, pageNum, 18);

        setResults(res.results);
        setHasNextPage(res.has_next_page);
        if (!res.metadata_available && res.error) {
          setMetadataError(res.error);
        }
      } catch (err: any) {
        setMetadataError(err?.message || 'Failed to fetch anime metadata');
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchDiscoveryOrSearch(category, activeQuery, page);
  }, [category, activeQuery, page, fetchDiscoveryOrSearch]);

  useEffect(() => {
    api.getProviderCatalog()
      .then((res) => setOpenCatalog(res.results))
      .catch(() => setOpenCatalog([]));
  }, []);

  const handleCategoryChange = (nextCat: DiscoverCategory) => {
    setActiveQuery('');
    setSearchInput('');
    setCategory(nextCat);
    setPage(1);
  };

  const handleSearchSubmit = (q: string) => {
    setActiveQuery(q.trim());
    setPage(1);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setActiveQuery('');
    setPage(1);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Header & Search */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Browse Anime
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Discover anime via AniList metadata, or watch & download authorized media sources.
          </p>
        </div>

        <AnimeSearch
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={handleSearchSubmit}
          onClear={handleClearSearch}
          isLoading={isLoading}
        />
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-void-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleCategoryChange('trending')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              !activeQuery && category === 'trending'
                ? 'bg-violet-600 text-white shadow-lg shadow-violet-900/30'
                : 'bg-void-900 text-ink-muted hover:text-white border border-void-800'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            Trending
          </button>

          <button
            type="button"
            onClick={() => handleCategoryChange('popular')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              !activeQuery && category === 'popular'
                ? 'bg-violet-600 text-white shadow-lg shadow-violet-900/30'
                : 'bg-void-900 text-ink-muted hover:text-white border border-void-800'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Popular
          </button>

          <button
            type="button"
            onClick={() => handleCategoryChange('recent')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              !activeQuery && category === 'recent'
                ? 'bg-violet-600 text-white shadow-lg shadow-violet-900/30'
                : 'bg-void-900 text-ink-muted hover:text-white border border-void-800'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Recently Updated
          </button>
        </div>

        {activeQuery && (
          <p className="text-xs text-ink-muted font-mono">
            Showing results for "<span className="text-white">{activeQuery}</span>" (Page {page})
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

      {/* AniList Discovery / Search Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-ink-muted gap-2 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
          <span>Loading anime catalog...</span>
        </div>
      ) : results.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-dim">
          No anime metadata results found. Try another search or check the Open-Licensed Catalog below.
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
