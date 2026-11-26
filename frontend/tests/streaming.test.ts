import test from 'node:test';
import assert from 'node:assert/strict';

function detectStreamFormat(url: string): 'hls' | 'mp4' | 'webm' | 'unknown' {
  const clean = url.toLowerCase().split('?')[0].split('#')[0];
  if (clean.endsWith('.m3u8') || url.toLowerCase().includes('.m3u8')) return 'hls';
  if (clean.endsWith('.webm')) return 'webm';
  if (clean.endsWith('.mp4') || clean.endsWith('.m4v')) return 'mp4';
  return 'unknown';
}

function isValidHttpStreamUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

test('detectStreamFormat identifies HLS, MP4, WebM, and unknown', () => {
  assert.equal(detectStreamFormat('https://example.com/live/playlist.m3u8?token=abc'), 'hls');
  assert.equal(detectStreamFormat('https://example.com/video/episode1.mp4'), 'mp4');
  assert.equal(detectStreamFormat('https://example.com/video/episode1.webm'), 'webm');
  assert.equal(detectStreamFormat('https://example.com/stream/12345'), 'unknown');
});

test('isValidHttpStreamUrl accepts http/https and rejects dangerous schemes', () => {
  assert.equal(isValidHttpStreamUrl('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'), true);
  assert.equal(isValidHttpStreamUrl('http://localhost:8080/video.mp4'), true);
  assert.equal(isValidHttpStreamUrl('javascript:alert(1)'), false);
  assert.equal(isValidHttpStreamUrl('file:///Users/test/video.mp4'), false);
  assert.equal(isValidHttpStreamUrl(''), false);
});
