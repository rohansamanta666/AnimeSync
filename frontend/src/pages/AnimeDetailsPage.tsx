import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Star, Calendar, Film, Loader2, AlertCircle } from 'lucide-react';
import { api, sessionStore } from '../services/api';
import { BrowseAnimeItem, BrowseEpisodeItem } from '../types';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { EpisodeList } from '../components/browse/EpisodeList';
import { MediaSourceSelector } from '../components/browse/MediaSourceSelector';
import { DownloadManager } from '../components/browse/DownloadManager';
import { OnlineVideoPlayer } from '../components/video/OnlineVideoPlayer';

export const AnimeDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [anime, setAnime] = useState<BrowseAnimeItem | null>(null);
  const [selectedEp, setSelectedEp] = useState<BrowseEpisodeItem | null>(null);
  const [activeStreamUrl, setActiveStreamUrl] = useState<string | null>(null);
  const [activeSubtitleUrl, setActiveSubtitleUrl] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadRefresh, setDownloadRefresh] = useState(0);

  useEffect(() => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    api.getBrowseAnimeDetails(id)
      .then((data) => {
        setAnime(data);
        const firstEp = data.episodes?.[0] || { episode_number: 1, title: 'Episode 1' };
        setSelectedEp(firstEp);
        setActiveStreamUrl(firstEp.stream_url || null);
        setActiveSubtitleUrl(firstEp.subtitle_url || null);
      })
      .catch((err: any) => {
        setError(err?.message || 'Failed to load anime details');
      })
      .finally(() => setIsLoading(false));
  }, [id]);

  const handleSelectEpisode = (ep: BrowseEpisodeItem) => {
    setSelectedEp(ep);
    setActiveStreamUrl(ep.stream_url || null);
    setActiveSubtitleUrl(ep.subtitle_url || null);
  };

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
    hostName: string
  ) => {
    if (!anime || !selectedEp) return;
    const roomName = `${anime.title.slice(0, 38)} — Ep ${selectedEp.episode_number}`;
    const auth = await api.createRoom(roomName, hostName || 'Host');
    sessionStore.save(auth.room.code, auth);

    await api.addOnlineEpisode(
      auth.room.code,
      {
        anime_title: anime.title,
        season: 1,
        episode_number: selectedEp.episode_number,
        display_title: selectedEp.title,
        stream_url: streamUrl,
        subtitle_url: subtitleUrl,
        set_active: true,
      },
      {
        participantId: auth.participant_id,
        sessionToken: auth.session_token,
      }
    );

    navigate(`/room/${auth.room.code}`);
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

  const persistKey = selectedEp ? `${anime.id}_ep_${selectedEp.episode_number}` : undefined;

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
              <Badge variant={anime.provider === 'open_catalog' ? 'green' : 'violet'}>
                {anime.provider === 'open_catalog' ? 'Open-Licensed Catalog' : 'AniList Metadata'}
              </Badge>
            </div>

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
              <span>{anime.episodes_count} Episodes</span>
              <span>•</span>
              <span>{anime.status}</span>
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

      {/* Player + Source Selector + Episode List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <OnlineVideoPlayer
            streamUrl={activeStreamUrl}
            subtitleUrl={activeSubtitleUrl}
            animeTitle={anime.title}
            episodeNumber={selectedEp?.episode_number}
            persistKey={persistKey}
          />

          <MediaSourceSelector
            animeTitle={anime.title}
            episodeNumber={selectedEp?.episode_number || 1}
            initialStreamUrl={selectedEp?.stream_url}
            initialSubtitleUrl={selectedEp?.subtitle_url}
            activeStreamUrl={activeStreamUrl}
            onLoadSource={handleLoadSource}
            onDownloadSource={handleDownloadSource}
            onWatchTogether={handleWatchTogether}
          />
        </div>

        <div className="space-y-6">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-white mb-3">
              Episodes ({anime.episodes?.length || 0})
            </h2>
            <EpisodeList
              episodes={anime.episodes || []}
              selectedEpisodeNumber={selectedEp?.episode_number || 1}
              onSelectEpisode={handleSelectEpisode}
            />
          </Card>

          <DownloadManager refreshTrigger={downloadRefresh} />
        </div>
      </div>
    </div>
  );
};
