/**
 * OnlineVideoPlayer — Authorized Online Media Player (MP4 / WebM / HLS)
 *
 * Dedicated player for authorized direct media URLs (.mp4, .webm, .m3u8).
 * Exposes VideoPlayerHandle for seamless Watch Together synchronization via useVideoSync.
 * Leaves the existing local VideoPlayer.tsx completely untouched.
 */
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  AlertCircle,
  RefreshCw,
  Captions,
  CaptionsOff,
  Loader2,
  Tv,
} from 'lucide-react';
import { Button } from '../common/Button';
import { SyncHealthBadge } from './SyncHealthBadge';
import { SyncStatusState } from '../../services/drift';
import { formatTime } from '../../services/playerUtils';
import { SubtitleCue, parseSubtitles, findActiveCues } from '../../services/subtitles';
import { VideoPlayerHandle } from './VideoPlayer';

export interface OnlineVideoPlayerProps {
  streamUrl: string | null;
  subtitleUrl?: string | null;
  animeTitle?: string;
  episodeNumber?: number;
  persistKey?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (time: number) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onPlaybackRateChange?: (rate: number) => void;
  onBufferingStart?: () => void;
  onBufferingEnd?: () => void;
  onEnded?: () => void;
  bufferingParticipants?: string[];
  onResync?: () => void;
  isResyncing?: boolean;
  syncStatus?: SyncStatusState;
  latencyMs?: number | null;
  driftSeconds?: number;
  isTheaterMode?: boolean;
  onToggleTheaterMode?: () => void;
  fullscreenOverlay?: React.ReactNode;
  className?: string;
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const POS_STORAGE_PREFIX = 'animesync_online_pos_';

export const OnlineVideoPlayer = forwardRef<VideoPlayerHandle, OnlineVideoPlayerProps>(
  (
    {
      streamUrl,
      subtitleUrl = null,
      animeTitle = 'Online Media',
      episodeNumber,
      persistKey,
      onPlay,
      onPause,
      onSeek,
      onTimeUpdate,
      onPlaybackRateChange,
      onBufferingStart,
      onBufferingEnd,
      onEnded,
      bufferingParticipants = [],
      onResync,
      isResyncing = false,
      syncStatus,
      latencyMs,
      driftSeconds,
      isTheaterMode = false,
      onToggleTheaterMode,
      fullscreenOverlay,
      className = '',
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const isRemoteActionRef = useRef<boolean>(false);
    const lastSavedPosRef = useRef<number>(0);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [reloadNonce, setReloadNonce] = useState(0);

    const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
    const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
    const [nativeTrackUrl, setNativeTrackUrl] = useState<string | null>(null);

    const runAsRemote = useCallback((fn: () => void) => {
      isRemoteActionRef.current = true;
      try {
        fn();
      } finally {
        setTimeout(() => {
          isRemoteActionRef.current = false;
        }, 60);
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        play: async () => {
          const v = videoRef.current;
          if (!v) return false;
          let started = false;
          isRemoteActionRef.current = true;
          try {
            await v.play();
            started = true;
          } catch {
            started = false;
          } finally {
            setTimeout(() => {
              isRemoteActionRef.current = false;
            }, 60);
          }
          return started;
        },
        pause: () => runAsRemote(() => videoRef.current?.pause()),
        seek: (seconds: number) => {
          runAsRemote(() => {
            if (videoRef.current && Number.isFinite(seconds)) {
              videoRef.current.currentTime = Math.max(0, seconds);
            }
          });
        },
        setPlaybackRate: (rate: number) => {
          runAsRemote(() => {
            if (videoRef.current && Number.isFinite(rate)) {
              videoRef.current.playbackRate = rate;
              setPlaybackRate(rate);
            }
          });
        },
        getCurrentTime: () => videoRef.current?.currentTime || 0,
        getDuration: () => videoRef.current?.duration || 0,
        isPaused: () => videoRef.current?.paused ?? true,
        getVideoElement: () => videoRef.current,
      }),
      [runAsRemote]
    );

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      setErrorMsg(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);

      if (!streamUrl) {
        video.removeAttribute('src');
        video.load();
        return;
      }

      setIsLoading(true);
      const isHls = streamUrl.toLowerCase().includes('.m3u8');

      if (isHls) {
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
          hlsRef.current = hls;
          hls.loadSource(streamUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => setIsLoading(false));
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              setIsLoading(false);
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                setErrorMsg('Network or CORS error loading HLS stream. Ensure the URL is accessible.');
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError();
              } else {
                setErrorMsg('Fatal HLS playback error. This stream format may not be supported.');
                hls.destroy();
              }
            }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = streamUrl;
        } else {
          setIsLoading(false);
          setErrorMsg('HLS (.m3u8) playback is not supported in this browser.');
        }
      } else {
        video.src = streamUrl;
      }

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    }, [streamUrl, reloadNonce]);

    useEffect(() => {
      setSubtitleCues([]);
      setNativeTrackUrl(null);
      if (!subtitleUrl) return;

      let cancelled = false;
      fetch(subtitleUrl)
        .then((res) => {
          if (!res.ok) throw new Error('Subtitle fetch failed');
          return res.text();
        })
        .then((text) => {
          if (cancelled) return;
          const cues = parseSubtitles(text, subtitleUrl);
          if (cues.length > 0) {
            setSubtitleCues(cues);
          } else if (subtitleUrl.toLowerCase().includes('.vtt')) {
            setNativeTrackUrl(subtitleUrl);
          }
        })
        .catch(() => {
          if (!cancelled && subtitleUrl.toLowerCase().includes('.vtt')) {
            setNativeTrackUrl(subtitleUrl);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [subtitleUrl]);

    useEffect(() => {
      const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
      document.addEventListener('fullscreenchange', onFsChange);
      return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    const handleLoadedMetadata = () => {
      const video = videoRef.current;
      if (!video) return;
      setIsLoading(false);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);

      if (persistKey) {
        try {
          const saved = localStorage.getItem(`${POS_STORAGE_PREFIX}${persistKey}`);
          if (saved) {
            const parsed = parseFloat(saved);
            if (Number.isFinite(parsed) && parsed > 2 && (!video.duration || parsed < video.duration - 5)) {
              runAsRemote(() => {
                video.currentTime = parsed;
              });
              setCurrentTime(parsed);
            }
          }
        } catch {
          // ignore storage errors
        }
      }
    };

    const togglePlay = () => {
      const video = videoRef.current;
      if (!video || !streamUrl) return;
      if (video.paused) {
        video.play().catch(() => {
          setErrorMsg('Playback blocked or source unsupported. Click Retry or verify the URL.');
        });
      } else {
        video.pause();
      }
    };

    const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextTime = parseFloat(e.target.value);
      const video = videoRef.current;
      if (!video || !Number.isFinite(nextTime)) return;
      video.currentTime = nextTime;
      setCurrentTime(nextTime);
      if (!isRemoteActionRef.current) onSeek?.(nextTime);
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      setVolume(val);
      setIsMuted(val === 0);
      if (videoRef.current) {
        videoRef.current.volume = val;
        videoRef.current.muted = val === 0;
      }
    };

    const toggleMute = () => {
      const nextMuted = !isMuted;
      setIsMuted(nextMuted);
      if (videoRef.current) videoRef.current.muted = nextMuted;
    };

    const handleSpeedChange = (rate: number) => {
      setPlaybackRate(rate);
      if (videoRef.current) videoRef.current.playbackRate = rate;
      if (!isRemoteActionRef.current) onPlaybackRateChange?.(rate);
    };

    const toggleFullscreen = () => {
      const el = containerRef.current;
      if (!el) return;
      if (!document.fullscreenElement) {
        el.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    };

    const activeCues =
      subtitlesEnabled && subtitleCues.length > 0
        ? findActiveCues(subtitleCues, currentTime)
        : [];

    return (
      <div
        ref={containerRef}
        className={`relative bg-black rounded-xl overflow-hidden border border-void-700/80 shadow-2xl select-none flex flex-col ${className}`}
      >
        <div className="flex items-center justify-between px-3 py-2 bg-void-950/90 border-b border-void-800/80 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-white truncate">{animeTitle}</span>
            {episodeNumber !== undefined && (
              <span className="px-1.5 py-0.5 rounded bg-violet-950/80 text-violet-300 border border-violet-800/60 font-mono text-[10px]">
                EP {episodeNumber}
              </span>
            )}
          </div>
          {syncStatus && (
            <SyncHealthBadge
              status={syncStatus}
              latencyMs={latencyMs ?? null}
              driftSeconds={driftSeconds ?? 0}
              onResync={onResync || (() => {})}
              isResyncing={isResyncing}
            />
          )}
        </div>

        <div className="relative flex-1 bg-black aspect-video flex items-center justify-center">
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            playsInline
            crossOrigin="anonymous"
            onClick={togglePlay}
            onLoadedMetadata={handleLoadedMetadata}
            onCanPlay={() => setIsLoading(false)}
            onWaiting={() => {
              setIsLoading(true);
              if (!isRemoteActionRef.current) onBufferingStart?.();
            }}
            onPlaying={() => {
              setIsLoading(false);
              if (!isRemoteActionRef.current) onBufferingEnd?.();
            }}
            onPlay={() => {
              setIsPlaying(true);
              if (!isRemoteActionRef.current) onPlay?.();
            }}
            onPause={() => {
              setIsPlaying(false);
              if (!isRemoteActionRef.current) onPause?.();
            }}
            onTimeUpdate={() => {
              const v = videoRef.current;
              if (!v) return;
              setCurrentTime(v.currentTime);
              if (Number.isFinite(v.duration)) setDuration(v.duration);
              onTimeUpdate?.(v.currentTime, v.duration || 0);

              if (persistKey && Math.abs(v.currentTime - lastSavedPosRef.current) >= 3) {
                lastSavedPosRef.current = v.currentTime;
                try {
                  localStorage.setItem(`${POS_STORAGE_PREFIX}${persistKey}`, String(Math.floor(v.currentTime)));
                } catch {
                  // ignore storage errors
                }
              }
            }}
            onEnded={() => {
              setIsPlaying(false);
              onEnded?.();
            }}
            onError={() => {
              setIsLoading(false);
              setErrorMsg(
                'Unable to play this media URL. Ensure it is a browser-compatible MP4, WebM, or HLS (.m3u8) source.'
              );
            }}
          >
            {nativeTrackUrl && subtitlesEnabled && (
              <track kind="subtitles" src={nativeTrackUrl} default />
            )}
          </video>

          {activeCues.length > 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-[85%] text-center pointer-events-none z-20">
              {activeCues.map((cue, idx) => (
                <div
                  key={idx}
                  className="px-3 py-1 rounded bg-black/75 text-white text-sm sm:text-base font-medium leading-snug shadow"
                >
                  {cue.text}
                </div>
              ))}
            </div>
          )}

          {!streamUrl && !errorMsg && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-dim p-6 text-center">
              <Tv className="w-10 h-10 mb-2 text-violet-400/60" />
              <p className="text-sm font-medium text-ink-text">No Media Source Loaded</p>
              <p className="text-xs text-ink-muted mt-1">
                Load an authorized MP4, WebM, or HLS (.m3u8) URL below to start watching.
              </p>
            </div>
          )}

          {isLoading && streamUrl && !errorMsg && (
            <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-void-950/85 border border-void-700 text-xs text-ink-text shadow-lg">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
              <span>Loading media…</span>
            </div>
          )}

          {bufferingParticipants.length > 0 && !errorMsg && (
            <div className="absolute top-3 right-3 z-20 px-2.5 py-1 rounded-full bg-amber-950/90 border border-amber-700/60 text-[11px] text-amber-200">
              Waiting for {bufferingParticipants.join(', ')}…
            </div>
          )}

          {errorMsg && (
            <div className="absolute inset-0 z-30 bg-void-950/90 flex flex-col items-center justify-center p-6 text-center">
              <AlertCircle className="w-10 h-10 text-rose-400 mb-2" />
              <p className="text-sm font-semibold text-white max-w-md">{errorMsg}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={() => {
                  setErrorMsg(null);
                  setReloadNonce((n) => n + 1);
                }}
              >
                Retry Media
              </Button>
            </div>
          )}

          {isFullscreen && fullscreenOverlay}
        </div>

        <div className="bg-void-950/95 border-t border-void-800/80 px-3 py-2 space-y-2">
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 100}
            step={0.1}
            value={Math.min(currentTime, duration > 0 ? duration : 100)}
            onChange={handleSeekChange}
            disabled={!streamUrl}
            aria-label="Seek timeline"
            className="w-full h-1.5 bg-void-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
          />

          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={togglePlay}
                disabled={!streamUrl}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="p-1.5 rounded-lg bg-void-800 hover:bg-void-700 text-white disabled:opacity-40 transition-colors"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>

              <span className="font-mono text-ink-muted tabular-nums">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              <div className="hidden sm:flex items-center gap-1.5 ml-2">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="p-1 text-ink-muted hover:text-white"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  aria-label="Volume"
                  className="w-16 h-1 bg-void-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(subtitleUrl || subtitleCues.length > 0) && (
                <button
                  type="button"
                  onClick={() => setSubtitlesEnabled((s) => !s)}
                  title={subtitlesEnabled ? 'Disable Subtitles' : 'Enable Subtitles'}
                  className={`p-1.5 rounded-lg border transition-colors ${
                    subtitlesEnabled
                      ? 'bg-violet-950/80 border-violet-700 text-violet-300'
                      : 'bg-void-900 border-void-700 text-ink-dim'
                  }`}
                >
                  {subtitlesEnabled ? <Captions className="w-4 h-4" /> : <CaptionsOff className="w-4 h-4" />}
                </button>
              )}

              <select
                value={playbackRate}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                aria-label="Playback speed"
                className="bg-void-900 border border-void-700 text-ink-text rounded px-1.5 py-1 text-[11px] font-mono"
              >
                {SPEED_OPTIONS.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}x
                  </option>
                ))}
              </select>

              {onToggleTheaterMode && (
                <button
                  type="button"
                  onClick={onToggleTheaterMode}
                  title="Toggle Theater Mode"
                  className={`p-1.5 rounded-lg border transition-colors ${
                    isTheaterMode
                      ? 'bg-violet-950 border-violet-700 text-violet-300'
                      : 'bg-void-900 border-void-700 text-ink-muted hover:text-white'
                  }`}
                >
                  <Tv className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                className="p-1.5 rounded-lg bg-void-900 border border-void-700 text-ink-muted hover:text-white transition-colors"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

OnlineVideoPlayer.displayName = 'OnlineVideoPlayer';
