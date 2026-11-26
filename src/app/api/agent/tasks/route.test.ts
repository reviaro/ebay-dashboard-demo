vi.mock('@/lib/prisma', () => ({ adminDb: { agentKey: { findUnique: async ({ where }: { where: { tokenHash: string } }) => where.tokenHash === tokenHash('t0ken') ? { id: 'key1', storeId: 'legacy', canEditTasks: true, revokedAt: null, store: { archivedAt: null, marketplaceId: 'EBAY_US' } } : null } } }));
import { tokenHash } from '@/lib/stores/route';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tasks', () => ({
  parseTaskCreate: vi.fn(),
  parseTaskUpdate: vi.fn(),
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  // Real implementation, deliberately NOT a vi.fn: the route delegates JSON
  // parsing to the lib and resetAllMocks() (below) would otherwise strip it.
  readJson: async (request: Request) => {
    try {
      return await request.json();
    } catch {
      return undefined;
    }
  },
}));

import * as tasks from '@/lib/tasks';
import { GET, POST, PUT, DELETE } from './route';

const m = tasks as unknown as Record<string, ReturnType<typeof vi.fn>>;


const req = (init: RequestInit & { url?: string } = {}) =>
  new Request((init.url ?? 'http://localhost/api/agent/tasks') + ((init.url ?? '').includes('?') ? '&' : '?') + 'store=legacy', init);
const authed = (init: RequestInit & { url?: string } = {}) =>
  req({ ...init, headers: { authorization: 'Bearer t0ken', ...(init.headers ?? {}) } });

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so a mockResolvedValue/mockReturnValue set
  // in one test cannot leak into the next. `readJson` is a plain fn in the mock
  // factory, so reset leaves it intact.
  vi.resetAllMocks();

});


describe('GET /api/agent/tasks', () => {
  it('401s without a token', async () => {
    expect((await GET(req())).status).toBe(401);
    expect(m.listTasks).not.toHaveBeenCalled();
  });

  it('returns the task list with a token', async () => {
    m.listTasks.mockResolvedValue([{ id: 1 }]);
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);
  });

  it('500s with a JSON error body when the lib call rejects', async () => {
    m.listTasks.mockRejectedValue(new Error('db is down'));
    const res = await GET(authed());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Task operation failed' });
  });
});

describe('POST /api/agent/tasks', () => {
  it('400s on validation errors', async () => {
    m.parseTaskCreate.mockReturnValue({ errors: ['title is required'] });
    const res = await POST(authed({ method: 'POST', body: '{}' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ details: ['title is required'] });
    expect(m.createTask).not.toHaveBeenCalled();
  });

  it('400s on a malformed JSON body', async () => {
    const res = await POST(authed({ method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it('creates and returns 200 on valid input', async () => {
    m.parseTaskCreate.mockReturnValue({ title: 'T', status: 'todo', priority: 'medium' });
    m.createTask.mockResolvedValue({ id: 7, title: 'T' });
    const res = await POST(authed({ method: 'POST', body: '{"title":"T"}' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, title: 'T' });
  });
});

describe('PUT /api/agent/tasks', () => {
  it('404s when the id does not exist', async () => {
    m.parseTaskUpdate.mockReturnValue({ id: 999, fields: { status: 'completed' } });
    m.updateTask.mockResolvedValue(null);
    const res = await PUT(authed({ method: 'PUT', body: '{"id":999,"status":"completed"}' }));
    expect(res.status).toBe(404);
  });

  it('updates and returns 200', async () => {
    m.parseTaskUpdate.mockReturnValue({ id: 3, fields: { status: 'completed' } });
    m.updateTask.mockResolvedValue({ id: 3, status: 'completed' });
    const res = await PUT(authed({ method: 'PUT', body: '{"id":3,"status":"completed"}' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 3, status: 'completed' });
  });
});

describe('DELETE /api/agent/tasks', () => {
  it('400s without a numeric id', async () => {
    expect((await DELETE(authed({ method: 'DELETE' }))).status).toBe(400);
  });

  it('404s when the id does not exist', async () => {
    m.deleteTask.mockResolvedValue(false);
    const res = await DELETE(authed({ method: 'DELETE', url: 'http://localhost/api/agent/tasks?id=999' }));
    expect(res.status).toBe(404);
  });

  it('deletes and returns 200', async () => {
    m.deleteTask.mockResolvedValue(true);
    const res = await DELETE(authed({ method: 'DELETE', url: 'http://localhost/api/agent/tasks?id=5' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});
