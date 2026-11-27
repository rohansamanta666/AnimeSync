import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Star,
  Calendar,
  Film,
  Loader2,
  AlertCircle,
  Server,
  ChevronLeft,
  ChevronRight,
  Users,
  ShieldCheck,
  Captions,
  Mic,
} from 'lucide-react';
import { api, sessionStore } from '../services/api';
import {
  BrowseAnimeItem,
  BrowseEpisodeItem,
  ProviderServerEntry,
  ProviderSubtitleTrack,
} from '../types';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { EpisodeList } from '../components/browse/EpisodeList';
import { MediaSourceSelector } from '../components/browse/MediaSourceSelector';
import { DownloadManager } from '../components/browse/DownloadManager';
import { AnimeCard } from '../components/browse/AnimeCard';
import { OnlineVideoPlayer, isDirectMediaStreamUrl } from '../components/video/OnlineVideoPlayer';

const SERVER_PRIORITY: Record<string, number> = {
  's-1': 0,
  's-2': 1,
  's-3': 2,
  's-4': 3,
};

function sortServersByPriority(list: ProviderServerEntry[]): ProviderServerEntry[] {
  return [...list].sort((a, b) => {
    const pa = SERVER_PRIORITY[(a.serverName || '').toLowerCase()] ?? 99;
    const pb = SERVER_PRIORITY[(b.serverName || '').toLowerCase()] ?? 99;
    return pa - pb;
  });
}

function shouldTryDirectExtract(srv: ProviderServerEntry): boolean {
  const name = (srv.serverName || '').toLowerCase();
  const iframe = (srv.iframe || '').toLowerCase();
  return name === 's-3' || name === 's-4' || iframe.includes('novuscloud');
}

export const AnimeDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [anime, setAnime] = useState<BrowseAnimeItem | null>(null);
  const [selectedEp, setSelectedEp] = useState<BrowseEpisodeItem | null>(null);
  const [audioType, setAudioType] = useState<'sub' | 'dub'>('sub');
  const [servers, setServers] = useState<ProviderServerEntry[]>([]);
  const [selectedServer, setSelectedServer] = useState<ProviderServerEntry | null>(null);
  const [failedServers, setFailedServers] = useState<string[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<ProviderSubtitleTrack[]>([]);
  const [isLoadingServers, setIsLoadingServers] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isResolvingDirect, setIsResolvingDirect] = useState(false);

  const [activeStreamUrl, setActiveStreamUrl] = useState<string | null>(null);
  const [activeSubtitleUrl, setActiveSubtitleUrl] = useState<string | null>(null);
  const [hostName, setHostName] = useState('Host');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadRefresh, setDownloadRefresh] = useState(0);

  const isProviderAnime =
    anime?.provider === 'anime_provider' || anime?.source === 'anime_provider';

  const activateServer = useCallback(
    async (srv: ProviderServerEntry, allServers: ProviderServerEntry[], autoFailover = false) => {
      setSelectedServer(srv);
      setSubtitleTracks([]);

      if (shouldTryDirectExtract(srv)) {
        setIsResolvingDirect(true);
        try {
          const resolved = await api.resolveProviderStream(srv.iframe);
          if (resolved.mode === 'stream' && (resolved.proxy_stream_url || resolved.stream_url)) {
            setActiveStreamUrl(resolved.proxy_stream_url || resolved.stream_url || srv.iframe);
            setActiveSubtitleUrl(resolved.subtitle_url || resolved.subtitles?.[0] || null);
            setSubtitleTracks(resolved.tracks || []);
            return;
          }
        } catch {
          // Fall through to iframe or next server
        } finally {
          setIsResolvingDirect(false);
        }
      }

      if (autoFailover && allServers.length > 1) {
        // Use iframe if direct wasn't available
        setActiveStreamUrl(srv.iframe);
        setActiveSubtitleUrl(null);
      } else {
        setActiveStreamUrl(srv.iframe);
        setActiveSubtitleUrl(null);
      }
    },
    []
  );

  const loadEpisodeServers = useCallback(
    async (ep: BrowseEpisodeItem, track: 'sub' | 'dub') => {
      if (!ep.episode_id) return;
      setIsLoadingServers(true);
      setServerError(null);
      setSubtitleTracks([]);
      setFailedServers([]);
      try {
        const fx = track === 'dub' ? ep.fx_dub : ep.fx_sub;
        const res = await api.getProviderServers(
          ep.episode_id,
          track,
          {
            ani: ep.ani_id,
            mal: ep.mal_id,
            fx,
          },
          false
        );
        const list = sortServersByPriority(res.servers || []);
        setServers(list);

        if (list.length > 0) {
          await activateServer(list[0], list, false);
        } else {
          setSelectedServer(null);
          setActiveStreamUrl(null);
          setServerError(`No ${track.toUpperCase()} servers returned for this episode.`);
        }
      } catch (err: any) {
        setServers([]);
        setSelectedServer(null);
        setServerError(err?.message || 'Failed to fetch streaming servers');
      } finally {
        setIsLoadingServers(false);
      }
    },
    [activateServer]
  );

  useEffect(() => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    setServers([]);
    setSelectedServer(null);
    setFailedServers([]);
    setSubtitleTracks([]);
    setActiveStreamUrl(null);
    setActiveSubtitleUrl(null);
    setServerError(null);

    api.getBrowseAnimeDetails(id)
      .then((data) => {
        setAnime(data);
        const firstEp = data.episodes?.[0] || { episode_number: 1, title: 'Episode 1' };
        setSelectedEp(firstEp);

        if (firstEp.stream_url) {
          setActiveStreamUrl(firstEp.stream_url);
          setActiveSubtitleUrl(firstEp.subtitle_url || null);
        } else if (firstEp.episode_id) {
          const initialTrack: 'sub' | 'dub' =
            firstEp.sub === false && firstEp.dub ? 'dub' : 'sub';
          setAudioType(initialTrack);
          loadEpisodeServers(firstEp, initialTrack);
        }
      })
      .catch((err: any) => {
        setError(err?.message || 'Failed to load anime details');
      })
      .finally(() => setIsLoading(false));
  }, [id, loadEpisodeServers]);

  const handleSelectEpisode = (ep: BrowseEpisodeItem) => {
    setSelectedEp(ep);
    setServerError(null);
    setFailedServers([]);
    if (ep.stream_url) {
      setServers([]);
      setSelectedServer(null);
      setSubtitleTracks([]);
      setActiveStreamUrl(ep.stream_url);
      setActiveSubtitleUrl(ep.subtitle_url || null);
      return;
    }

    if (ep.episode_id) {
      let nextTrack = audioType;
      if (nextTrack === 'dub' && ep.dub === false && ep.sub !== false) {
        nextTrack = 'sub';
        setAudioType('sub');
      } else if (nextTrack === 'sub' && ep.sub === false && ep.dub) {
        nextTrack = 'dub';
        setAudioType('dub');
      }
      loadEpisodeServers(ep, nextTrack);
    } else {
      setActiveStreamUrl(null);
      setActiveSubtitleUrl(null);
    }
  };

  const handleAudioSwitch = (nextTrack: 'sub' | 'dub') => {
    setAudioType(nextTrack);
    if (selectedEp?.episode_id) {
      loadEpisodeServers(selectedEp, nextTrack);
    }
  };

  const handleSelectServer = async (srv: ProviderServerEntry) => {
    setServerError(null);
    await activateServer(srv, servers, false);
  };

  const getNextAvailableServer = useCallback((): ProviderServerEntry | null => {
    if (servers.length <= 1) return null;
    const currentKey = selectedServer?.serverId || selectedServer?.iframe || '';
    const currentIdx = servers.findIndex((s) => (s.serverId || s.iframe) === currentKey);
    for (let offset = 1; offset <= servers.length; offset++) {
      const candidate = servers[(Math.max(0, currentIdx) + offset) % servers.length];
      const key = candidate.serverId || candidate.iframe;
      if (key !== currentKey && !failedServers.includes(key)) {
        return candidate;
      }
    }
    return null;
  }, [servers, selectedServer, failedServers]);

  const handleSwitchNextServer = useCallback(
    async (automatic = false) => {
      const currentKey = selectedServer?.serverId || selectedServer?.iframe || '';
      const updatedFailed = currentKey
        ? Array.from(new Set([...failedServers, currentKey]))
        : failedServers;
      setFailedServers(updatedFailed);

      const currentIdx = servers.findIndex((s) => (s.serverId || s.iframe) === currentKey);
      let nextSrv: ProviderServerEntry | null = null;
      for (let offset = 1; offset <= servers.length; offset++) {
        const candidate = servers[(Math.max(0, currentIdx) + offset) % servers.length];
        const key = candidate.serverId || candidate.iframe;
        if (key !== currentKey && !updatedFailed.includes(key)) {
          nextSrv = candidate;
          break;
        }
      }

      if (!nextSrv) {
        setServerError(
          'All available servers have been tried for this audio track. Try Reload or switch SUB/DUB.'
        );
        return;
      }

      setServerError(
        automatic
          ? `${selectedServer?.serverName || 'Current server'} failed — automatically switched to ${nextSrv.serverName || 'next server'}.`
          : `Switched from ${selectedServer?.serverName || 'current server'} to ${nextSrv.serverName || 'next server'}.`
      );
      await activateServer(nextSrv, servers, true);
    },
    [servers, selectedServer, failedServers, activateServer]
  );

  const handleLoadSource = (streamUrl: string, subtitleUrl: string | null) => {
    setActiveStreamUrl(streamUrl);
    setActiveSubtitleUrl(subtitleUrl);
  };

  const handleDownloadSource = async (streamUrl: string) => {
    if (!anime || !selectedEp) return;
    await api.startDownload({
      anime_title: anime.title,
      episode_number: selectedEp.episode_number,
      source_url: streamUrl,
    });
    setDownloadRefresh((n) => n + 1);
  };

  const handleWatchTogether = async (
    streamUrl: string,
    subtitleUrl: string | null,
    chosenHostName: string
  ) => {
    if (!anime || !selectedEp) return;
    setIsCreatingRoom(true);
    try {
      let syncStreamUrl = streamUrl;
      let syncSubtitleUrl = subtitleUrl;

      // Watch Together requires a Direct HLS/MP4 stream for Play/Pause/Seek sync;
      // if currently playing an iframe embed (e.g. s-1), resolve a syncable Direct HLS server automatically.
      if (!isDirectMediaStreamUrl(syncStreamUrl) && selectedEp.episode_id) {
        try {
          const fx = audioType === 'dub' ? selectedEp.fx_dub : selectedEp.fx_sub;
          const res = await api.getProviderServers(
            selectedEp.episode_id,
            audioType,
            { ani: selectedEp.ani_id, mal: selectedEp.mal_id, fx },
            true
          );
          if (res.direct?.stream_url) {
            syncStreamUrl = res.direct.stream_url;
            syncSubtitleUrl = res.direct.subtitle_url || syncSubtitleUrl;
          }
        } catch {
          // Keep current streamUrl if direct resolution fails
        }
      }

      const roomName = `${anime.title.slice(0, 38)} — Ep ${selectedEp.episode_number}`;
      const auth = await api.createRoom(roomName, chosenHostName || 'Host');
      sessionStore.save(auth.room.code, auth);

      await api.addOnlineEpisode(
        auth.room.code,
        {
          anime_title: anime.title,
          season: 1,
          episode_number: selectedEp.episode_number,
          display_title: selectedEp.title,
          stream_url: syncStreamUrl,
          subtitle_url: syncSubtitleUrl,
          set_active: true,
        },
        {
          participantId: auth.participant_id,
          sessionToken: auth.session_token,
        }
      );

      navigate(`/room/${auth.room.code}`);
    } finally {
      setIsCreatingRoom(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 flex items-center justify-center gap-2 text-ink-muted">
        <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
        <span>Loading anime details...</span>
      </div>
    );
  }

  if (error || !anime) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 space-y-4">
        <Link to="/browse" className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Browse Anime
        </Link>
        <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800/60 text-rose-200 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error || 'Anime not found'}</span>
        </div>
      </div>
    );
  }

  const episodes = anime.episodes || [];
  const currentEpIndex = selectedEp
    ? episodes.findIndex((e) => e.episode_number === selectedEp.episode_number)
    : -1;
  const prevEp = currentEpIndex > 0 ? episodes[currentEpIndex - 1] : null;
  const nextEp =
    currentEpIndex >= 0 && currentEpIndex + 1 < episodes.length
      ? episodes[currentEpIndex + 1]
      : null;

  const persistKey = selectedEp ? `${anime.id}_ep_${selectedEp.episode_number}` : undefined;
  const isPlayingDirect = isDirectMediaStreamUrl(activeStreamUrl);
  const nextAvailableServer = getNextAvailableServer();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div>
        <Link
          to="/browse"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Browse Anime
        </Link>
      </div>

      {/* Metadata Header Card */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row gap-5">
          {anime.cover_image ? (
            <img
              src={anime.cover_image}
              alt={anime.title}
              className="w-32 sm:w-40 h-48 sm:h-56 object-cover rounded-xl border border-void-700 shrink-0"
            />
          ) : (
            <div className="w-32 sm:w-40 h-48 sm:h-56 rounded-xl bg-void-900 border border-void-700 flex items-center justify-center shrink-0">
              <Film className="w-10 h-10 text-ink-dim" />
            </div>
          )}

          <div className="space-y-3 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold text-white">{anime.title}</h1>
              <Badge
                variant={
                  anime.provider === 'open_catalog' || isProviderAnime ? 'green' : 'violet'
                }
              >
                {anime.provider === 'open_catalog'
                  ? 'Open-Licensed Catalog'
                  : isProviderAnime
                  ? 'Streaming Ready'
                  : 'AniList Metadata'}
              </Badge>
              {anime.age_rating && <Badge variant="amber">{anime.age_rating}</Badge>}
            </div>

            {anime.romaji_title && anime.romaji_title !== anime.title && (
              <p className="text-xs text-ink-dim">{anime.romaji_title}</p>
            )}

            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
              {anime.rating != null && (
                <span className="inline-flex items-center gap-1 text-amber-300 font-mono">
                  <Star className="w-3.5 h-3.5 fill-amber-300" />
                  {(anime.rating / 10).toFixed(1)} / 10
                </span>
              )}
              {anime.release_year && (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {anime.release_year}
                </span>
              )}
              {anime.type && <span>{anime.type}</span>}
              {anime.duration && <span>• {anime.duration}</span>}
              <span>• {anime.episodes_count || episodes.length} Episodes</span>
              <span>• {anime.status}</span>
            </div>

            {anime.genres && anime.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {anime.genres.map((g) => (
                  <span
                    key={g}
                    className="px-2 py-0.5 rounded bg-void-950 border border-void-800 text-[11px] text-ink-muted"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            <p className="text-xs sm:text-sm text-ink-muted leading-relaxed max-w-3xl">
              {anime.description || 'No synopsis available.'}
            </p>
          </div>
        </div>
      </Card>

      {/* Player + Streaming Servers + Episode List */}
      <div className={`grid grid-cols-1 ${isTheaterMode ? '' : 'lg:grid-cols-3'} gap-6`}>
        <div className={`${isTheaterMode ? '' : 'lg:col-span-2'} space-y-5`}>
          <OnlineVideoPlayer
            streamUrl={activeStreamUrl}
            subtitleUrl={activeSubtitleUrl}
            animeTitle={anime.title}
            episodeNumber={selectedEp?.episode_number}
            persistKey={persistKey}
            isTheaterMode={isTheaterMode}
            onToggleTheaterMode={() => setIsTheaterMode((t) => !t)}
            onPlaybackError={() => handleSwitchNextServer(true)}
            onSwitchNextServer={
              nextAvailableServer ? () => handleSwitchNextServer(false) : undefined
            }
            nextServerLabel={nextAvailableServer?.serverName || null}
          />

          {/* Provider Server & Audio Switcher */}
          {isProviderAnime && selectedEp && (
            <Card className="p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Server className="w-4 h-4 text-violet-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-white truncate">
                        Episode {selectedEp.episode_number}: {selectedEp.title}
                      </p>
                      {activeStreamUrl && (
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border shrink-0 ${
                            isPlayingDirect
                              ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
                              : 'bg-violet-950/80 border-violet-700/60 text-violet-200'
                          }`}
                        >
                          <ShieldCheck className="w-3 h-3" />
                          {isPlayingDirect
                            ? 'Direct HLS (Ad-Free)'
                            : `${selectedServer?.serverName || 'Server'} (Ad Shield)`}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ink-dim">
                      Starts on s-1 with Ad Shield and auto-switches if a server fails.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!prevEp}
                    onClick={() => prevEp && handleSelectEpisode(prevEp)}
                    leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
                  >
                    Prev Ep
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!nextEp}
                    onClick={() => nextEp && handleSelectEpisode(nextEp)}
                    rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                  >
                    Next Ep
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-void-800/80">
                {/* SUB / DUB, Server Pills & Subtitle Track */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-lg bg-void-950 border border-void-700 p-0.5 text-[11px]">
                    <button
                      type="button"
                      disabled={selectedEp.sub === false || isLoadingServers}
                      onClick={() => handleAudioSwitch('sub')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors disabled:opacity-40 ${
                        audioType === 'sub'
                          ? 'bg-violet-600 text-white'
                          : 'text-ink-muted hover:text-white'
                      }`}
                    >
                      <Captions className="w-3 h-3" /> SUB
                    </button>
                    <button
                      type="button"
                      disabled={selectedEp.dub === false || isLoadingServers}
                      onClick={() => handleAudioSwitch('dub')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors disabled:opacity-40 ${
                        audioType === 'dub'
                          ? 'bg-violet-600 text-white'
                          : 'text-ink-muted hover:text-white'
                      }`}
                    >
                      <Mic className="w-3 h-3" /> DUB
                    </button>
                  </div>

                  {isLoadingServers || isResolvingDirect ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
                      Loading server…
                    </span>
                  ) : (
                    servers.map((srv, idx) => {
                      const key = srv.serverId || srv.iframe;
                      const isActive =
                        selectedServer?.serverId === srv.serverId &&
                        selectedServer?.iframe === srv.iframe;
                      const isFailed = failedServers.includes(key);
                      return (
                        <button
                          key={`${key}_${idx}`}
                          type="button"
                          onClick={() => handleSelectServer(srv)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                            isActive
                              ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
                              : isFailed
                              ? 'bg-rose-950/40 border-rose-800/60 text-rose-300/70 line-through'
                              : 'bg-void-950 border-void-700 text-ink-muted hover:text-white hover:border-void-500'
                          }`}
                        >
                          {srv.serverName || `Server ${idx + 1}`}
                        </button>
                      );
                    })
                  )}

                  {subtitleTracks.length > 0 && (
                    <select
                      value={activeSubtitleUrl || ''}
                      onChange={(e) => setActiveSubtitleUrl(e.target.value || null)}
                      aria-label="Subtitle track"
                      className="px-2.5 py-1.5 rounded-lg bg-void-950 border border-void-700 text-xs text-ink-text focus:outline-none focus:border-violet-500"
                    >
                      <option value="">Subtitles: Off</option>
                      {subtitleTracks.map((tr, i) => (
                        <option key={`${tr.proxy_url}_${i}`} value={tr.proxy_url}>
                          {tr.label} ({tr.format.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Launch Watch Together Room */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                    placeholder="Host name"
                    maxLength={24}
                    className="w-28 px-2.5 py-1.5 rounded-lg bg-void-950 border border-void-700 text-xs text-white focus:outline-none focus:border-violet-500"
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    leftIcon={<Users className="w-3.5 h-3.5" />}
                    disabled={!activeStreamUrl || isCreatingRoom}
                    isLoading={isCreatingRoom}
                    onClick={() =>
                      activeStreamUrl &&
                      handleWatchTogether(activeStreamUrl, activeSubtitleUrl, hostName.trim() || 'Host')
                    }
                  >
                    Watch Together
                  </Button>
                </div>
              </div>

              {serverError && (
                <p className="text-xs text-amber-300 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {serverError}
                </p>
              )}
            </Card>
          )}

          <MediaSourceSelector
            animeTitle={anime.title}
            episodeNumber={selectedEp?.episode_number || 1}
            initialStreamUrl={selectedEp?.stream_url || activeStreamUrl}
            initialSubtitleUrl={selectedEp?.subtitle_url || activeSubtitleUrl}
            activeStreamUrl={activeStreamUrl}
            onLoadSource={handleLoadSource}
            onDownloadSource={handleDownloadSource}
            onWatchTogether={handleWatchTogether}
          />
        </div>

        <div className="space-y-6">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-white mb-3">
              Episodes ({episodes.length})
            </h2>
            <EpisodeList
              episodes={episodes}
              selectedEpisodeNumber={selectedEp?.episode_number || 1}
              onSelectEpisode={handleSelectEpisode}
            />
          </Card>

          <DownloadManager refreshTrigger={downloadRefresh} />
        </div>
      </div>

      {/* More Seasons */}
      {anime.more_seasons && anime.more_seasons.length > 0 && (
        <section className="space-y-3 pt-4 border-t border-void-800">
          <h2 className="text-base font-bold text-white">More Seasons</h2>
          <div className="flex flex-wrap gap-2.5">
            {anime.more_seasons.map((season, idx) => (
              <Link
                key={`${season.id || idx}`}
                to={season.id ? `/browse/${encodeURIComponent(season.id)}` : '#'}
                className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                  season.isActive
                    ? 'bg-violet-600 border-violet-500 text-white'
                    : 'bg-void-900 border-void-800 text-ink-muted hover:text-white hover:border-violet-500/60'
                }`}
              >
                {season.alternativeTitle || season.title || `Season ${idx + 1}`}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Related / Recommended Anime */}
      {((anime.related && anime.related.length > 0) ||
        (anime.recommended && anime.recommended.length > 0)) && (
        <section className="space-y-4 pt-4 border-t border-void-800">
          <h2 className="text-base font-bold text-white">Related & Recommended</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[...(anime.related || []), ...(anime.recommended || [])]
              .slice(0, 12)
              .map((item) => (
                <AnimeCard key={item.id} anime={item} />
              ))}
          </div>
        </section>
      )}
    </div>
  );
};
