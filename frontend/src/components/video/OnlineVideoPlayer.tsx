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
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  AlertCircle,
  RefreshCw,
  Captions,
  CaptionsOff,
  Tv,
  ExternalLink,
  Shield,
  ShieldAlert,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  MessageSquare,
  X,
} from 'lucide-react';
import { Button } from '../common/Button';
import { SyncHealthBadge } from './SyncHealthBadge';
import { SyncStatusState } from '../../services/drift';
import { formatTime } from '../../services/playerUtils';
import { SubtitleCue, parseSubtitles, findActiveCues } from '../../services/subtitles';
import { VideoPlayerHandle } from './VideoPlayer';

export function isDirectMediaStreamUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.startsWith('/api/browse/stream-proxy')) return true;
  const clean = lower.split('?')[0].split('#')[0];
  return (
    lower.includes('.m3u8') ||
    clean.endsWith('.mp4') ||
    clean.endsWith('.webm') ||
    clean.endsWith('.m4v') ||
    clean.endsWith('.ogg')
  );
}

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
  onReady?: () => void;
  onPlaybackError?: () => void;
  onSwitchNextServer?: () => void;
  nextServerLabel?: string | null;
  bufferingParticipants?: string[];
  onResync?: () => void;
  isResyncing?: boolean;
  syncStatus?: SyncStatusState;
  latencyMs?: number | null;
  driftSeconds?: number;
  isTheaterMode?: boolean;
  onToggleTheaterMode?: () => void;
  fullscreenOverlay?: React.ReactNode;
  unreadCount?: number;
  className?: string;
}

const isTypingElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
};

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const POS_STORAGE_PREFIX = 'animesync_online_pos_';
export const IFRAME_AD_SHIELD_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-presentation';

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
      onReady,
      onPlaybackError,
      onSwitchNextServer,
      nextServerLabel = null,
      bufferingParticipants = [],
      onResync,
      isResyncing = false,
      syncStatus,
      latencyMs,
      driftSeconds,
      isTheaterMode = false,
      onToggleTheaterMode,
      fullscreenOverlay,
      unreadCount = 0,
      className = '',
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const isRemoteActionRef = useRef<boolean>(false);
    const lastSavedPosRef = useRef<number>(0);
    const lastKnownTimeRef = useRef<number>(0);
    const isRecoveringRef = useRef<boolean>(false);
    const waitingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [bufferedEnd, setBufferedEnd] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [showFullscreenDrawer, setShowFullscreenDrawer] = useState(false);
    const [actionIndicator, setActionIndicator] = useState<'play' | 'pause' | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [reloadNonce, setReloadNonce] = useState(0);
    const [useStreamProxy, setUseStreamProxy] = useState(false);
    const [adShieldEnabled, setAdShieldEnabled] = useState(true);

    const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
    const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
    const [nativeTrackUrl, setNativeTrackUrl] = useState<string | null>(null);

    const isEmbedMode = Boolean(streamUrl) && !isDirectMediaStreamUrl(streamUrl);
    const effectiveStreamUrl =
      streamUrl && !isEmbedMode && useStreamProxy && !streamUrl.startsWith('/api/browse/stream-proxy')
        ? `/api/browse/stream-proxy?url=${encodeURIComponent(streamUrl)}`
        : streamUrl;

    useEffect(() => {
      setUseStreamProxy(false);
      lastKnownTimeRef.current = 0;
      isRecoveringRef.current = false;
    }, [streamUrl]);

    const runAsRemote = useCallback((fn: () => void) => {
      isRemoteActionRef.current = true;
      try {
        fn();
      } finally {
        setTimeout(() => {
          isRemoteActionRef.current = false;
        }, 150);
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
            }, 150);
          }
          return started;
        },
        pause: () => runAsRemote(() => videoRef.current?.pause()),
        seek: (seconds: number) => {
          runAsRemote(() => {
            if (videoRef.current && Number.isFinite(seconds)) {
              const target = Math.max(0, seconds);
              lastKnownTimeRef.current = target;
              videoRef.current.currentTime = target;
              setCurrentTime(target);
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
      const resumePosition = lastKnownTimeRef.current > 1 ? lastKnownTimeRef.current : 0;
      if (resumePosition === 0) {
        setCurrentTime(0);
        setDuration(0);
      }

      if (!effectiveStreamUrl || isEmbedMode) {
        video.removeAttribute('src');
        video.load();
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const lowerEff = effectiveStreamUrl.toLowerCase();
      const lowerRaw = (streamUrl || '').toLowerCase();
      const isHls =
        lowerEff.includes('.m3u8') ||
        lowerRaw.includes('.m3u8') ||
        lowerEff.includes('format=hls') ||
        lowerRaw.includes('format=hls');

      if (isHls) {
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            startPosition: resumePosition > 0 ? resumePosition : -1,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 1000,
            manifestLoadingMaxRetry: 4,
            levelLoadingMaxRetry: 4,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
          });
          hlsRef.current = hls;
          let networkRecoveryAttempts = 0;
          hls.loadSource(effectiveStreamUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            networkRecoveryAttempts = 0;
            setIsLoading(false);
            const targetPos = lastKnownTimeRef.current;
            if (targetPos > 1.5 && Math.abs(video.currentTime - targetPos) > 1.5) {
              runAsRemote(() => {
                video.currentTime = targetPos;
                setCurrentTime(targetPos);
              });
            }
          });
          hls.on(Hls.Events.FRAG_LOADED, () => {
            networkRecoveryAttempts = 0;
            isRecoveringRef.current = false;
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              const savedPos = video.currentTime > 1 ? video.currentTime : lastKnownTimeRef.current;
              if (savedPos > 1) {
                lastKnownTimeRef.current = savedPos;
              }
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                if (networkRecoveryAttempts < 3) {
                  networkRecoveryAttempts += 1;
                  isRecoveringRef.current = savedPos > 1;
                  setTimeout(() => {
                    if (hlsRef.current === hls) {
                      hls.startLoad(savedPos > 1 ? savedPos : -1);
                    }
                  }, 1000 * networkRecoveryAttempts);
                  return;
                }
                setIsLoading(false);
                if (!useStreamProxy && streamUrl && !streamUrl.startsWith('/api/browse/stream-proxy')) {
                  isRecoveringRef.current = savedPos > 1;
                  setUseStreamProxy(true);
                  return;
                }
                setErrorMsg('Network or CORS error loading HLS stream. Ensure the URL is accessible.');
                onPlaybackError?.();
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                setIsLoading(false);
                isRecoveringRef.current = savedPos > 1;
                hls.recoverMediaError();
              } else {
                setIsLoading(false);
                setErrorMsg('Fatal HLS playback error. This stream format may not be supported.');
                hls.destroy();
                onPlaybackError?.();
              }
            }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = effectiveStreamUrl;
        } else {
          setIsLoading(false);
          setErrorMsg('HLS (.m3u8) playback is not supported in this browser.');
        }
      } else {
        video.src = effectiveStreamUrl;
      }

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    }, [effectiveStreamUrl, streamUrl, isEmbedMode, useStreamProxy, reloadNonce]);

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
      const onFsChange = () => {
        const fs = Boolean(document.fullscreenElement);
        setIsFullscreen(fs);
        if (!fs) {
          setShowFullscreenDrawer(false);
        }
      };
      document.addEventListener('fullscreenchange', onFsChange);
      return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    const resetHideTimer = useCallback(() => {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      const video = videoRef.current;
      if (video && !video.paused && !showFullscreenDrawer && !showSpeedMenu) {
        hideTimerRef.current = setTimeout(() => {
          setControlsVisible(false);
        }, 2500);
      }
    }, [showFullscreenDrawer, showSpeedMenu]);

    useEffect(() => {
      if (isPlaying && !showFullscreenDrawer && !showSpeedMenu) {
        resetHideTimer();
      } else {
        setControlsVisible(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      }
      return () => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      };
    }, [isPlaying, showFullscreenDrawer, showSpeedMenu, resetHideTimer]);

    useEffect(() => {
      return () => {
        if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current);
        if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
      };
    }, []);

    const clearWaitingTimer = useCallback(() => {
      if (waitingTimerRef.current) {
        clearTimeout(waitingTimerRef.current);
        waitingTimerRef.current = null;
      }
    }, []);

    const flashIndicator = useCallback((type: 'play' | 'pause') => {
      setActionIndicator(type);
      if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current);
      indicatorTimerRef.current = setTimeout(() => setActionIndicator(null), 300);
    }, []);

    const handleLoadedMetadata = () => {
      const video = videoRef.current;
      if (!video) return;
      setIsLoading(false);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);

      const resumeTarget = lastKnownTimeRef.current;
      if (resumeTarget > 1.5 && video.currentTime < 1) {
        runAsRemote(() => {
          video.currentTime = resumeTarget;
          setCurrentTime(resumeTarget);
        });
      } else if (persistKey) {
        try {
          const saved = localStorage.getItem(`${POS_STORAGE_PREFIX}${persistKey}`);
          if (saved) {
            const parsed = parseFloat(saved);
            if (Number.isFinite(parsed) && parsed > 2 && (!video.duration || parsed < video.duration - 5)) {
              lastKnownTimeRef.current = parsed;
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

      onReady?.();
    };

    const togglePlay = useCallback(() => {
      const video = videoRef.current;
      if (!video || !streamUrl || isEmbedMode) return;
      if (video.paused) {
        video.play().catch(() => {
          setErrorMsg('Playback blocked or source unsupported. Click Retry or verify the URL.');
        });
        flashIndicator('play');
      } else {
        video.pause();
        flashIndicator('pause');
      }
    }, [streamUrl, isEmbedMode, flashIndicator]);

    const handleSeek = useCallback(
      (nextTime: number) => {
        const video = videoRef.current;
        if (!video || !Number.isFinite(nextTime)) return;
        const maxDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
        const clamped = Math.max(0, maxDuration > 0 ? Math.min(nextTime, maxDuration) : nextTime);
        lastKnownTimeRef.current = clamped;
        video.currentTime = clamped;
        setCurrentTime(clamped);
        if (!isRemoteActionRef.current) onSeek?.(clamped);
      },
      [duration, onSeek]
    );

    const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      handleSeek(parseFloat(e.target.value));
    };

    const handleVolumeValue = useCallback(
      (val: number) => {
        const clamped = Math.max(0, Math.min(1, val));
        setVolume(clamped);
        if (videoRef.current) {
          videoRef.current.volume = clamped;
          if (clamped > 0 && isMuted) {
            videoRef.current.muted = false;
            setIsMuted(false);
          } else if (clamped === 0) {
            videoRef.current.muted = true;
            setIsMuted(true);
          }
        }
      },
      [isMuted]
    );

    const toggleMute = useCallback(() => {
      const nextMuted = !isMuted;
      setIsMuted(nextMuted);
      if (videoRef.current) videoRef.current.muted = nextMuted;
    }, [isMuted]);

    const handleSpeedChange = (rate: number) => {
      setPlaybackRate(rate);
      setShowSpeedMenu(false);
      if (videoRef.current) videoRef.current.playbackRate = rate;
      if (!isRemoteActionRef.current) onPlaybackRateChange?.(rate);
    };

    const toggleFullscreen = useCallback(() => {
      const el = containerRef.current;
      if (!el) return;
      if (!document.fullscreenElement) {
        el.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    }, []);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (isTypingElement(e.target)) return;

        switch (e.code) {
          case 'Space':
            if (!isEmbedMode) {
              e.preventDefault();
              togglePlay();
            }
            break;
          case 'ArrowLeft':
            if (!isEmbedMode) {
              e.preventDefault();
              handleSeek(currentTime - 5);
            }
            break;
          case 'ArrowRight':
            if (!isEmbedMode) {
              e.preventDefault();
              handleSeek(currentTime + 5);
            }
            break;
          case 'ArrowUp':
            if (!isEmbedMode) {
              e.preventDefault();
              handleVolumeValue(volume + 0.1);
            }
            break;
          case 'ArrowDown':
            if (!isEmbedMode) {
              e.preventDefault();
              handleVolumeValue(volume - 0.1);
            }
            break;
          case 'KeyM':
            if (!isEmbedMode) {
              e.preventDefault();
              toggleMute();
            }
            break;
          case 'KeyF':
            e.preventDefault();
            toggleFullscreen();
            break;
          case 'KeyT':
            if (onToggleTheaterMode) {
              e.preventDefault();
              onToggleTheaterMode();
            }
            break;
          case 'KeyC':
            if (fullscreenOverlay) {
              e.preventDefault();
              setShowFullscreenDrawer((prev) => !prev);
            }
            break;
          case 'KeyS':
            if (subtitleUrl || subtitleCues.length > 0) {
              e.preventDefault();
              setSubtitlesEnabled((s) => !s);
            }
            break;
          case 'Escape':
            if (showFullscreenDrawer) {
              e.preventDefault();
              setShowFullscreenDrawer(false);
            }
            if (showSpeedMenu) {
              e.preventDefault();
              setShowSpeedMenu(false);
            }
            break;
          case 'KeyR':
            if (e.shiftKey && onResync) {
              e.preventDefault();
              onResync();
            }
            break;
          default:
            break;
        }
      },
      [
        isEmbedMode,
        togglePlay,
        handleSeek,
        currentTime,
        handleVolumeValue,
        volume,
        toggleMute,
        toggleFullscreen,
        onToggleTheaterMode,
        fullscreenOverlay,
        subtitleUrl,
        subtitleCues.length,
        showFullscreenDrawer,
        showSpeedMenu,
        onResync,
      ]
    );

    const activeCues =
      subtitlesEnabled && subtitleCues.length > 0
        ? findActiveCues(subtitleCues, currentTime)
        : [];

    const fullscreenDrawerNode = showFullscreenDrawer && fullscreenOverlay && (
      <div
        className="absolute top-0 right-0 bottom-0 w-80 sm:w-96 z-40 bg-void-950/95 backdrop-blur-md border-l border-void-700/80 shadow-2xl flex flex-col p-4 animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-void-700/60 shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Watch Party Overlay
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowFullscreenDrawer(false)}
            className="p-1.5 rounded-lg text-ink-muted hover:text-white hover:bg-void-800 transition-colors"
            title="Close Drawer (C or Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {fullscreenOverlay}
        </div>
      </div>
    );

    if (isEmbedMode && streamUrl) {
      return (
        <div
          ref={containerRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className={
            isFullscreen
              ? `relative w-full h-full bg-black select-none outline-none flex flex-col ${className}`
              : `relative bg-black rounded-2xl overflow-hidden border border-void-700/60 shadow-2xl select-none outline-none flex flex-col ${className}`
          }
        >
          <div className="flex items-center justify-between px-3 py-2 bg-void-950/95 border-b border-void-800/80 text-xs shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-white truncate">{animeTitle}</span>
              {episodeNumber !== undefined && (
                <span className="px-1.5 py-0.5 rounded bg-violet-950/80 text-violet-300 border border-violet-800/60 font-mono text-[10px]">
                  EP {episodeNumber}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {fullscreenOverlay && (
                <button
                  type="button"
                  onClick={() => setShowFullscreenDrawer((v) => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                    showFullscreenDrawer
                      ? 'bg-violet-600 text-white border-violet-500 shadow-sm'
                      : 'bg-void-900/80 text-ink-muted hover:text-white border-void-700/80 hover:bg-void-800'
                  }`}
                  title="Toggle Communication Drawer (C)"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
                  <span className="hidden sm:inline">Chat & Voice</span>
                  {unreadCount > 0 && (
                    <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
                  )}
                </button>
              )}
              {syncStatus && (
                <SyncHealthBadge
                  status={syncStatus}
                  latencyMs={latencyMs ?? null}
                  driftSeconds={driftSeconds ?? 0}
                  onResync={onResync || (() => {})}
                  isResyncing={isResyncing}
                  compact
                />
              )}
            </div>
          </div>

          <div
            className={
              isFullscreen
                ? 'relative flex-1 min-h-0 bg-black flex items-center justify-center'
                : 'relative w-full aspect-video bg-black flex items-center justify-center'
            }
          >
            <iframe
              key={`${streamUrl}_${reloadNonce}_${adShieldEnabled ? 'shield' : 'unshielded'}`}
              src={streamUrl}
              title={`${animeTitle}${episodeNumber !== undefined ? ` Episode ${episodeNumber}` : ''}`}
              className="w-full h-full border-0"
              sandbox={adShieldEnabled ? IFRAME_AD_SHIELD_SANDBOX : undefined}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              onError={() => onPlaybackError?.()}
            />

            {errorMsg && (
              <div className="absolute inset-0 z-30 bg-void-950/90 flex flex-col items-center justify-center p-6 text-center">
                <AlertCircle className="w-10 h-10 text-rose-400 mb-2" />
                <p className="text-sm font-semibold text-white max-w-md">{errorMsg}</p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                    onClick={() => {
                      setErrorMsg(null);
                      setReloadNonce((n) => n + 1);
                    }}
                  >
                    Retry Media
                  </Button>
                  {onSwitchNextServer && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setErrorMsg(null);
                        onSwitchNextServer();
                      }}
                    >
                      {nextServerLabel ? `Switch to ${nextServerLabel}` : 'Try Next Server'}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="bg-void-950/95 border-t border-void-800/80 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-800/60 text-emerald-300 font-mono text-[10px]">
              EMBED
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAdShieldEnabled((v) => !v)}
                title={
                  adShieldEnabled
                    ? 'Ad & Popup Shield On (blocks iframe popups and redirects). Click to disable if player refuses to load.'
                    : 'Ad & Popup Shield Off. Click to enable popup & redirect blocking.'
                }
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-mono transition-colors ${
                  adShieldEnabled
                    ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                    : 'bg-amber-950/70 border-amber-700 text-amber-300'
                }`}
              >
                {adShieldEnabled ? (
                  <Shield className="w-3.5 h-3.5" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5" />
                )}
                <span>{adShieldEnabled ? 'Ad Shield On' : 'Ad Shield Off'}</span>
              </button>

              {onSwitchNextServer && (
                <button
                  type="button"
                  onClick={onSwitchNextServer}
                  title="Current server not playing? Switch to next available server"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-950/80 border border-violet-700/80 text-violet-200 hover:bg-violet-900 transition-colors"
                >
                  <span>{nextServerLabel ? `Try ${nextServerLabel}` : 'Next Server'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                title="Reload Player"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-void-900 border border-void-700 text-ink-muted hover:text-white transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reload</span>
              </button>

              <a
                href={streamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-void-900 border border-void-700 text-ink-muted hover:text-white transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Pop Out</span>
              </a>

              {onToggleTheaterMode && (
                <button
                  type="button"
                  onClick={onToggleTheaterMode}
                  title={isTheaterMode ? 'Exit Theater Mode (T)' : 'Theater Mode (T)'}
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
                title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
                className="p-1.5 rounded-lg bg-void-900 border border-void-700 text-ink-muted hover:text-white transition-colors"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {fullscreenDrawerNode}
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseMove={resetHideTimer}
        onMouseLeave={() => {
          if (isPlaying && !showFullscreenDrawer) {
            setControlsVisible(false);
            setShowSpeedMenu(false);
          }
        }}
        className={`relative aspect-video bg-black rounded-2xl overflow-hidden select-none outline-none group border border-void-700/60 shadow-2xl ${
          !controlsVisible && isPlaying && !showFullscreenDrawer ? 'cursor-none' : ''
        } ${className}`}
      >
        {/* HTML5 / HLS Video Element */}
        <video
          ref={videoRef}
          className="w-full h-full object-contain cursor-pointer"
          playsInline
          crossOrigin="anonymous"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onLoadedMetadata={handleLoadedMetadata}
          onCanPlay={() => {
            clearWaitingTimer();
            setIsLoading(false);
            const v = videoRef.current;
            if (v && isRecoveringRef.current) {
              const target = lastKnownTimeRef.current;
              isRecoveringRef.current = false;
              if (target > 1.5 && v.currentTime < 1) {
                runAsRemote(() => {
                  v.currentTime = target;
                  setCurrentTime(target);
                });
              }
            }
          }}
          onWaiting={() => {
            const v = videoRef.current;
            setIsLoading(true);
            if (!v || v.paused || isRemoteActionRef.current || isRecoveringRef.current) return;
            clearWaitingTimer();
            waitingTimerRef.current = setTimeout(() => {
              const vid = videoRef.current;
              if (vid && !vid.paused && vid.readyState < 3 && !isRemoteActionRef.current && !isRecoveringRef.current) {
                onBufferingStart?.();
              }
            }, 300);
          }}
          onPlaying={() => {
            clearWaitingTimer();
            setIsLoading(false);
            setIsPlaying(true);
            const v = videoRef.current;
            if (v && isRecoveringRef.current) {
              const target = lastKnownTimeRef.current;
              isRecoveringRef.current = false;
              if (target > 1.5 && v.currentTime < 1) {
                runAsRemote(() => {
                  v.currentTime = target;
                  setCurrentTime(target);
                });
              }
            }
            if (!isRemoteActionRef.current) onBufferingEnd?.();
          }}
          onPlay={() => {
            setIsPlaying(true);
            const v = videoRef.current;
            if (isRecoveringRef.current || (v && v.currentTime < 0.5 && lastKnownTimeRef.current > 3)) {
              return;
            }
            if (!isRemoteActionRef.current) onPlay?.();
          }}
          onPause={() => {
            clearWaitingTimer();
            setIsPlaying(false);
            const v = videoRef.current;
            if (isRecoveringRef.current || (v && v.currentTime < 0.5 && lastKnownTimeRef.current > 3)) {
              return;
            }
            if (!isRemoteActionRef.current) onPause?.();
          }}
          onTimeUpdate={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.currentTime > 0.5 && !isRecoveringRef.current) {
              lastKnownTimeRef.current = v.currentTime;
            }
            setCurrentTime(v.currentTime);
            if (Number.isFinite(v.duration)) setDuration(v.duration);
            if (v.buffered.length > 0) {
              setBufferedEnd(v.buffered.end(v.buffered.length - 1));
            }
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
            clearWaitingTimer();
            setIsPlaying(false);
            onEnded?.();
          }}
          onError={() => {
            clearWaitingTimer();
            setIsLoading(false);
            if (!useStreamProxy && streamUrl && !streamUrl.startsWith('/api/browse/stream-proxy')) {
              const v = videoRef.current;
              if (v && v.currentTime > 1) lastKnownTimeRef.current = v.currentTime;
              isRecoveringRef.current = lastKnownTimeRef.current > 1;
              setUseStreamProxy(true);
              return;
            }
            setErrorMsg(
              'Unable to play this media URL. Ensure it is a browser-compatible MP4, WebM, or HLS (.m3u8) source.'
            );
            onPlaybackError?.();
          }}
        >
          {nativeTrackUrl && subtitlesEnabled && (
            <track kind="subtitles" src={nativeTrackUrl} default />
          )}
        </video>

        {/* Subtitle Overlay */}
        {activeCues.length > 0 && (
          <div
            className={`absolute inset-x-0 flex flex-col items-center justify-end pointer-events-none z-15 transition-all duration-200 px-6 ${
              controlsVisible ? 'bottom-20' : 'bottom-8'
            }`}
          >
            {activeCues.map((cue, idx) => (
              <div
                key={cue.id ?? idx}
                className="my-0.5 px-3 py-1 rounded-md text-center max-w-4xl transition-all duration-100 inline-block font-sans select-none"
                style={{
                  fontSize: `${isFullscreen ? 26 : 19}px`,
                  color: '#FFFFFF',
                  backgroundColor: 'rgba(0, 0, 0, 0.72)',
                  textShadow: '0 2px 4px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,1)',
                  lineHeight: 1.35,
                  fontWeight: 600,
                  whiteSpace: 'pre-line',
                }}
              >
                {cue.text}
              </div>
            ))}
          </div>
        )}

        {/* Central Loading Spinner */}
        {isLoading && streamUrl && !errorMsg && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 transition-opacity duration-200">
            <div className="w-10 h-10 rounded-full border-2 border-violet-400 border-t-transparent animate-spin drop-shadow-[0_0_10px_rgba(167,139,250,0.7)]" />
          </div>
        )}

        {/* Buffering Peers Pill */}
        {bufferingParticipants.length > 0 && !errorMsg && (
          <div className="absolute bottom-16 left-4 z-20 pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-full bg-void-950/85 border border-violet-500/40 shadow-xl backdrop-blur-md transition-all duration-200">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
            <span className="text-xs font-mono font-medium text-violet-200">
              Buffering: {bufferingParticipants.join(', ')}
            </span>
          </div>
        )}

        {/* Central Click / Space Action Flash Indicator */}
        {actionIndicator && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="w-20 h-20 rounded-full bg-void-950/80 border border-violet-500/50 flex items-center justify-center animate-ping duration-300">
              {actionIndicator === 'play' ? (
                <Play className="w-8 h-8 text-violet-400 fill-violet-400 ml-1" />
              ) : (
                <Pause className="w-8 h-8 text-violet-400 fill-violet-400" />
              )}
            </div>
          </div>
        )}

        {/* Empty Source State */}
        {!streamUrl && !errorMsg && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-dim p-6 text-center z-10">
            <Tv className="w-10 h-10 mb-2 text-violet-400/60" />
            <p className="text-sm font-medium text-ink-text">No Media Source Loaded</p>
            <p className="text-xs text-ink-muted mt-1">
              Load an authorized MP4, WebM, or HLS (.m3u8) URL below to start watching.
            </p>
          </div>
        )}

        {/* Error Overlay */}
        {errorMsg && (
          <div className="absolute inset-0 z-30 bg-void-950/90 flex flex-col items-center justify-center p-6 text-center backdrop-blur-md">
            <AlertCircle className="w-10 h-10 text-rose-400 mb-2" />
            <p className="text-sm font-semibold text-white max-w-md">{errorMsg}</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={() => {
                  setErrorMsg(null);
                  setReloadNonce((n) => n + 1);
                }}
              >
                Retry Media
              </Button>
              {onSwitchNextServer && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setErrorMsg(null);
                    onSwitchNextServer();
                  }}
                >
                  {nextServerLabel ? `Switch to ${nextServerLabel}` : 'Try Next Server'}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Top Header Overlay Bar (Auto-hides) */}
        <div
          className={`absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between transition-opacity duration-300 z-10 ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-bold text-white tracking-wide truncate">{animeTitle}</span>
            {episodeNumber !== undefined && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-950/80 text-violet-300 border border-violet-800/80 shrink-0">
                EP {episodeNumber}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {fullscreenOverlay && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowFullscreenDrawer((v) => !v);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                  showFullscreenDrawer
                    ? 'bg-violet-600 text-white border-violet-500 shadow-sm'
                    : 'bg-void-900/80 text-ink-muted hover:text-white border-void-700/80 hover:bg-void-800'
                }`}
                title="Toggle Communication Drawer (C)"
              >
                <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
                <span className="hidden sm:inline">Chat & Voice</span>
                {unreadCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
                )}
              </button>
            )}

            {syncStatus && (
              <SyncHealthBadge
                status={syncStatus}
                latencyMs={latencyMs ?? null}
                driftSeconds={driftSeconds ?? 0}
                onResync={onResync || (() => {})}
                isResyncing={isResyncing}
                compact
              />
            )}
          </div>
        </div>

        {/* Bottom Custom Controls Overlay (Auto-hides) */}
        <div
          className={`absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex flex-col gap-2 transition-opacity duration-300 z-10 ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Progress Scrubber Bar */}
          <div className="relative group/scrubber flex items-center h-4 cursor-pointer">
            <div className="absolute inset-x-0 h-1 rounded-full bg-void-700/80 group-hover/scrubber:h-1.5 transition-all overflow-hidden">
              <div
                className="h-full bg-void-500/50"
                style={{ width: `${duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0}%` }}
              />
            </div>

            <div
              className="absolute left-0 h-1 rounded-full bg-gradient-to-r from-violet-500 to-pink-500 group-hover/scrubber:h-1.5 transition-all"
              style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
            />

            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.1}
              value={Math.min(currentTime, duration > 0 ? duration : 100)}
              onChange={handleSeekChange}
              disabled={!streamUrl}
              aria-label="Seek timeline"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />

            <div
              className="absolute w-3 h-3 rounded-full bg-white shadow-lg pointer-events-none transform -translate-x-1/2 scale-0 group-hover/scrubber:scale-100 transition-transform"
              style={{ left: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
            />
          </div>

          {/* Lower Controls Bar */}
          <div className="flex items-center justify-between text-white text-xs">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePlay}
                disabled={!streamUrl}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white disabled:opacity-40 transition-colors"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSeek(currentTime - 10)}
                disabled={!streamUrl}
                className="p-1 rounded-lg hover:bg-white/10 text-ink-muted hover:text-white disabled:opacity-40 transition-colors"
                title="Seek backward 10s (Left Arrow)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => handleSeek(currentTime + 10)}
                disabled={!streamUrl}
                className="p-1 rounded-lg hover:bg-white/10 text-ink-muted hover:text-white disabled:opacity-40 transition-colors"
                title="Seek forward 10s (Right Arrow)"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>

              <div className="font-mono text-[11px] text-ink-muted ml-1 tabular-nums">
                <span className="text-white font-medium">{formatTime(currentTime)}</span>
                <span className="mx-1 text-ink-dim">/</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="hidden sm:flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
                  title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeValue(parseFloat(e.target.value))}
                  aria-label="Volume"
                  className="w-16 h-1 bg-void-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                  title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
                />
              </div>

              {/* Speed Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSpeedMenu((s) => !s)}
                  className="px-2 py-1 rounded-lg hover:bg-white/10 text-xs font-mono font-medium text-white transition-colors flex items-center gap-1"
                  title="Playback Speed"
                >
                  <SlidersHorizontal className="w-3 h-3 text-violet-400" />
                  <span>{playbackRate}x</span>
                </button>

                {showSpeedMenu && (
                  <div className="absolute bottom-8 right-0 bg-void-900 border border-void-700 rounded-xl p-1 shadow-2xl flex flex-col gap-0.5 z-30 min-w-[70px]">
                    {SPEED_OPTIONS.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => handleSpeedChange(rate)}
                        className={`px-2.5 py-1 text-left text-xs font-mono rounded-lg transition-colors ${
                          playbackRate === rate
                            ? 'bg-violet-600 text-white font-bold'
                            : 'text-ink-muted hover:text-white hover:bg-void-800'
                        }`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {(subtitleUrl || subtitleCues.length > 0) && (
                <button
                  type="button"
                  onClick={() => setSubtitlesEnabled((s) => !s)}
                  title={subtitlesEnabled ? 'Subtitles ON (Press S)' : 'Subtitles OFF (Press S)'}
                  className={`px-2 py-1 rounded-lg hover:bg-white/10 text-xs font-mono font-medium transition-colors flex items-center gap-1 ${
                    subtitlesEnabled
                      ? 'text-pink-400 bg-pink-950/40 border border-pink-800/60'
                      : 'text-ink-muted'
                  }`}
                >
                  {subtitlesEnabled ? <Captions className="w-3.5 h-3.5" /> : <CaptionsOff className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">CC</span>
                </button>
              )}

              {streamUrl && !streamUrl.startsWith('/api/browse/stream-proxy') && (
                <button
                  type="button"
                  onClick={() => setUseStreamProxy((p) => !p)}
                  title={useStreamProxy ? 'Streaming via backend proxy' : 'Route stream through backend proxy (CORS bypass)'}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-mono transition-colors ${
                    useStreamProxy
                      ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                      : 'bg-void-900/80 border-void-700 text-ink-muted hover:text-white'
                  }`}
                >
                  <Shield className="w-3 h-3" />
                  <span>{useStreamProxy ? 'Proxy On' : 'Proxy'}</span>
                </button>
              )}

              {onResync && (
                <button
                  type="button"
                  onClick={onResync}
                  disabled={isResyncing}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-ink-muted hover:text-cyan-300 transition-colors disabled:opacity-50"
                  title="Manual Resync: align with authoritative server timestamp (Shift+R)"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isResyncing ? 'animate-spin text-cyan-400' : ''}`} />
                </button>
              )}

              {onToggleTheaterMode && (
                <button
                  type="button"
                  onClick={onToggleTheaterMode}
                  title={isTheaterMode ? 'Exit Theater Mode (T)' : 'Theater Mode (T)'}
                  className={`p-1.5 rounded-lg transition-colors ${
                    isTheaterMode
                      ? 'bg-violet-600/30 text-violet-300 border border-violet-500/40'
                      : 'hover:bg-white/10 text-ink-muted hover:text-white'
                  }`}
                >
                  <Tv className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {fullscreenDrawerNode}
      </div>
    );
  }
);

OnlineVideoPlayer.displayName = 'OnlineVideoPlayer';
