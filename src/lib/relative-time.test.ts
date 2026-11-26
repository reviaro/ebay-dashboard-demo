import { describe, expect, it } from 'vitest';
import { timeAgo } from './relative-time';

const now = new Date('2026-09-04T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('timeAgo', () => {
  it('returns null when there is no timestamp', () => {
    expect(timeAgo(null, now)).toBeNull();
  });

  it('reads as just now under a minute', () => {
    expect(timeAgo(ago(30_000), now)).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(timeAgo(ago(5 * 60_000), now)).toBe('5m ago');
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(timeAgo(ago(4 * 86_400_000), now)).toBe('4d ago');
  });

  // A sync scheduled weekly is expected to sit at six days old; rendering that
  // as "144h ago" makes a normal state look alarming.
  it('switches to days before the hours get absurd', () => {
    expect(timeAgo(ago(25 * 3_600_000), now)).toBe('1d ago');
  });

  // Clock skew between the server writing the row and the browser reading it
  // must not produce "-1m ago".
  it('does not render a future timestamp as negative', () => {
    expect(timeAgo(new Date(now.getTime() + 30_000).toISOString(), now)).toBe('just now');
  });
});
