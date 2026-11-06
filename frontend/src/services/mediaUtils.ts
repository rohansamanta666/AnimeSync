/**
 * Media Dashboard Utilities — Phase 8 Task 8.6
 */

export function formatBytes(bytes: number, decimals = 1): string {
  if (isNaN(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, sizes.length - 1);
  const value = bytes / Math.pow(k, idx);
  return `${parseFloat(value.toFixed(dm))} ${sizes[idx]}`;
}

export function calculateStoragePercent(used: number, total: number): number {
  if (isNaN(used) || isNaN(total) || total <= 0 || used <= 0) return 0;
  const percent = (used / total) * 100;
  return Math.min(100, Math.max(0, parseFloat(percent.toFixed(1))));
}

export function formatEpisodeCode(season: number, episodeNumber: number): string {
  const s = Math.max(1, season || 1).toString().padStart(2, '0');
  const ep = Math.max(1, episodeNumber || 1).toString().padStart(2, '0');
  return `S${s}E${ep}`;
}

