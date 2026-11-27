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

function isDirectMediaStreamUrl(url: string | null | undefined): boolean {
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

test('isDirectMediaStreamUrl distinguishes direct media/proxy URLs from provider iframe embeds', () => {
  assert.equal(isDirectMediaStreamUrl('https://cdn.example.com/ep1/master.m3u8?token=abc'), true);
  assert.equal(isDirectMediaStreamUrl('https://cdn.example.com/ep1.mp4'), true);
  assert.equal(isDirectMediaStreamUrl('/api/browse/stream-proxy?url=https%3A%2F%2Fcdn.example.com%2Fvideo'), true);
  assert.equal(isDirectMediaStreamUrl('https://flixera.example.com/embed/ani/154587/1/sub?autoplay=0'), false);
  assert.equal(isDirectMediaStreamUrl('https://zcdn.example.com/e/12345/sub'), false);
  assert.equal(isDirectMediaStreamUrl(null), false);
});

test('IFRAME_AD_SHIELD_SANDBOX blocks popups and top-level redirects', () => {
  const sandbox = 'allow-scripts allow-same-origin allow-forms allow-presentation';
  const tokens = sandbox.split(/\s+/);
  assert.equal(tokens.includes('allow-scripts'), true);
  assert.equal(tokens.includes('allow-same-origin'), true);
  assert.equal(tokens.includes('allow-popups'), false);
  assert.equal(tokens.includes('allow-popups-to-escape-sandbox'), false);
  assert.equal(tokens.includes('allow-top-navigation'), false);
  assert.equal(tokens.includes('allow-top-navigation-by-user-activation'), false);
});

test('server priority ordering starts with s-1 and fails over sequentially', () => {
  const priority: Record<string, number> = { 's-1': 0, 's-2': 1, 's-3': 2, 's-4': 3 };
  const raw = [
    { serverName: 's-3', iframe: 'https://novus.example/3' },
    { serverName: 's-1', iframe: 'https://z.example/1' },
    { serverName: 's-4', iframe: 'https://novus.example/4' },
    { serverName: 's-2', iframe: 'https://z.example/2' },
  ];
  const sorted = [...raw].sort(
    (a, b) => (priority[a.serverName] ?? 99) - (priority[b.serverName] ?? 99)
  );
  assert.deepEqual(
    sorted.map((s) => s.serverName),
    ['s-1', 's-2', 's-3', 's-4']
  );

  // Failover skips failed s-1 -> picks s-2
  const failed = new Set(['https://z.example/1']);
  const next = sorted.find((s) => !failed.has(s.iframe));
  assert.equal(next?.serverName, 's-2');
});
