vi.mock('@/lib/stores/route', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/stores/route')>(),
  withStore: (await import('@/test/store-fixture')).withUnitStore,
}));
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tasks', () => ({
  parseTaskCreate: vi.fn(),
  parseTaskUpdate: vi.fn(),
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  // Real implementation (not a vi.fn): the route delegates JSON parsing to it.
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
  new Request(init.url ?? 'http://localhost/api/tasks', init);

beforeEach(() => vi.clearAllMocks());

describe('/api/tasks (migrated to the shared lib)', () => {
  it('GET returns the list', async () => {
    m.listTasks.mockResolvedValue([{ id: 1 }]);
    expect(await (await GET(new Request('http://localhost/api/test?store=legacy'))).json()).toEqual([{ id: 1 }]);
  });

  it('POST 400s on validation errors instead of 500', async () => {
    m.parseTaskCreate.mockReturnValue({ errors: ['title is required'] });
    const res = await POST(req({ method: 'POST', body: '{}' }));
    expect(res.status).toBe(400);
  });

  it('POST 400s on a malformed body', async () => {
    const res = await POST(req({ method: 'POST', body: 'xxx' }));
    expect(res.status).toBe(400);
  });

  it('POST returns the created task on success', async () => {
    m.parseTaskCreate.mockReturnValue({ title: 'T', status: 'todo', priority: 'medium' });
    m.createTask.mockResolvedValue({ id: 9 });
    const res = await POST(req({ method: 'POST', body: '{"title":"T"}' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 9 });
  });

  it('PUT 404s when the id is unknown', async () => {
    m.parseTaskUpdate.mockReturnValue({ id: 999, fields: { status: 'completed' } });
    m.updateTask.mockResolvedValue(null);
    expect((await PUT(req({ method: 'PUT', body: '{"id":999,"status":"completed"}' }))).status).toBe(404);
  });

  it('DELETE 400s without a numeric id, 200s on success', async () => {
    expect((await DELETE(req({ method: 'DELETE' }))).status).toBe(400);
    m.deleteTask.mockResolvedValue(true);
    expect((await DELETE(req({ method: 'DELETE', url: 'http://localhost/api/tasks?id=5' }))).status).toBe(200);
  });

  it('500s with a JSON error body when a lib call rejects', async () => {
    m.listTasks.mockRejectedValue(new Error('db is down'));
    const res = await GET(new Request('http://localhost/api/test?store=legacy'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Task operation failed' });
  });
});
