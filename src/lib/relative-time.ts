/**
 * Coarse "how long ago" for freshness indicators.
 *
 * Shared so `/orders` and `/settings` phrase the same timestamp identically --
 * two components disagreeing about how old the data is would be worse than
 * either wording alone.
 */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;

  // Never negative: the server writes the row, the browser renders it, and the
  // two clocks need not agree.
  // Floored, so anything under a minute reads "just now" rather than "1m ago".
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}
