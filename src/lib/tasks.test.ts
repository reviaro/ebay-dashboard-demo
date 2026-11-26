import { it } from '@/test/store-fixture';
import { describe, expect, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  default: {
    task: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import {
  parseTaskCreate,
  parseTaskUpdate,
  createTask,
  updateTask,
  deleteTask,
  listTasks,
} from './tasks';

const task = prisma.task as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseTaskCreate', () => {
  it('accepts a minimal valid body and fills defaults', () => {
    const out = parseTaskCreate({ title: '  Fix the thing  ' });
    expect(out).toEqual({
      title: 'Fix the thing',
      description: undefined,
      status: 'todo',
      priority: 'medium',
      phase: undefined,
      dueDate: undefined,
    });
  });

  it('accepts every field', () => {
    const out = parseTaskCreate({
      title: 'T', description: 'd', status: 'in-progress', priority: 'high',
      phase: 2, dueDate: '2026-10-01',
    });
    expect(out).toMatchObject({ status: 'in-progress', priority: 'high', phase: 2 });
    expect((out as { dueDate: Date }).dueDate).toEqual(new Date('2026-10-01'));
  });

  it.each([
    ['missing title', {}, /title/i],
    ['blank title', { title: '   ' }, /title/i],
    ['over-long title', { title: 'x'.repeat(501) }, /500/],
    ['over-long description', { title: 'T', description: 'x'.repeat(5001) }, /description/i],
    ['bad status', { title: 'T', status: 'doing' }, /status/i],
    ['bad priority', { title: 'T', priority: 'urgent' }, /priority/i],
    ['non-integer phase', { title: 'T', phase: 1.5 }, /phase/i],
    ['zero phase', { title: 'T', phase: 0 }, /phase/i],
    ['unparseable dueDate', { title: 'T', dueDate: 'soon' }, /dueDate/i],
    ['non-object body', 'nope', /body/i],
  ])('rejects %s', (_label, body, pattern) => {
    const out = parseTaskCreate(body);
    expect(out).toHaveProperty('errors');
    expect((out as { errors: string[] }).errors.join(' ')).toMatch(pattern);
  });

  it('a blank title yields exactly one title error, not a duplicate', () => {
    const out = parseTaskCreate({ title: '   ' }) as { errors: string[] };
    expect(out.errors.filter((e) => /title/i.test(e))).toEqual(['title is required']);
  });

  it('an over-long title reports the 500 cap and does not also say "is required"', () => {
    const out = parseTaskCreate({ title: 'x'.repeat(501) }) as { errors: string[] };
    const joined = out.errors.join(' ');
    expect(joined).toMatch(/500/);
    expect(joined).not.toMatch(/is required/);
  });

  it('rejects a description over 5000 characters', () => {
    const out = parseTaskCreate({ title: 'T', description: 'x'.repeat(5001) }) as { errors: string[] };
    expect(out.errors.join(' ')).toMatch(/description must be <= 5000 characters/);
  });

  it('accepts a description of exactly 5000 characters', () => {
    const out = parseTaskCreate({ title: 'T', description: 'x'.repeat(5000) });
    expect(out).not.toHaveProperty('errors');
  });

  it('accepts a markdown report far longer than the description cap', () => {
    const report = '# Weekly review\n\n' + 'x'.repeat(50_000);
    expect(parseTaskCreate({ title: 'T', report })).toMatchObject({ report });
  });

  it('accepts a null report', () => {
    expect(parseTaskCreate({ title: 'T', report: null })).toMatchObject({ report: null });
  });

  it('rejects a report over 200000 characters', () => {
    const out = parseTaskCreate({ title: 'T', report: 'x'.repeat(200_001) }) as { errors: string[] };
    expect(out.errors.join(' ')).toMatch(/report must be <= 200000 characters/);
  });

  it('rejects a non-string report', () => {
    const out = parseTaskCreate({ title: 'T', report: { body: 'x' } }) as { errors: string[] };
    expect(out.errors.join(' ')).toMatch(/report must be a string or null/);
  });
});

describe('parseTaskUpdate', () => {
  it('requires an integer id >= 1', () => {
    expect(parseTaskUpdate({ id: 0, title: 'T' })).toHaveProperty('errors');
    expect(parseTaskUpdate({ title: 'T' })).toHaveProperty('errors');
  });

  it('requires at least one updatable field', () => {
    expect(parseTaskUpdate({ id: 3 })).toHaveProperty('errors');
  });

  it('returns id + only the provided, validated fields', () => {
    const out = parseTaskUpdate({ id: 3, status: 'completed', title: '  done  ' });
    expect(out).toEqual({ id: 3, fields: { status: 'completed', title: 'done' } });
  });

  it('accepts an update carrying only a report', () => {
    expect(parseTaskUpdate({ id: 3, report: '## Findings' })).toEqual({ id: 3, fields: { report: '## Findings' } });
  });

  it('re-validates provided fields', () => {
    expect(parseTaskUpdate({ id: 3, priority: 'nope' })).toHaveProperty('errors');
  });
});

describe('createTask / updateTask / deleteTask', () => {
  it('createTask passes the parsed input straight to prisma', async () => {
    task.create.mockResolvedValue({ id: 1 });
    await createTask({
      title: 'T', description: null, report: '# R', status: 'todo', priority: 'medium',
      phase: null, dueDate: null,
    });
    expect(task.create.mock.calls[0][0]).toEqual({
      data: { storeId: 'legacy', title: 'T', description: null, report: '# R', status: 'todo', priority: 'medium', phase: null, dueDate: null },
    });
  });

  it('createTask omits phase when it is undefined, letting the DB @default apply', async () => {
    task.create.mockResolvedValue({ id: 2 });
    await createTask({ title: 'T', status: 'todo', priority: 'medium' });
    expect(task.create.mock.calls[0][0].data.phase).toBeUndefined();
  });

  it('createTask still forwards an explicit null phase', async () => {
    task.create.mockResolvedValue({ id: 3 });
    await createTask({ title: 'T', status: 'todo', priority: 'medium', phase: null });
    expect(task.create.mock.calls[0][0].data.phase).toBeNull();
  });

  it('updateTask returns null when the row does not exist (P2025)', async () => {
    task.update.mockRejectedValue(Object.assign(new Error('nope'), { code: 'P2025' }));
    expect(await updateTask(999, { status: 'completed' })).toBeNull();
  });

  it('deleteTask returns false when the row does not exist (P2025)', async () => {
    task.delete.mockRejectedValue(Object.assign(new Error('nope'), { code: 'P2025' }));
    expect(await deleteTask(999)).toBe(false);
  });

  it('deleteTask returns true on success', async () => {
    task.delete.mockResolvedValue({ id: 5 });
    expect(await deleteTask(5)).toBe(true);
  });

  it('listTasks orders by createdAt desc', async () => {
    task.findMany.mockResolvedValue([]);
    await listTasks();
    expect(task.findMany.mock.calls[0][0]).toEqual({ orderBy: { createdAt: 'desc' } });
  });
});
