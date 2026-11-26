import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Play,
  Tv,
  Users,
  Link2,
  AlertCircle,
  Loader2,
  Film,
  CheckCircle2,
} from 'lucide-react';
import { api, sessionStore } from '../services/api';
import { StreamAnimeItem, StreamEpisodeItem } from '../types';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { StreamVideoPlayer } from '../components/video/StreamVideoPlayer';

export const StreamPage: React.FC = () => {
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StreamAnimeItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedAnime, setSelectedAnime] = useState<StreamAnimeItem | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<StreamEpisodeItem | null>(null);

  const [customStreamUrl, setCustomStreamUrl] = useState('');
  const [customSubtitleUrl, setCustomSubtitleUrl] = useState('');
  const [activeStreamUrl, setActiveStreamUrl] = useState<string | null>(null);
  const [activeSubtitleUrl, setActiveSubtitleUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isValidatingUrl, setIsValidatingUrl] = useState(false);

  const [hostName, setHostName] = useState('Host');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  const runSearch = async (searchTerm: string) => {
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await api.searchStreaming(searchTerm, 12);
      setResults(res.results);
      if (!selectedAnime && res.results.length > 0) {
        selectAnime(res.results[0]);
      }
    } catch (err: any) {
      setSearchError(err?.message || 'Failed to search streaming catalog');
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    runSearch('');
  }, []);

  const selectAnime = (anime: StreamAnimeItem) => {
    setSelectedAnime(anime);
    setUrlError(null);
    setRoomError(null);
    const firstEp = anime.episodes?.[0] ?? null;
    setSelectedEpisode(firstEp);
    setCustomStreamUrl(firstEp?.stream_url || '');
    setCustomSubtitleUrl(firstEp?.subtitle_url || '');
    setActiveStreamUrl(firstEp?.stream_url || null);
    setActiveSubtitleUrl(firstEp?.subtitle_url || null);
  };

  const selectEpisode = (ep: StreamEpisodeItem) => {
    setSelectedEpisode(ep);
    setUrlError(null);
    setCustomStreamUrl(ep.stream_url || '');
    setCustomSubtitleUrl(ep.subtitle_url || '');
    setActiveStreamUrl(ep.stream_url || null);
    setActiveSubtitleUrl(ep.subtitle_url || null);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  const handleLoadCustomUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError(null);
    if (!customStreamUrl.trim()) {
      setUrlError('Please enter an authorized .mp4, .webm, or HLS (.m3u8) URL.');
      return;
    }

    setIsValidatingUrl(true);
    try {
      const validated = await api.validateStreamUrl(
        customStreamUrl.trim(),
        customSubtitleUrl.trim() || null,
        false
      );
      setActiveStreamUrl(validated.stream_url);
      setActiveSubtitleUrl(validated.subtitle_url || null);
    } catch (err: any) {
      setUrlError(err?.message || 'Invalid stream URL');
    } finally {
      setIsValidatingUrl(false);
    }
  };

  const handleWatchTogether = async () => {
    if (!activeStreamUrl) {
      setRoomError('Load a valid authorized stream URL before starting a Watch Together room.');
      return;
    }
    setIsCreatingRoom(true);
    setRoomError(null);
    try {
      const animeTitle = selectedAnime?.title || 'Stream Watch Party';
      const epNum = selectedEpisode?.episode_number || 1;
      const roomName = `${animeTitle.slice(0, 40)} — Ep ${epNum}`;

      const auth = await api.createRoom(roomName, hostName.trim() || 'Host');
      sessionStore.save(auth.room.code, auth);

      await api.addStreamEpisode(
        auth.room.code,
        {
          anime_title: animeTitle,
          season: 1,
          episode_number: epNum,
          display_title: selectedEpisode?.title || `Episode ${epNum}`,
          stream_url: activeStreamUrl,
          subtitle_url: activeSubtitleUrl,
          set_active: true,
        },
        {
          participantId: auth.participant_id,
          sessionToken: auth.session_token,
        }
      );

      navigate(`/room/${auth.room.code}`);
    } catch (err: any) {
      setRoomError(err?.message || 'Failed to create Watch Together room');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const persistKey =
    selectedAnime && selectedEpisode
      ? `${selectedAnime.id}_ep_${selectedEpisode.episode_number}`
      : undefined;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Tv className="w-6 h-6 text-violet-400" />
            Anime Streaming
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Browse metadata, play authorized MP4/WebM/HLS (.m3u8) streams, or launch a synced Watch Together room.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full md:w-96">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-ink-dim absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search anime or open catalog..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-void-900 border border-void-700 text-sm text-white placeholder-ink-dim focus:outline-none focus:border-violet-500"
            />
          </div>
          <Button type="submit" variant="primary" size="sm" isLoading={isSearching}>
            Search
          </Button>
        </form>
      </div>

      {searchError && (
        <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-200 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{searchError}</span>
        </div>
      )}

      {/* Main Content Split: Player + Details on Left, Episodes + Search Results */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Player & Authorized URL Bar & Details */}
        <div className="lg:col-span-2 space-y-6">
          <StreamVideoPlayer
            streamUrl={activeStreamUrl}
            subtitleUrl={activeSubtitleUrl}
            animeTitle={selectedAnime?.title || 'Select an Anime'}
            episodeNumber={selectedEpisode?.episode_number}
            persistKey={persistKey}
          />

          {/* Authorized Stream URL Loader & Watch Together Bar */}
          <Card className="p-4 space-y-4">
            <form onSubmit={handleLoadCustomUrl} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-violet-400" />
                  Authorized Stream Source
                </h2>
                {activeStreamUrl && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Source Loaded
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-ink-muted mb-1">
                    Video URL (.mp4, .webm, .m3u8)
                  </label>
                  <input
                    type="url"
                    value={customStreamUrl}
                    onChange={(e) => setCustomStreamUrl(e.target.value)}
                    placeholder="https://example.com/playlist.m3u8"
                    className="w-full px-3 py-1.5 rounded-lg bg-void-950 border border-void-700 text-xs text-white placeholder-ink-dim focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-ink-muted mb-1">
                    Optional Subtitle URL (.vtt / .srt)
                  </label>
                  <input
                    type="url"
                    value={customSubtitleUrl}
                    onChange={(e) => setCustomSubtitleUrl(e.target.value)}
                    placeholder="https://example.com/subs.vtt"
                    className="w-full px-3 py-1.5 rounded-lg bg-void-950 border border-void-700 text-xs text-white placeholder-ink-dim focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              {urlError && (
                <p className="text-xs text-rose-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {urlError}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Play className="w-3.5 h-3.5" />}
                  isLoading={isValidatingUrl}
                >
                  Load Stream URL
                </Button>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                    placeholder="Your name"
                    maxLength={24}
                    className="w-28 px-2.5 py-1.5 rounded-lg bg-void-950 border border-void-700 text-xs text-white focus:outline-none focus:border-violet-500"
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    leftIcon={<Users className="w-3.5 h-3.5" />}
                    onClick={handleWatchTogether}
                    isLoading={isCreatingRoom}
                    disabled={!activeStreamUrl}
                  >
                    Watch Together
                  </Button>
                </div>
              </div>
              {roomError && <p className="text-xs text-rose-400">{roomError}</p>}
            </form>
          </Card>

          {/* Selected Anime Details */}
          {selectedAnime && (
            <Card className="p-5">
              <div className="flex flex-col sm:flex-row gap-4">
                {selectedAnime.cover_image ? (
                  <img
                    src={selectedAnime.cover_image}
                    alt={selectedAnime.title}
                    className="w-28 h-40 object-cover rounded-lg border border-void-700 shrink-0"
                  />
                ) : (
                  <div className="w-28 h-40 rounded-lg bg-void-900 border border-void-700 flex items-center justify-center shrink-0">
                    <Film className="w-8 h-8 text-ink-dim" />
                  </div>
                )}

                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-white">{selectedAnime.title}</h2>
                    <Badge variant={selectedAnime.source === 'authorized_catalog' ? 'green' : 'violet'}>
                      {selectedAnime.source === 'authorized_catalog' ? 'Authorized Catalog' : 'AniList Metadata'}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <span>{selectedAnime.episodes_count} Episodes</span>
                    <span>•</span>
                    <span>{selectedAnime.status}</span>
                    {selectedAnime.genres.slice(0, 4).map((g) => (
                      <span
                        key={g}
                        className="px-2 py-0.5 rounded bg-void-900 border border-void-700 text-[11px]"
                      >
                        {g}
                      </span>
                    ))}
                  </div>

                  <p className="text-xs text-ink-muted leading-relaxed line-clamp-4">
                    {selectedAnime.description || 'No synopsis available.'}
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Right Column: Episode List */}
        <div className="space-y-6">
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">
              Episodes {selectedAnime ? `(${selectedAnime.episodes.length})` : ''}
            </h3>
            {selectedAnime && selectedAnime.episodes.length > 0 ? (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {selectedAnime.episodes.map((ep) => {
                  const isActive = selectedEpisode?.episode_number === ep.episode_number;
                  return (
                    <button
                      key={ep.episode_number}
                      type="button"
                      onClick={() => selectEpisode(ep)}
                      className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors flex items-center justify-between gap-2 ${
                        isActive
                          ? 'bg-violet-950/70 border-violet-600 text-white'
                          : 'bg-void-900/70 border-void-800 text-ink-muted hover:border-void-600 hover:text-white'
                      }`}
                    >
                      <span className="truncate font-medium">{ep.title}</span>
                      {ep.stream_url ? (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shrink-0">
                          {ep.format?.toUpperCase() || 'READY'}
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-ink-dim shrink-0">URL</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-ink-dim">Select an anime to view episodes.</p>
            )}
          </Card>
        </div>
      </div>

      {/* Search Results Grid */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider font-mono">
          {query.trim() ? `Search Results (${results.length})` : 'Authorized Open Catalog'}
        </h2>
        {isSearching ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted py-6">
            <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
            <span>Searching anime catalog...</span>
          </div>
        ) : results.length === 0 ? (
          <p className="text-sm text-ink-dim py-4">No matching anime found.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {results.map((item) => {
              const isSelected = selectedAnime?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectAnime(item)}
                  className={`text-left rounded-xl overflow-hidden border transition-all bg-void-900/80 hover:border-violet-500/70 ${
                    isSelected ? 'border-violet-500 ring-1 ring-violet-500/40' : 'border-void-800'
                  }`}
                >
                  <div className="aspect-[3/4] bg-void-950 relative overflow-hidden">
                    {item.cover_image ? (
                      <img
                        src={item.cover_image}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Film className="w-8 h-8 text-ink-dim" />
                      </div>
                    )}
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono text-white">
                      {item.episodes_count} EP
                    </span>
                  </div>
                  <div className="p-2.5">
                    <p className="text-xs font-semibold text-white line-clamp-2">{item.title}</p>
                    <p className="text-[10px] text-ink-dim mt-1 truncate">
                      {item.source === 'authorized_catalog' ? 'Direct Playable' : 'Metadata + URL'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
