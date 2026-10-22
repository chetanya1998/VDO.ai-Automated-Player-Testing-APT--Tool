export const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

export const formatDuration = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '—');

export const formatBox = (box) =>
  box ? `${Math.round(box.width)}×${Math.round(box.height)} at (${Math.round(box.x)}, ${Math.round(box.y)})` : '—';

export const runStatus = ({ errorCount, failCount }) => (errorCount ? 'error' : failCount ? 'fail' : 'pass');

export const formatScroll = (scroll) =>
  scroll ? `scroll ${Math.round(scroll.stepViewportRatio * 100)}% every ${scroll.intervalMs} ms` : null;

export function formatStarted(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

export function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  return minutes ? `${minutes}m ${String(total % 60).padStart(2, '0')}s` : `${total}s`;
}
