import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RTC_CONFIG,
  getAudioConstraints,
  volumeToGain,
  computeAudioRms,
  isTypingElement,
  sanitizeChatMessage,
} from '../src/services/webrtc.ts';

// ---------------------------------------------------------------------------
// 1. STUN & Audio Constraints Configuration
// ---------------------------------------------------------------------------
test('RTC_CONFIG - uses free public Google STUN servers', () => {
  assert.ok(RTC_CONFIG.iceServers && RTC_CONFIG.iceServers.length > 0);
  const stunUrls = RTC_CONFIG.iceServers.flatMap((s) =>
    Array.isArray(s.urls) ? s.urls : [s.urls]
  );
  assert.ok(stunUrls.some((u) => u.includes('stun.l.google.com:19302')));
});

test('getAudioConstraints - default constraints configure echo cancellation and AGC', () => {
  const constraints = getAudioConstraints();
  assert.equal(constraints.echoCancellation, true);
  assert.equal(constraints.noiseSuppression, true);
  assert.equal(constraints.autoGainControl, true);
  assert.equal(constraints.deviceId, undefined);
});

test('getAudioConstraints - specific deviceId sets exact constraint', () => {
  const constraints = getAudioConstraints('mic-device-123');
  assert.deepEqual(constraints.deviceId, { exact: 'mic-device-123' });
});

// ---------------------------------------------------------------------------
// 2. Volume to GainNode Mapping (0% - 200%)
// ---------------------------------------------------------------------------
test('volumeToGain - maps 0% to 0.0 (mute)', () => {
  assert.equal(volumeToGain(0), 0.0);
  assert.equal(volumeToGain(-10), 0.0);
});

test('volumeToGain - maps 100% to 1.0 (standard unity gain)', () => {
  assert.equal(volumeToGain(100), 1.0);
});

test('volumeToGain - maps 200% to 2.0 (maximum voice boost)', () => {
  assert.equal(volumeToGain(200), 2.0);
  assert.equal(volumeToGain(250), 2.0);
});

test('volumeToGain - handles intermediate volume percentages correctly', () => {
  assert.equal(volumeToGain(50), 0.5);
  assert.equal(volumeToGain(125), 1.25);
  assert.equal(volumeToGain(175), 1.75);
});

test('volumeToGain - handles NaN and invalid inputs gracefully', () => {
  assert.equal(volumeToGain(NaN), 0.0);
});

// ---------------------------------------------------------------------------
// 3. Audio RMS Speaking Detection
// ---------------------------------------------------------------------------
test('computeAudioRms - returns 0 for empty array', () => {
  assert.equal(computeAudioRms(new Uint8Array(0)), 0);
});

test('computeAudioRms - returns 0.0 for pure silence (all 128 bias)', () => {
  const silence = new Uint8Array([128, 128, 128, 128]);
  assert.equal(computeAudioRms(silence), 0);
});

test('computeAudioRms - computes amplitude for active audio waveforms', () => {
  // Peak waveform oscillating between 0 and 255
  const peak = new Uint8Array([255, 0, 255, 0]);
  const rms = computeAudioRms(peak);
  assert.ok(rms > 0.9 && rms <= 1.0);
});

// ---------------------------------------------------------------------------
// 4. Typing Element Detection (PTT Safety)
// ---------------------------------------------------------------------------
test('isTypingElement - returns false for null target', () => {
  assert.equal(isTypingElement(null), false);
});

test('isTypingElement - returns true for input and textarea tags', () => {
  assert.equal(isTypingElement({ tagName: 'INPUT' } as any), true);
  assert.equal(isTypingElement({ tagName: 'textarea' } as any), true);
  assert.equal(isTypingElement({ tagName: 'SELECT' } as any), true);
});

test('isTypingElement - returns true for contentEditable elements', () => {
  assert.equal(isTypingElement({ tagName: 'div', isContentEditable: true } as any), true);
});

test('isTypingElement - returns false for non-input elements', () => {
  assert.equal(isTypingElement({ tagName: 'div', isContentEditable: false } as any), false);
  assert.equal(isTypingElement({ tagName: 'button' } as any), false);
  assert.equal(isTypingElement({ tagName: 'BODY' } as any), false);
});

// ---------------------------------------------------------------------------
// 5. Chat Sanitization
// ---------------------------------------------------------------------------
test('sanitizeChatMessage - strips HTML tags', () => {
  const result = sanitizeChatMessage('<script>alert("xss")</script>Hello <b>World</b>');
  assert.equal(result, 'alert("xss")Hello World');
});

test('sanitizeChatMessage - removes null bytes and trims whitespace', () => {
  const result = sanitizeChatMessage('   hello\0world   ');
  assert.equal(result, 'helloworld');
});

test('sanitizeChatMessage - handles empty or blank inputs', () => {
  assert.equal(sanitizeChatMessage(''), '');
  assert.equal(sanitizeChatMessage('    '), '');
});
