/**
 * useWebRTCVoice — Phase 7 Tasks 7.2 – 7.6
 *
 * Full WebRTC Voice Chat Hook:
 * - Google public STUN NAT traversal (zero cost)
 * - Mesh WebRTC signaling over Socket.IO (offers, answers, ICE candidates)
 * - Independent Audio Pipeline: Web Audio API GainNode for peer voice (0% – 200%)
 * - Local mute of peer without remote microphone muting
 * - Speaking detection via AnalyserNode RMS audio monitoring
 * - Push-to-Talk (PTT) with shortcut 'V', keyup safety & manual mute precedence
 * - Microphone device enumeration and selection
 * - Comprehensive permission and connection error handling
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import {
  VoiceMode,
  VoicePeer,
  VoiceOfferPayload,
  VoiceAnswerPayload,
  VoiceIceCandidatePayload,
  RoomAuth,
} from '../types';
import {
  RTC_CONFIG,
  getAudioConstraints,
  volumeToGain,
  computeAudioRms,
  isTypingElement,
} from '../services/webrtc';

export interface UseWebRTCVoiceProps {
  socket: Socket | null;
  auth: RoomAuth | null;
  roomCode?: string;
}

export function useWebRTCVoice({ socket, auth, roomCode }: UseWebRTCVoiceProps) {
  // Voice states
  const [isInVoice, setIsInVoice] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('activity');
  const [isPttActive, setIsPttActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [peerSpeakingMap, setPeerSpeakingMap] = useState<Record<string, boolean>>({});

  // Audio device & volume settings
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [peerVolume, setPeerVolume] = useState<number>(100); // 0% - 200%
  const [isPeerMutedLocally, setIsPeerMutedLocally] = useState<boolean>(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Peer metadata
  const [voicePeers, setVoicePeers] = useState<VoicePeer[]>([]);

  // References
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const peerGainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalysersRef = useRef<Map<string, AnalyserNode>>(new Map());
  const rmsIntervalRef = useRef<any>(null);

  // Keep latest mutable refs to avoid stale closures in event listeners
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  const voiceModeRef = useRef(voiceMode);
  voiceModeRef.current = voiceMode;

  const isPttActiveRef = useRef(isPttActive);
  isPttActiveRef.current = isPttActive;

  const peerVolumeRef = useRef(peerVolume);
  peerVolumeRef.current = peerVolume;

  const isPeerMutedLocallyRef = useRef(isPeerMutedLocally);
  isPeerMutedLocallyRef.current = isPeerMutedLocally;

  // 1. Enumerate available audio input devices
  const enumerateDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      setAudioDevices(audioInputs);
      if (audioInputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(audioInputs[0].deviceId);
      }
    } catch (err) {
      console.warn('Could not enumerate audio devices:', err);
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    enumerateDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', enumerateDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', enumerateDevices);
    };
  }, [enumerateDevices]);

  // 2. Ensure AudioContext is initialized (lazy initialization on user gesture)
  const getOrCreateAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  // 3. Connect remote stream to Web Audio API GainNode (0% - 200%) & AnalyserNode
  const routeRemoteAudio = useCallback(
    (socketId: string, participantId: string, stream: MediaStream) => {
      const ctx = getOrCreateAudioContext();
      try {
        const source = ctx.createMediaStreamSource(stream);

        // Independent GainNode for peer volume (Task 7.6)
        const gainNode = ctx.createGain();
        const currentGain = isPeerMutedLocallyRef.current
          ? 0.0
          : volumeToGain(peerVolumeRef.current);
        gainNode.gain.setValueAtTime(currentGain, ctx.currentTime);
        peerGainNodesRef.current.set(socketId, gainNode);

        // AnalyserNode for remote speaking detection (Task 7.4)
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        remoteAnalysersRef.current.set(participantId, analyser);

        // Connect graph: source -> analyser -> gainNode -> destination
        source.connect(analyser);
        analyser.connect(gainNode);
        gainNode.connect(ctx.destination);
      } catch (err) {
        console.warn('Failed to route remote audio through Web Audio pipeline:', err);
      }
    },
    [getOrCreateAudioContext]
  );

  // 4. Create an RTCPeerConnection for a target peer
  const createPeerConnection = useCallback(
    (targetSocketId: string, targetParticipantId: string) => {
      if (peerConnectionsRef.current.has(targetSocketId)) {
        return peerConnectionsRef.current.get(targetSocketId)!;
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionsRef.current.set(targetSocketId, pc);

      // Add local audio track if available
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // Relay ICE candidates to target peer over Socket.IO
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('voice_ice_candidate', {
            target_socket_id: targetSocketId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      // Handle receiving remote audio track
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          routeRemoteAudio(targetSocketId, targetParticipantId, event.streams[0]);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          peerConnectionsRef.current.delete(targetSocketId);
          peerGainNodesRef.current.delete(targetSocketId);
          remoteAnalysersRef.current.delete(targetParticipantId);
        }
      };

      return pc;
    },
    [socket, routeRemoteAudio]
  );

  // 5. Update local microphone track enabled state based on Mute and PTT rules
  const syncTrackEnabled = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (!audioTrack) return;

    if (isMutedRef.current) {
      // Manual mute always takes absolute precedence (Task 7.5)
      audioTrack.enabled = false;
    } else if (voiceModeRef.current === 'ptt') {
      // Push-to-Talk: only enabled while PTT is actively held down
      audioTrack.enabled = isPttActiveRef.current;
    } else {
      // Voice activity: enabled
      audioTrack.enabled = true;
    }
  }, []);

  // 6. Join Voice Channel
  const joinVoice = useCallback(async () => {
    if (!socket || !auth || !roomCode) return;
    setPermissionError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: getAudioConstraints(selectedDeviceId),
        video: false,
      });

      localStreamRef.current = stream;

      // Set up local speaking analyser
      const ctx = getOrCreateAudioContext();
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        localAnalyserRef.current = analyser;
      } catch (e) {
        console.warn('Could not connect local stream to analyser:', e);
      }

      // Initial track state: respect mode and mute
      syncTrackEnabled();

      // Emit voice_join to server
      socket.emit(
        'voice_join',
        { is_muted: isMutedRef.current },
        async (res: { status: string; peers?: VoicePeer[]; message?: string }) => {
          if (res && res.status === 'OK' && res.peers) {
            setIsInVoice(true);
            setVoicePeers(res.peers);

            // Initiate WebRTC offers to each existing peer in the room
            for (const peer of res.peers) {
              const pc = createPeerConnection(peer.socket_id, peer.participant_id);
              try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('voice_offer', {
                  target_socket_id: peer.socket_id,
                  sdp: offer,
                });
              } catch (err) {
                console.error(`Failed to create offer for peer ${peer.username}:`, err);
              }
            }
          } else {
            setPermissionError(res?.message || 'Failed to join voice channel');
          }
        }
      );
    } catch (err: any) {
      console.error('Microphone access failed:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermissionError(
          'Microphone permission was denied. Please allow microphone access in your browser settings to use voice chat.'
        );
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setPermissionError('No microphone was found on this device.');
      } else {
        setPermissionError(`Microphone error: ${err.message || 'Unable to access microphone'}`);
      }
    }
  }, [socket, auth, roomCode, selectedDeviceId, getOrCreateAudioContext, syncTrackEnabled, createPeerConnection]);

  // 7. Leave Voice Channel
  const leaveVoice = useCallback(() => {
    // Stop local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    // Close all peer connections
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    peerGainNodesRef.current.clear();
    remoteAnalysersRef.current.clear();
    localAnalyserRef.current = null;

    setIsInVoice(false);
    setIsSpeaking(false);
    setPeerSpeakingMap({});
    setVoicePeers([]);

    if (socket && socket.connected) {
      socket.emit('voice_leave', {});
    }
  }, [socket]);

  // 8. Push-to-Talk (PTT) Keyboard Event Handlers (Task 7.5)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingElement(e.target)) return;
      if (e.code === 'KeyV' && !e.repeat && voiceModeRef.current === 'ptt') {
        setIsPttActive(true);
        isPttActiveRef.current = true;
        syncTrackEnabled();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isTypingElement(e.target)) return;
      if (e.code === 'KeyV' && voiceModeRef.current === 'ptt') {
        setIsPttActive(false);
        isPttActiveRef.current = false;
        syncTrackEnabled();
      }
    };

    // Keyup safety: window blur or tab visibility change immediately releases PTT
    const handleSafetyRelease = () => {
      if (isPttActiveRef.current) {
        setIsPttActive(false);
        isPttActiveRef.current = false;
        syncTrackEnabled();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleSafetyRelease);
    document.addEventListener('visibilitychange', handleSafetyRelease);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleSafetyRelease);
      document.removeEventListener('visibilitychange', handleSafetyRelease);
    };
  }, [syncTrackEnabled]);

  // 9. Speaking detection RMS polling loop (Task 7.4)
  useEffect(() => {
    const RMS_THRESHOLD = 0.02; // Threshold for active voice
    const dataArray = new Uint8Array(128);

    rmsIntervalRef.current = setInterval(() => {
      // Local speaking detection
      if (localAnalyserRef.current && !isMutedRef.current && localStreamRef.current?.getAudioTracks()[0]?.enabled) {
        localAnalyserRef.current.getByteTimeDomainData(dataArray);
        const rms = computeAudioRms(dataArray);
        setIsSpeaking(rms > RMS_THRESHOLD);
      } else {
        setIsSpeaking(false);
      }

      // Remote peers speaking detection
      if (remoteAnalysersRef.current.size > 0) {
        const updatedMap: Record<string, boolean> = {};
        remoteAnalysersRef.current.forEach((analyser, pid) => {
          analyser.getByteTimeDomainData(dataArray);
          const rms = computeAudioRms(dataArray);
          updatedMap[pid] = rms > RMS_THRESHOLD;
        });
        setPeerSpeakingMap(updatedMap);
      }
    }, 100);

    return () => {
      if (rmsIntervalRef.current) {
        clearInterval(rmsIntervalRef.current);
      }
    };
  }, []);

  // 10. Update Peer Voice Volume (0% - 200%) via Web Audio GainNode (Task 7.6)
  useEffect(() => {
    peerVolumeRef.current = peerVolume;
    isPeerMutedLocallyRef.current = isPeerMutedLocally;

    const ctx = audioContextRef.current;
    if (!ctx) return;

    const targetGain = isPeerMutedLocally ? 0.0 : volumeToGain(peerVolume);
    peerGainNodesRef.current.forEach((gainNode) => {
      try {
        gainNode.gain.setValueAtTime(targetGain, ctx.currentTime);
      } catch (e) {
        console.warn('Could not set gain value:', e);
      }
    });
  }, [peerVolume, isPeerMutedLocally]);

  // 11. Toggle Mute
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      syncTrackEnabled();
      if (socket && isInVoice) {
        socket.emit('voice_mute_toggle', { is_muted: next });
      }
      return next;
    });
  }, [socket, isInVoice, syncTrackEnabled]);

  // 12. Switch Voice Mode (Voice Activity vs PTT)
  const setVoiceModeHandler = useCallback(
    (mode: VoiceMode) => {
      setVoiceMode(mode);
      voiceModeRef.current = mode;
      setIsPttActive(false);
      isPttActiveRef.current = false;
      syncTrackEnabled();
    },
    [syncTrackEnabled]
  );

  // 13. Socket.IO Signaling Event Listeners (Task 7.2)
  useEffect(() => {
    if (!socket) return;

    // A remote peer joined voice
    const handleVoicePeerJoined = (peer: VoicePeer) => {
      setVoicePeers((prev) => {
        if (prev.some((p) => p.participant_id === peer.participant_id)) {
          return prev.map((p) => (p.participant_id === peer.participant_id ? peer : p));
        }
        return [...prev, peer];
      });
    };

    // A remote peer left voice
    const handleVoicePeerLeft = (data: { participant_id: string; socket_id: string }) => {
      setVoicePeers((prev) => prev.filter((p) => p.participant_id !== data.participant_id));
      const pc = peerConnectionsRef.current.get(data.socket_id);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(data.socket_id);
      }
      peerGainNodesRef.current.delete(data.socket_id);
      remoteAnalysersRef.current.delete(data.participant_id);
    };

    // Received WebRTC Offer
    const handleVoiceOffer = async (payload: VoiceOfferPayload) => {
      const pc = createPeerConnection(payload.sender_socket_id, payload.sender_participant_id);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('voice_answer', {
          target_socket_id: payload.sender_socket_id,
          sdp: answer,
        });
      } catch (err) {
        console.error('Failed to handle incoming WebRTC offer:', err);
      }
    };

    // Received WebRTC Answer
    const handleVoiceAnswer = async (payload: VoiceAnswerPayload) => {
      const pc = peerConnectionsRef.current.get(payload.sender_socket_id);
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        } catch (err) {
          console.error('Failed to handle incoming WebRTC answer:', err);
        }
      }
    };

    // Received WebRTC ICE Candidate
    const handleVoiceIceCandidate = async (payload: VoiceIceCandidatePayload) => {
      const pc = peerConnectionsRef.current.get(payload.sender_socket_id);
      if (pc && payload.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (err) {
          console.warn('Could not add ICE candidate:', err);
        }
      }
    };

    // Remote peer mute toggle
    const handleVoicePeerMuteChanged = (data: { participant_id: string; is_muted: boolean }) => {
      setVoicePeers((prev) =>
        prev.map((p) => (p.participant_id === data.participant_id ? { ...p, is_muted: data.is_muted } : p))
      );
    };

    socket.on('voice_peer_joined', handleVoicePeerJoined);
    socket.on('voice_peer_left', handleVoicePeerLeft);
    socket.on('voice_offer', handleVoiceOffer);
    socket.on('voice_answer', handleVoiceAnswer);
    socket.on('voice_ice_candidate', handleVoiceIceCandidate);
    socket.on('voice_peer_mute_changed', handleVoicePeerMuteChanged);

    return () => {
      socket.off('voice_peer_joined', handleVoicePeerJoined);
      socket.off('voice_peer_left', handleVoicePeerLeft);
      socket.off('voice_offer', handleVoiceOffer);
      socket.off('voice_answer', handleVoiceAnswer);
      socket.off('voice_ice_candidate', handleVoiceIceCandidate);
      socket.off('voice_peer_mute_changed', handleVoicePeerMuteChanged);
    };
  }, [socket, createPeerConnection]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      leaveVoice();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [leaveVoice]);

  return {
    isInVoice,
    isMuted,
    voiceMode,
    isPttActive,
    isSpeaking,
    peerSpeakingMap,
    voicePeers,
    audioDevices,
    selectedDeviceId,
    setSelectedDeviceId,
    peerVolume,
    setPeerVolume,
    isPeerMutedLocally,
    setIsPeerMutedLocally,
    permissionError,
    clearPermissionError: () => setPermissionError(null),
    joinVoice,
    leaveVoice,
    toggleMute,
    setVoiceMode: setVoiceModeHandler,
  };
}
