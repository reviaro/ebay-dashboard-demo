import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_LIMIT, recordSyncRun, type SyncRunRecorder, type SyncRunUpdate } from './run-log';

/** Records calls in order so the test can assert what happened and when. */
function fakeRecorder() {
  const calls: string[] = [];
  const finished: SyncRunUpdate[] = [];
  const recorder: SyncRunRecorder = {
    async start(type) {
      calls.push(`start:${type}`);
      return 42;
    },
    async finish(id, update) {
      calls.push(`finish:${id}:${update.status}`);
      finished.push(update);
    },
  };
  return { recorder, calls, finished };
}

describe('recordSyncRun', () => {
  it('returns the work’s result unchanged', async () => {
    const { recorder } = fakeRecorder();
    const result = await recordSyncRun({ recorder, type: 'orders', run: async () => ({ fetched: 7 }) });

    expect(result).toEqual({ fetched: 7 });
  });

  it('records a successful run with the count it reports', async () => {
    const { recorder, calls, finished } = fakeRecorder();
    await recordSyncRun({
      recorder, type: 'orders',
      run: async () => ({ stored: 12 }),
      count: r => r.stored,
    });

    expect(calls).toEqual(['start:orders', 'finish:42:ok']);
    expect(finished[0]).toMatchObject({ status: 'ok', count: 12, message: null });
  });

  // The failures worth logging are the ones that happen before any eBay call:
  // missing config, a disconnected account. Opening the record first is what
  // makes those visible instead of vanishing into the route's catch.
  it('opens the record before running the work, so an early throw is still logged', async () => {
    const { recorder, calls } = fakeRecorder();

    await expect(recordSyncRun({
      recorder, type: 'orders',
      run: async () => { throw new Error('EBAY_CLIENT_ID is not set'); },
    })).rejects.toThrow('EBAY_CLIENT_ID is not set');

    expect(calls).toEqual(['start:orders', 'finish:42:failed']);
  });

  it('stores the failure message and rethrows the original error', async () => {
    const { recorder, finished } = fakeRecorder();
    const boom = new Error('token exchange failed');

    await expect(recordSyncRun({ recorder, type: 'orders', run: async () => { throw boom; } }))
      .rejects.toBe(boom);

    expect(finished[0]).toMatchObject({ status: 'failed', count: 0 });
    expect(finished[0].message).toContain('token exchange failed');
  });

  // This row outlives the request and ends up in backups, so it is scrubbed
  // before it is written rather than only on the way to a response.
  it('scrubs secrets out of the stored message', async () => {
    const { recorder, finished } = fakeRecorder();

    await expect(recordSyncRun({
      recorder, type: 'orders',
      run: async () => { throw new Error('refused: Bearer v^1.1#i^1#f^0#abc123 rejected'); },
    })).rejects.toThrow();

    expect(finished[0].message).not.toContain('v^1.1');
    expect(finished[0].message).toContain('[REDACTED]');
  });

  it('caps the message so one huge error cannot bloat the table', async () => {
    const { recorder, finished } = fakeRecorder();

    await expect(recordSyncRun({
      recorder, type: 'orders',
      run: async () => { throw new Error('x'.repeat(5000)); },
    })).rejects.toThrow();

    expect((finished[0].message as string).length).toBeLessThanOrEqual(MESSAGE_LIMIT);
  });

  it('handles a thrown non-Error without losing the run', async () => {
    const { recorder, finished } = fakeRecorder();

    await expect(recordSyncRun({ recorder, type: 'orders', run: async () => { throw 'plain string'; } }))
      .rejects.toBe('plain string');

    expect(finished[0]).toMatchObject({ status: 'failed' });
  });

  describe('when the recorder itself fails', () => {
    // Logging is observability, not the job. A broken log must never be the
    // reason a sync that worked is reported as failed.
    it('still returns the result if the record cannot be opened', async () => {
      const recorder: SyncRunRecorder = {
        start: vi.fn().mockRejectedValue(new Error('db is locked')),
        finish: vi.fn(),
      };

      await expect(recordSyncRun({ recorder, type: 'orders', run: async () => 'done' }))
        .resolves.toBe('done');
      expect(recorder.finish).not.toHaveBeenCalled();
    });

    it('still returns the result if the record cannot be closed', async () => {
      const recorder: SyncRunRecorder = {
        start: async () => 1,
        finish: vi.fn().mockRejectedValue(new Error('db is locked')),
      };

      await expect(recordSyncRun({ recorder, type: 'orders', run: async () => 'done' }))
        .resolves.toBe('done');
    });

    it('still surfaces the sync’s own error rather than the logging error', async () => {
      const recorder: SyncRunRecorder = {
        start: async () => 1,
        finish: vi.fn().mockRejectedValue(new Error('db is locked')),
      };

      await expect(recordSyncRun({
        recorder, type: 'orders',
        run: async () => { throw new Error('the real failure'); },
      })).rejects.toThrow('the real failure');
    });
  });
});
