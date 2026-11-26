import test from 'node:test';
import assert from 'node:assert/strict';

function detectMediaFormat(url: string): 'hls' | 'mp4' | 'webm' | 'unknown' {
  const clean = url.toLowerCase().split('?')[0].split('#')[0];
  if (clean.endsWith('.m3u8') || url.toLowerCase().includes('.m3u8')) return 'hls';
  if (clean.endsWith('.webm')) return 'webm';
  if (clean.endsWith('.mp4') || clean.endsWith('.m4v')) return 'mp4';
  return 'unknown';
}

function isDownloadableFormat(format: string): boolean {
  return format === 'mp4' || format === 'webm';
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

test('detectMediaFormat identifies HLS, MP4, WebM, and unknown', () => {
  assert.equal(detectMediaFormat('https://cdn.example.com/playlist.m3u8?token=xyz'), 'hls');
  assert.equal(detectMediaFormat('https://cdn.example.com/ep1.mp4'), 'mp4');
  assert.equal(detectMediaFormat('https://cdn.example.com/ep1.webm'), 'webm');
  assert.equal(detectMediaFormat('https://cdn.example.com/stream'), 'unknown');
});

test('isDownloadableFormat allows MP4/WebM and rejects HLS', () => {
  assert.equal(isDownloadableFormat('mp4'), true);
  assert.equal(isDownloadableFormat('webm'), true);
  assert.equal(isDownloadableFormat('hls'), false);
});

test('isSafeHttpUrl accepts http/https and blocks dangerous schemes', () => {
  assert.equal(isSafeHttpUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('file:///etc/passwd'), false);
  assert.equal(isSafeHttpUrl(''), false);
});
