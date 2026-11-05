import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAuthoritativeTime,
  computeDrift,
  evaluateDriftCorrection,
  DRIFT_TOLERANCE_SECONDS,
  DRIFT_HARD_SEEK_SECONDS,
} from '../src/services/drift.ts';

test('computeAuthoritativeTime - paused playback returns static currentTime', () => {
  const snapshot = {
    isPlaying: false,
    currentTime: 42.5,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  const result = computeAuthoritativeTime(snapshot, 1050);
  assert.equal(result, 42.5);
});

test('computeAuthoritativeTime - active playback advances position at 1.0x speed', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 10.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  // 5 seconds elapsed
  const result = computeAuthoritativeTime(snapshot, 1005);
  assert.equal(result, 15.0);
});

test('computeAuthoritativeTime - active playback advances position at 1.5x speed', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 20.0,
    playbackSpeed: 1.5,
    updatedAt: 1000,
  };
  // 4 seconds elapsed -> 4 * 1.5 = 6.0 seconds advanced
  const result = computeAuthoritativeTime(snapshot, 1004);
  assert.equal(result, 26.0);
});

test('computeAuthoritativeTime - handles localReceivedAt timestamp correctly', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 5.0,
    playbackSpeed: 1.0,
    updatedAt: 9999, // server time difference ignored
    localReceivedAt: 2000000, // 2000.0s in ms
  };
  // 3 seconds elapsed locally
  const result = computeAuthoritativeTime(snapshot, 2003);
  assert.equal(result, 8.0);
});

test('computeDrift - returns negative when local player is behind', () => {
  const drift = computeDrift(10.0, 10.8);
  assert.ok(Math.abs(drift - -0.8) < 1e-6);
});

test('computeDrift - returns positive when local player is ahead', () => {
  const drift = computeDrift(11.2, 10.5);
  assert.ok(Math.abs(drift - 0.7) < 1e-6);
});

test('computeDrift - returns zero when in perfect sync', () => {
  const drift = computeDrift(15.0, 15.0);
  assert.equal(drift, 0);
});

test('evaluateDriftCorrection - null snapshot returns NONE', () => {
  const res = evaluateDriftCorrection({
    snapshot: null,
    localTime: 12.0,
    intendedRate: 1.0,
    isLocalPaused: false,
    isNudging: false,
  });
  assert.equal(res.action, 'NONE');
  assert.equal(res.driftSeconds, 0);
});

test('evaluateDriftCorrection - paused locally returns NONE and no rate adjustment', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 10.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 8.0, // Behind by 4s, but paused locally
    nowSeconds: 1002,
    intendedRate: 1.0,
    isLocalPaused: true,
    isNudging: false,
  });
  assert.equal(res.action, 'NONE');
});

test('evaluateDriftCorrection - paused locally while nudging restores intended rate', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 10.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 10.0,
    nowSeconds: 1000,
    intendedRate: 1.25,
    isLocalPaused: true,
    isNudging: true,
  });
  assert.equal(res.action, 'RESTORE_RATE');
  assert.equal(res.targetRate, 1.25);
});

test('evaluateDriftCorrection - server paused while nudging restores intended rate', () => {
  const snapshot = {
    isPlaying: false,
    currentTime: 30.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 30.0,
    nowSeconds: 1005,
    intendedRate: 1.0,
    isLocalPaused: false,
    isNudging: true,
  });
  assert.equal(res.action, 'RESTORE_RATE');
  assert.equal(res.targetRate, 1.0);
});

test('evaluateDriftCorrection - drift below 0.25s tolerance returns NONE when not nudging', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 10.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  // authTime = 10.0 + 2.0 = 12.0s. localTime = 12.15s (drift = +0.15s < 0.25s)
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 12.15,
    nowSeconds: 1002,
    intendedRate: 1.0,
    isLocalPaused: false,
    isNudging: false,
  });
  assert.equal(res.action, 'NONE');
  assert.ok(Math.abs(res.driftSeconds - 0.15) < 1e-4);
});

test('evaluateDriftCorrection - drift below 0.25s tolerance restores rate if previously nudging', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 10.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  // authTime = 12.0s, localTime = 12.05s (drift = +0.05s)
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 12.05,
    nowSeconds: 1002,
    intendedRate: 1.0,
    isLocalPaused: false,
    isNudging: true,
  });
  assert.equal(res.action, 'RESTORE_RATE');
  assert.equal(res.targetRate, 1.0);
});

test('evaluateDriftCorrection - micro-drift behind (0.25s <= |drift| < 1.5s) nudges faster (+5%)', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 20.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  // authTime = 20.0 + 5.0 = 25.0s. localTime = 24.4s (drift = -0.6s)
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 24.4,
    nowSeconds: 1005,
    intendedRate: 1.0,
    isLocalPaused: false,
    isNudging: false,
  });
  assert.equal(res.action, 'NUDGE_FASTER');
  assert.equal(res.targetRate, 1.05);
  assert.ok(Math.abs(res.driftSeconds - -0.6) < 1e-4);
});

test('evaluateDriftCorrection - micro-drift ahead (0.25s <= |drift| < 1.5s) nudges slower (-5%)', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 20.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  // authTime = 25.0s. localTime = 25.8s (drift = +0.8s)
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 25.8,
    nowSeconds: 1005,
    intendedRate: 1.0,
    isLocalPaused: false,
    isNudging: false,
  });
  assert.equal(res.action, 'NUDGE_SLOWER');
  assert.equal(res.targetRate, 0.95);
  assert.ok(Math.abs(res.driftSeconds - 0.8) < 1e-4);
});

test('evaluateDriftCorrection - micro-drift with custom intended playback rate (1.5x)', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 10.0,
    playbackSpeed: 1.5,
    updatedAt: 1000,
  };
  // authTime = 10.0 + (2.0 * 1.5) = 13.0s. localTime = 12.4s (drift = -0.6s)
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 12.4,
    nowSeconds: 1002,
    intendedRate: 1.5,
    isLocalPaused: false,
    isNudging: false,
  });
  assert.equal(res.action, 'NUDGE_FASTER');
  // 1.5 * 1.05 = 1.575
  assert.equal(res.targetRate, 1.575);
});

test('evaluateDriftCorrection - macro-drift behind (>= 1.5s) triggers HARD_SEEK', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 50.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  // authTime = 50.0 + 10.0 = 60.0s. localTime = 58.0s (drift = -2.0s)
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 58.0,
    nowSeconds: 1010,
    intendedRate: 1.0,
    isLocalPaused: false,
    isNudging: true,
  });
  assert.equal(res.action, 'HARD_SEEK');
  assert.equal(res.targetTime, 60.0);
  assert.equal(res.targetRate, 1.0);
});

test('evaluateDriftCorrection - macro-drift ahead (>= 1.5s) triggers HARD_SEEK', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 50.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  // authTime = 60.0s. localTime = 62.5s (drift = +2.5s)
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 62.5,
    nowSeconds: 1010,
    intendedRate: 1.25,
    isLocalPaused: false,
    isNudging: false,
  });
  assert.equal(res.action, 'HARD_SEEK');
  assert.equal(res.targetTime, 60.0);
  assert.equal(res.targetRate, 1.25);
});

test('evaluateDriftCorrection - exact threshold boundary 0.25s triggers micro-adjustment', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 10.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  // drift = exact -0.25s
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 9.75,
    nowSeconds: 1000,
    intendedRate: 1.0,
    isLocalPaused: false,
    isNudging: false,
  });
  assert.equal(res.action, 'NUDGE_FASTER');
});

test('evaluateDriftCorrection - exact threshold boundary 1.5s triggers HARD_SEEK', () => {
  const snapshot = {
    isPlaying: true,
    currentTime: 10.0,
    playbackSpeed: 1.0,
    updatedAt: 1000,
  };
  // drift = exact +1.5s
  const res = evaluateDriftCorrection({
    snapshot,
    localTime: 11.5,
    nowSeconds: 1000,
    intendedRate: 1.0,
    isLocalPaused: false,
    isNudging: false,
  });
  assert.equal(res.action, 'HARD_SEEK');
  assert.equal(res.targetTime, 10.0);
});
