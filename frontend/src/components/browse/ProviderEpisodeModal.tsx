import React, { useState } from 'react';
import { X, Search, Loader2, Play, Server, AlertCircle, Captions, Mic } from 'lucide-react';
import { api } from '../../services/api';
import {
  BrowseAnimeItem,
  BrowseEpisodeItem,
  Episode,
  ProviderServerEntry,
  RoomAuth,
} from '../../types';
import { Button } from '../common/Button';

export interface ProviderEpisodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  auth: RoomAuth;
  onEpisodeAdded: (episode: Episode) => void;
}

export const ProviderEpisodeModal: React.FC<ProviderEpisodeModalProps> = ({
  isOpen,
  onClose,
  auth,
  onEpisodeAdded,
}) => {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BrowseAnimeItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [selectedAnime, setSelectedAnime] = useState<BrowseAnimeItem | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [selectedEp, setSelectedEp] = useState<BrowseEpisodeItem | null>(null);
  const [audioType, setAudioType] = useState<'sub' | 'dub'>('sub');
  const [servers, setServers] = useState<ProviderServerEntry[]>([]);
  const [selectedServer, setSelectedServer] = useState<ProviderServerEntry | null>(null);
  const [resolvedStreamUrl, setResolvedStreamUrl] = useState<string | null>(null);
  const [resolvedSubtitleUrl, setResolvedSubtitleUrl] = useState<string | null>(null);
  const [isLoadingServers, setIsLoadingServers] = useState(false);
  const [setActive, setSetActive] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    setErrorMsg(null);
    setSelectedAnime(null);
    try {
      const res = await api.searchProviderAnime(query.trim(), 1);
      setSearchResults(res.results || []);
      if ((res.results || []).length === 0) {
        setErrorMsg('No matching anime found on provider.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to search anime provider');
    } finally {
      setIsSearching(false);
    }
  };

  const fetchServers = async (ep: BrowseEpisodeItem, track: 'sub' | 'dub') => {
    if (!ep.episode_id) return;
    setIsLoadingServers(true);
    setErrorMsg(null);
    setResolvedStreamUrl(null);
    setResolvedSubtitleUrl(null);
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
      const priority: Record<string, number> = { 's-1': 0, 's-2': 1, 's-3': 2, 's-4': 3 };
      const list = [...(res.servers || [])].sort((a, b) => {
        const pa = priority[(a.serverName || '').toLowerCase()] ?? 99;
        const pb = priority[(b.serverName || '').toLowerCase()] ?? 99;
        return pa - pb;
      });
      setServers(list);
      const first = list[0] || null;
      setSelectedServer(first);
      if (first) {
        const name = (first.serverName || '').toLowerCase();
        if (name === 's-3' || name === 's-4' || first.iframe.toLowerCase().includes('novuscloud')) {
          try {
            const r = await api.resolveProviderStream(first.iframe);
            if (r.mode === 'stream' && (r.proxy_stream_url || r.stream_url)) {
              setResolvedStreamUrl(r.proxy_stream_url || r.stream_url || first.iframe);
              setResolvedSubtitleUrl(r.subtitle_url || r.subtitles?.[0] || null);
              return;
            }
          } catch {
            // fallback to iframe
          }
        }
        setResolvedStreamUrl(first.iframe);
      } else {
        setErrorMsg(`No ${track.toUpperCase()} servers available for this episode.`);
      }
    } catch (err: any) {
      setServers([]);
      setSelectedServer(null);
      setErrorMsg(err?.message || 'Failed to load servers');
    } finally {
      setIsLoadingServers(false);
    }
  };

  const handlePickAnime = async (item: BrowseAnimeItem) => {
    setIsLoadingDetails(true);
    setErrorMsg(null);
    setServers([]);
    setSelectedServer(null);
    try {
      const details = await api.getBrowseAnimeDetails(item.id);
      setSelectedAnime(details);
      const firstEp = details.episodes?.[0] || null;
      setSelectedEp(firstEp);
      if (firstEp?.episode_id) {
        const track: 'sub' | 'dub' = firstEp.sub === false && firstEp.dub ? 'dub' : 'sub';
        setAudioType(track);
        await fetchServers(firstEp, track);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load anime episodes');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handlePickEpisode = (ep: BrowseEpisodeItem) => {
    setSelectedEp(ep);
    let nextTrack = audioType;
    if (nextTrack === 'dub' && ep.dub === false && ep.sub !== false) {
      nextTrack = 'sub';
      setAudioType('sub');
    } else if (nextTrack === 'sub' && ep.sub === false && ep.dub) {
      nextTrack = 'dub';
      setAudioType('dub');
    }
    fetchServers(ep, nextTrack);
  };

  const handleQueueEpisode = async () => {
    const streamTarget = resolvedStreamUrl || selectedServer?.iframe;
    if (!selectedAnime || !selectedEp || !streamTarget) return;
    setIsAdding(true);
    setErrorMsg(null);
    try {
      const res = await api.addOnlineEpisode(
        auth.room.code,
        {
          anime_title: selectedAnime.title,
          season: 1,
          episode_number: selectedEp.episode_number,
          display_title: selectedEp.title,
          stream_url: streamTarget,
          subtitle_url: resolvedSubtitleUrl,
          set_active: setActive,
        },
        {
          participantId: auth.participant_id,
          sessionToken: auth.session_token,
        }
      );
      onEpisodeAdded(res.episode);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to add episode to room queue');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-void-900 border border-void-700 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-void-800">
          <div>
            <h3 className="text-sm font-bold text-white">Stream Anime from Provider</h3>
            <p className="text-xs text-ink-muted">
              Search anime, select an episode & server, and queue it in this room
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-muted hover:text-white hover:bg-void-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-ink-dim absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search anime (e.g., One Piece, Frieren, Naruto)..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-void-950 border border-void-700 text-sm text-white placeholder-ink-dim focus:outline-none focus:border-violet-500"
              />
            </div>
            <Button type="submit" variant="primary" size="sm" isLoading={isSearching}>
              Search
            </Button>
          </form>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-800/60 text-xs text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isLoadingDetails && (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-ink-muted">
              <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              <span>Loading episodes...</span>
            </div>
          )}

          {!selectedAnime && !isLoadingDetails && searchResults.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {searchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handlePickAnime(item)}
                  className="text-left rounded-xl bg-void-950 border border-void-800 hover:border-violet-500 p-2 flex items-center gap-2.5 transition-colors"
                >
                  {item.cover_image && (
                    <img
                      src={item.cover_image}
                      alt={item.title}
                      className="w-10 h-14 object-cover rounded shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white line-clamp-2">{item.title}</p>
                    <p className="text-[10px] font-mono text-ink-dim mt-1">
                      {item.episodes_count || '?'} EP • {item.type || 'ANIME'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedAnime && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-void-800">
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-white truncate">{selectedAnime.title}</h4>
                  <p className="text-[11px] text-ink-muted">
                    {selectedAnime.episodes?.length || 0} episodes available
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedAnime(null)}
                >
                  Change Anime
                </Button>
              </div>

              {/* Episodes */}
              <div className="max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-1">
                {(selectedAnime.episodes || []).map((ep) => {
                  const active = ep.episode_number === selectedEp?.episode_number;
                  return (
                    <button
                      key={`${ep.episode_id || ep.episode_number}`}
                      type="button"
                      onClick={() => handlePickEpisode(ep)}
                      className={`px-2.5 py-1.5 rounded-lg border text-left text-xs flex items-center justify-between gap-2 ${
                        active
                          ? 'bg-violet-950/80 border-violet-500 text-white'
                          : 'bg-void-950 border-void-800 text-ink-muted hover:text-white'
                      }`}
                    >
                      <span className="truncate">
                        {ep.episode_number}. {ep.title}
                      </span>
                      <Play className="w-3 h-3 shrink-0" />
                    </button>
                  );
                })}
              </div>

              {/* Audio & Server Picker */}
              {selectedEp && (
                <div className="p-3 rounded-xl bg-void-950 border border-void-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5 text-violet-400" />
                      Episode {selectedEp.episode_number} Servers
                    </span>

                    <div className="inline-flex rounded-lg bg-void-900 border border-void-700 p-0.5 text-[11px]">
                      <button
                        type="button"
                        disabled={selectedEp.sub === false || isLoadingServers}
                        onClick={() => {
                          setAudioType('sub');
                          fetchServers(selectedEp, 'sub');
                        }}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium disabled:opacity-40 ${
                          audioType === 'sub' ? 'bg-violet-600 text-white' : 'text-ink-muted'
                        }`}
                      >
                        <Captions className="w-3 h-3" /> SUB
                      </button>
                      <button
                        type="button"
                        disabled={selectedEp.dub === false || isLoadingServers}
                        onClick={() => {
                          setAudioType('dub');
                          fetchServers(selectedEp, 'dub');
                        }}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium disabled:opacity-40 ${
                          audioType === 'dub' ? 'bg-violet-600 text-white' : 'text-ink-muted'
                        }`}
                      >
                        <Mic className="w-3 h-3" /> DUB
                      </button>
                    </div>
                  </div>

                  {isLoadingServers ? (
                    <div className="flex items-center gap-2 text-xs text-ink-muted">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
                      <span>Fetching servers...</span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {servers.map((srv, i) => {
                        const active = selectedServer?.iframe === srv.iframe;
                        return (
                          <button
                            key={`${srv.serverId || i}`}
                            type="button"
                            onClick={async () => {
                              setSelectedServer(srv);
                              setIsLoadingServers(true);
                              try {
                                const r = await api.resolveProviderStream(srv.iframe);
                                if (r.mode === 'stream' && (r.proxy_stream_url || r.stream_url)) {
                                  setResolvedStreamUrl(r.proxy_stream_url || r.stream_url || srv.iframe);
                                  setResolvedSubtitleUrl(r.subtitle_url || r.subtitles?.[0] || null);
                                } else {
                                  setResolvedStreamUrl(srv.iframe);
                                  setResolvedSubtitleUrl(null);
                                }
                              } catch {
                                setResolvedStreamUrl(srv.iframe);
                                setResolvedSubtitleUrl(null);
                              } finally {
                                setIsLoadingServers(false);
                              }
                            }}
                            className={`px-3 py-1 rounded-lg border text-xs font-mono ${
                              active
                                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
                                : 'bg-void-900 border-void-700 text-ink-muted hover:text-white'
                            }`}
                          >
                            {srv.serverName || `Server ${i + 1}`}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setActive}
                      onChange={(e) => setSetActive(e.target.checked)}
                      className="rounded border-void-700 bg-void-900 accent-violet-600"
                    />
                    <span>Play immediately as active room episode</span>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-void-800 flex items-center justify-end gap-2 bg-void-950/60">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!selectedServer || isAdding}
            isLoading={isAdding}
            onClick={handleQueueEpisode}
          >
            Add to Room Queue
          </Button>
        </div>
      </div>
    </div>
  );
};
