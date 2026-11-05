import test from 'node:test';
import assert from 'node:assert/strict';
import {
  determineSyncStatus,
  computePingLatency,
  calculateResyncTarget,
  type AuthoritativePlaybackSnapshot,
} from '../src/services/drift.ts';

test('determineSyncStatus - returns BUFFERING when room is buffering', () => {
  const status = determineSyncStatus({
    isRoomBuffering: true,
    isLocalBuffering: false,
    isNudging: false,
    isPaused: false,
    driftSeconds: 0,
  });
  assert.equal(status, 'BUFFERING');
});

test('determineSyncStatus - returns BUFFERING when local is buffering', () => {
  const status = determineSyncStatus({
    isRoomBuffering: false,
    isLocalBuffering: true,
    isNudging: false,
    isPaused: false,
    driftSeconds: 0,
  });
  assert.equal(status, 'BUFFERING');
});

test('determineSyncStatus - returns NUDGING when active speed nudge is running', () => {
  const status = determineSyncStatus({
    isRoomBuffering: false,
    isLocalBuffering: false,
    isNudging: true,
    isPaused: false,
    driftSeconds: 0.5,
  });
  assert.equal(status, 'NUDGING');
});

test('determineSyncStatus - returns PAUSED when video is paused and not buffering or nudging', () => {
  const status = determineSyncStatus({
    isRoomBuffering: false,
    isLocalBuffering: false,
    isNudging: false,
    isPaused: true,
    driftSeconds: 0.05,
  });
  assert.equal(status, 'PAUSED');
});

test('determineSyncStatus - returns SYNCED when playing normally with low drift', () => {
  const status = determineSyncStatus({
    isRoomBuffering: false,
    isLocalBuffering: false,
    isNudging: false,
    isPaused: false,
    driftSeconds: 0.05,
  });
  assert.equal(status, 'SYNCED');
});

test('computePingLatency - calculates round-trip time in milliseconds', () => {
  const send = 1730000000000;
  const receive = 1730000000042;
  const latency = computePingLatency(send, receive);
  assert.equal(latency, 42);
});

test('computePingLatency - clamps negative drift to 0', () => {
  const send = 1730000000100;
  const receive = 1730000000050; // clock skew edge case
  const latency = computePingLatency(send, receive);
  assert.equal(latency, 0);
});

test('calculateResyncTarget - playing state advances position accurately', () => {
  const snapshot: AuthoritativePlaybackSnapshot = {
    isPlaying: true,
    currentTime: 10.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  const target = calculateResyncTarget(snapshot, 1005);
  assert.equal(target.targetTime, 15.0);
  assert.equal(target.targetRate, 1.0);
  assert.equal(target.isPlaying, true);
});

test('calculateResyncTarget - playing state with custom speed (1.5x)', () => {
  const snapshot: AuthoritativePlaybackSnapshot = {
    isPlaying: true,
    currentTime: 20.0,
    playbackSpeed: 1.5,
    updatedAt: 1000,
  };
  // 4s elapsed * 1.5 = 6s advanced -> 26.0s
  const target = calculateResyncTarget(snapshot, 1004);
  assert.equal(target.targetTime, 26.0);
  assert.equal(target.targetRate, 1.5);
  assert.equal(target.isPlaying, true);
});

test('calculateResyncTarget - paused state preserves static position', () => {
  const snapshot: AuthoritativePlaybackSnapshot = {
    isPlaying: false,
    currentTime: 45.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  const target = calculateResyncTarget(snapshot, 1050);
  assert.equal(target.targetTime, 45.0);
  assert.equal(target.targetRate, 1.0);
  assert.equal(target.isPlaying, false);
});
