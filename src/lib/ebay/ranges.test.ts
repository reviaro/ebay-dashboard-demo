import { describe, it, expect } from 'vitest';
import {
  utcDay,
  daysInRange,
  chunkRange,
  clampToRetention,
  DOMAIN_WINDOWS,
  InvalidRangeError,
} from './ranges';

const day = (iso: string) => utcDay(new Date(`${iso}T00:00:00Z`));
const range = (from: string, to: string) => ({ from: day(from), to: day(to) });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const show = (chunks: { from: Date; to: Date }[]) =>
  chunks.map((c) => `${iso(c.from)}..${iso(c.to)}`);

describe('utcDay', () => {
  it('truncates a timestamp to UTC midnight', () => {
    expect(utcDay(new Date('2026-03-15T23:59:59.999Z')).toISOString()).toBe(
      '2026-03-15T00:00:00.000Z'
    );
  });

  it('uses UTC, not local time, so DST cannot shift a window', () => {
    // 2026-03-08 is a US DST transition; a local-time implementation drifts here.
    expect(utcDay(new Date('2026-03-08T04:30:00Z')).toISOString()).toBe(
      '2026-03-08T00:00:00.000Z'
    );
  });
});

describe('daysInRange', () => {
  it('counts a single day as 1, since ranges are inclusive of both ends', () => {
    expect(daysInRange(range('2026-01-01', '2026-01-01'))).toBe(1);
  });

  it('counts a full week as 7', () => {
    expect(daysInRange(range('2026-01-01', '2026-01-07'))).toBe(7);
  });

  it('counts across a leap day', () => {
    expect(daysInRange(range('2028-02-28', '2028-03-01'))).toBe(3);
  });
});

describe('chunkRange', () => {
  it('returns one chunk when the range fits the limit exactly', () => {
    expect(show(chunkRange(range('2026-01-01', '2026-01-07'), 7))).toEqual([
      '2026-01-01..2026-01-07',
    ]);
  });

  it('returns one chunk when the range is shorter than the limit', () => {
    expect(show(chunkRange(range('2026-01-01', '2026-01-03'), 7))).toEqual([
      '2026-01-01..2026-01-03',
    ]);
  });

  it('splits an exact multiple into equal chunks with no gap or overlap', () => {
    expect(show(chunkRange(range('2026-01-01', '2026-01-06'), 3))).toEqual([
      '2026-01-01..2026-01-03',
      '2026-01-04..2026-01-06',
    ]);
  });

  it('puts the short remainder in the final chunk', () => {
    expect(show(chunkRange(range('2026-01-01', '2026-01-07'), 3))).toEqual([
      '2026-01-01..2026-01-03',
      '2026-01-04..2026-01-06',
      '2026-01-07..2026-01-07',
    ]);
  });

  it('covers the requested range exactly, losing no day', () => {
    const requested = range('2026-01-01', '2026-06-30');
    const chunks = chunkRange(requested, 7);
    expect(chunks[0].from.getTime()).toBe(requested.from.getTime());
    expect(chunks[chunks.length - 1].to.getTime()).toBe(requested.to.getTime());
    const covered = chunks.reduce((sum, c) => sum + daysInRange(c), 0);
    expect(covered).toBe(daysInRange(requested));
  });

  it('produces contiguous chunks with no overlapping day', () => {
    const chunks = chunkRange(range('2026-01-01', '2026-04-15'), 30);
    for (let i = 1; i < chunks.length; i++) {
      const gap =
        chunks[i].from.getTime() - chunks[i - 1].to.getTime();
      expect(gap).toBe(86_400_000); // exactly one day, so no gap and no overlap
    }
  });

  it('orders oldest-first by default, for historical backfill', () => {
    const chunks = chunkRange(range('2026-01-01', '2026-01-09'), 3);
    expect(show(chunks)[0]).toBe('2026-01-01..2026-01-03');
  });

  it('orders newest-first on request, for user-triggered refresh', () => {
    const chunks = chunkRange(range('2026-01-01', '2026-01-09'), 3, 'newest-first');
    expect(show(chunks)).toEqual([
      '2026-01-07..2026-01-09',
      '2026-01-04..2026-01-06',
      '2026-01-01..2026-01-03',
    ]);
  });

  it('keeps the same day boundaries regardless of ordering', () => {
    const oldest = show(chunkRange(range('2026-01-01', '2026-01-08'), 3));
    const newest = show(
      chunkRange(range('2026-01-01', '2026-01-08'), 3, 'newest-first')
    );
    expect([...newest].reverse()).toEqual(oldest);
  });

  it('rejects an inverted range instead of returning zero chunks', () => {
    expect(() => chunkRange(range('2026-02-01', '2026-01-01'), 7)).toThrow(
      InvalidRangeError
    );
  });

  it('rejects a non-positive chunk size instead of looping forever', () => {
    expect(() => chunkRange(range('2026-01-01', '2026-01-07'), 0)).toThrow(
      InvalidRangeError
    );
  });
});

describe('clampToRetention', () => {
  const now = new Date('2026-09-02T12:00:00Z');

  it('leaves a range fully inside retention untouched', () => {
    const result = clampToRetention(range('2026-08-01', '2026-08-31'), {
      maxAgeDays: 90,
      now,
    });
    expect(result.clamped).toBe(false);
    expect(result.excluded).toBeNull();
    expect(show([result.effective!])).toEqual(['2026-08-01..2026-08-31']);
  });

  it('reports the excluded portion rather than silently shortening', () => {
    // 90-day order discovery boundary from 2026-09-02 is 2026-06-05.
    const result = clampToRetention(range('2026-01-01', '2026-08-31'), {
      maxAgeDays: 90,
      now,
    });
    expect(result.clamped).toBe(true);
    expect(show([result.effective!])).toEqual(['2026-06-05..2026-08-31']);
    expect(show([result.excluded!])).toEqual(['2026-01-01..2026-06-04']);
  });

  it('returns no effective range when the request is entirely too old', () => {
    const result = clampToRetention(range('2020-01-01', '2020-12-31'), {
      maxAgeDays: 90,
      now,
    });
    expect(result.clamped).toBe(true);
    expect(result.effective).toBeNull();
    expect(show([result.excluded!])).toEqual(['2020-01-01..2020-12-31']);
  });

  it('keeps the boundary day itself, which is still in range', () => {
    const result = clampToRetention(range('2026-06-05', '2026-06-06'), {
      maxAgeDays: 90,
      now,
    });
    expect(result.clamped).toBe(false);
    expect(show([result.effective!])).toEqual(['2026-06-05..2026-06-06']);
  });

  it('clamps a future end date back to today', () => {
    const result = clampToRetention(range('2026-08-01', '2026-12-31'), {
      maxAgeDays: 90,
      now,
    });
    expect(result.clamped).toBe(true);
    expect(show([result.effective!])).toEqual(['2026-08-01..2026-09-02']);
  });

  it('preserves the exact instant of "now" as the upper bound, not midnight', () => {
    // A sync always asks for `to: now()`, a precise timestamp partway through
    // today -- not a day-aligned boundary. Rounding it down to midnight would
    // silently exclude everything that happened today, on every run, forever.
    const preciseNow = new Date('2026-09-02T19:28:00.000Z');
    const result = clampToRetention(
      { from: day('2026-08-27'), to: preciseNow },
      { maxAgeDays: 90, now: preciseNow }
    );
    expect(result.clamped).toBe(false);
    expect(result.effective!.to).toEqual(preciseNow);
  });

  it('clamps a future end date to the exact current instant, not today at midnight', () => {
    const preciseNow = new Date('2026-09-02T19:28:00.000Z');
    const result = clampToRetention(
      { from: day('2026-08-27'), to: new Date('2026-12-31T00:00:00Z') },
      { maxAgeDays: 90, now: preciseNow }
    );
    expect(result.clamped).toBe(true);
    expect(result.effective!.to).toEqual(preciseNow);
  });
});

describe('DOMAIN_WINDOWS', () => {
  it('caps traffic requests at 90 days with two years of history', () => {
    expect(DOMAIN_WINDOWS.traffic.maxChunkDays).toBe(90);
    expect(DOMAIN_WINDOWS.traffic.maxAgeDays).toBe(730);
  });

  it('caps order discovery at the 90-day filter boundary', () => {
    expect(DOMAIN_WINDOWS.orders.maxAgeDays).toBe(90);
  });

  it('caps priority daily ad reports at 7 days', () => {
    expect(DOMAIN_WINDOWS.adsPriorityDaily.maxChunkDays).toBe(7);
  });

  it('never lets a chunk size exceed its own retention window', () => {
    for (const [name, window] of Object.entries(DOMAIN_WINDOWS)) {
      expect(
        window.maxChunkDays,
        `${name} chunk size exceeds its retention window`
      ).toBeLessThanOrEqual(window.maxAgeDays);
    }
  });
});
