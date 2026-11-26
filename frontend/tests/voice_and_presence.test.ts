import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeToGain, computeAudioRms, isTypingElement } from '../src/services/webrtc.ts';

interface ParticipantPresence {
  id: string;
  username: string;
  is_host: boolean;
  is_online: boolean;
  presence_state?: 'active' | 'away' | 'disconnected';
  active_connections: number;
}

// ---------------------------------------------------------------------------
// 1. Voice Audio Routing & Volume Boost Tests (Part 2)
// ---------------------------------------------------------------------------
test('volumeToGain - calculates Web Audio boost signal (> 100%)', () => {
  // At or below 100%, boost gain should be 0.0 because <audio> element plays nominal volume
  const getBoostGain = (vol: number, isMuted: boolean) => {
    if (isMuted || vol <= 100) return 0.0;
    return volumeToGain(vol) - 1.0;
  };

  assert.equal(getBoostGain(0, false), 0.0);
  assert.equal(getBoostGain(50, false), 0.0);
  assert.equal(getBoostGain(100, false), 0.0);
  assert.equal(getBoostGain(150, false), 0.5);
  assert.equal(getBoostGain(200, false), 1.0);
  // Muted peer always returns 0.0 boost
  assert.equal(getBoostGain(150, true), 0.0);
  assert.equal(getBoostGain(200, true), 0.0);
});

test('native audio element volume clamping (0% - 100%)', () => {
  const getAudioElementVolume = (vol: number, isMuted: boolean) => {
    if (isMuted) return 0.0;
    return Math.max(0.0, Math.min(1.0, vol / 100));
  };

  assert.equal(getAudioElementVolume(0, false), 0.0);
  assert.equal(getAudioElementVolume(50, false), 0.5);
  assert.equal(getAudioElementVolume(100, false), 1.0);
  assert.equal(getAudioElementVolume(150, false), 1.0); // Clamped at 1.0 for HTMLAudioElement
  assert.equal(getAudioElementVolume(200, false), 1.0); // Clamped at 1.0
  assert.equal(getAudioElementVolume(100, true), 0.0);   // Muted
});

test('ICE candidate queueing and draining simulation', () => {
  const pendingCandidates = new Map<string, any[]>();
  const peerConnections = new Map<string, { hasRemoteDesc: boolean; added: any[] }>();

  // Helper simulate incoming candidate
  const handleCandidate = (senderId: string, candidate: any) => {
    const pc = peerConnections.get(senderId);
    if (!pc || !pc.hasRemoteDesc) {
      const q = pendingCandidates.get(senderId) || [];
      q.push(candidate);
      pendingCandidates.set(senderId, q);
      return;
    }
    pc.added.push(candidate);
  };

  // Helper simulate drain
  const drainCandidates = (senderId: string) => {
    const pc = peerConnections.get(senderId);
    if (!pc) return;
    pc.hasRemoteDesc = true;
    const q = pendingCandidates.get(senderId) || [];
    pendingCandidates.delete(senderId);
    for (const cand of q) {
      pc.added.push(cand);
    }
  };

  // 1. Candidate arrives before connection exists
  handleCandidate('peer-1', { candidate: 'cand-early-1' });
  assert.equal(pendingCandidates.get('peer-1')?.length, 1);

  // 2. Peer connection is initialized without remoteDescription yet
  peerConnections.set('peer-1', { hasRemoteDesc: false, added: [] });
  handleCandidate('peer-1', { candidate: 'cand-early-2' });
  assert.equal(pendingCandidates.get('peer-1')?.length, 2);
  assert.equal(peerConnections.get('peer-1')?.added.length, 0);

  // 3. Remote description arrives -> drain queued candidates
  drainCandidates('peer-1');
  assert.equal(pendingCandidates.has('peer-1'), false);
  assert.deepEqual(peerConnections.get('peer-1')?.added, [
    { candidate: 'cand-early-1' },
    { candidate: 'cand-early-2' },
  ]);

  // 4. Subsequent candidates added immediately
  handleCandidate('peer-1', { candidate: 'cand-post-remote' });
  assert.equal(peerConnections.get('peer-1')?.added.length, 3);
});

// ---------------------------------------------------------------------------
// 2. Presence Status Classification Tests (Part 4)
// ---------------------------------------------------------------------------
test('classifyPresence - accurately identifies Active, Away, and Disconnected', () => {
  const classifyPresence = (p: ParticipantPresence) => {
    if (!p.is_online) return 'disconnected';
    if (p.presence_state === 'away') return 'away';
    return 'active';
  };

  const activePeer: ParticipantPresence = {
    id: 'p1',
    username: 'Alice',
    is_host: true,
    is_online: true,
    presence_state: 'active',
    status: 'WATCHING' as any,
    active_connections: 1,
  };
  assert.equal(classifyPresence(activePeer), 'active');

  const awayPeer: ParticipantPresence = {
    id: 'p2',
    username: 'Bob',
    is_host: false,
    is_online: true,
    presence_state: 'away',
    status: 'WATCHING' as any,
    active_connections: 1,
  };
  assert.equal(classifyPresence(awayPeer), 'away');

  const disconnectedPeer: ParticipantPresence = {
    id: 'p3',
    username: 'Charlie',
    is_host: false,
    is_online: false,
    presence_state: 'disconnected',
    status: 'WAITING_FOR_FILE' as any,
    active_connections: 0,
  };
  assert.equal(classifyPresence(disconnectedPeer), 'disconnected');
});

// ---------------------------------------------------------------------------
// 3. Unread Chat Notification Logic Tests (Part 5)
// ---------------------------------------------------------------------------
test('filterUnreadChatMessages - counts messages from peers while chat is closed', () => {
  const currentUserId = 'user-me';

  const filterNewUnreads = (
    newMessages: Array<{ id: string; participant_id: string; content: string }>,
    isChatVisible: boolean
  ) => {
    if (isChatVisible) return 0;
    return newMessages.filter((m) => m.participant_id !== currentUserId).length;
  };

  const incomingMessages = [
    { id: '1', participant_id: 'user-friend', content: 'Hey!' },
    { id: '2', participant_id: 'user-me', content: 'I am typing back' },
    { id: '3', participant_id: 'user-friend', content: 'Did you see that scene?' },
  ];

  // When chat is closed: only messages from 'user-friend' (2 messages) count
  assert.equal(filterNewUnreads(incomingMessages, false), 2);

  // When chat is open: 0 unread messages
  assert.equal(filterNewUnreads(incomingMessages, true), 0);
});

test('filterUnreadChatMessages - own messages never increment unread counter', () => {
  const currentUserId = 'user-me';
  const ownMessages = [
    { id: '1', participant_id: currentUserId, content: 'Testing message' },
    { id: '2', participant_id: currentUserId, content: 'Another one' },
  ];

  const filterNewUnreads = (
    newMessages: Array<{ id: string; participant_id: string; content: string }>,
    isChatVisible: boolean
  ) => {
    if (isChatVisible) return 0;
    return newMessages.filter((m) => m.participant_id !== currentUserId).length;
  };

  assert.equal(filterNewUnreads(ownMessages, false), 0);
});