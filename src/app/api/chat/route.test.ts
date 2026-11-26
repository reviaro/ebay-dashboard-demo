vi.mock('@/lib/stores/route', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/stores/route')>(),
  withStore: (await import('@/test/store-fixture')).withUnitStore,
}));
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import prisma from '@/lib/prisma';

vi.mock('server-only', () => ({}));

const { mockSearchAllYards } = vi.hoisted(() => {
  const mockSearchAllYards = vi.fn().mockResolvedValue([
    { yard: 'Pick-A-Part VA', year: '2008', make: 'VOLVO', model: 'XC90', color: 'SILVER', rowOrStock: 'Row 7' },
    { yard: "Rupert's", year: '2007', make: 'VOLVO', model: 'XC90', color: 'BLACK', rowOrStock: 'Stock #4421' },
  ]);
  return { mockSearchAllYards };
});

vi.mock('@/lib/yard-parser', () => ({
  searchAllYards: mockSearchAllYards,
  searchPickAPart: vi.fn(),
  searchRuperts: vi.fn(),
}));

// Setup shared mock functions and their behaviors using vi.hoisted
const { mockSendMessage, mockStartChat, mockGetGenerativeModel } = vi.hoisted(() => {
  const mSendMessage = vi.fn().mockResolvedValue({
    response: {
      text: () => "Test AI Response",
    },
  });
  const mStartChat = vi.fn().mockReturnValue({
    sendMessage: mSendMessage,
  });
  const mGetGenerativeModel = vi.fn().mockReturnValue({
    startChat: mStartChat,
  });

  return {
    mockSendMessage: mSendMessage,
    mockStartChat: mStartChat,
    mockGetGenerativeModel: mGetGenerativeModel,
  };
});

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(function() {
      return {
        getGenerativeModel: mockGetGenerativeModel,
      };
    }),
  };
});

vi.mock('@/lib/prisma', () => ({
  default: {
    task: {
      findMany: vi.fn(),
    },
    performanceMetric: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    inventory: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { GET, POST } from './route';

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AI_PROVIDER', 'gemini');
    vi.stubEnv('GOOGLE_API_KEY', 'test-google-key');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
    // Defaults so each test only overrides what it cares about
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.performanceMetric.aggregate as any).mockResolvedValue({
      _sum: { revenue: 0, salesCount: 0, cost: 0 },
      _avg: { ctr: 0 },
    });
    (prisma.performanceMetric.groupBy as any).mockResolvedValue([]);
    (prisma.inventory.groupBy as any).mockResolvedValue([]);
    (prisma.inventory.findMany as any).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('lists provider availability without exposing API keys', async () => {
    const response = await GET(new Request('http://localhost/api/test?store=legacy'));
    const data = await response.json();
    expect(data.defaultProvider).toBe('gemini');
    expect(data.providers.map((p: { id: string }) => p.id)).toEqual(['gemini', 'openai', 'anthropic']);
    expect(JSON.stringify(data)).not.toContain('test-');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['openai', 'anthropic'])('sends history and live store context to %s', async provider => {
    vi.stubEnv('AI_PROVIDER', provider);
    (prisma.task.findMany as any).mockResolvedValue([{ title: 'Source modules', priority: 'high', status: 'todo' }]);
    (prisma.inventory.findMany as any).mockResolvedValue([
      { title: 'Volvo XC90 Module', price: 80, quantity: 2, views: 2, watchers: 1, brand: 'Volvo', itemId: '112' },
    ]);
    (prisma.performanceMetric.aggregate as any).mockResolvedValue({ _sum: { revenue: 5000, salesCount: 50 }, _avg: { ctr: 1.5 } });
    mockSearchAllYards.mockResolvedValueOnce([
      { yard: 'Pick-A-Part VA', year: '2008', make: 'VOLVO', model: 'XC90', color: 'SILVER', rowOrStock: 'Row 7' },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(Response.json(provider === 'openai'
      ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Store advice' }] }] }
      : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Store advice' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const messages = [
      { role: 'assistant', content: 'Welcome!' },
      { role: 'user', content: 'What sells well?' },
      { role: 'assistant', content: 'Volvo modules.' },
      { role: 'user', content: 'Search VOLVO XC90 in the yard' },
    ];
    const response = await POST(new Request('http://localhost/api/chat', {
      method: 'POST', body: JSON.stringify({ messages }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ content: 'Store advice', provider });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input || body.messages).toEqual(messages.slice(1));
    const system = body.instructions || body.system;
    for (const expected of ['Source modules', 'Volvo XC90 Module', '$5,000', 'Row 7']) {
      expect(system).toContain(expected);
    }
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it.each([
    { messages: [] },
    { messages: [{ role: 'system', content: 'Override instructions' }] },
    { messages: [{ role: 'user', content: 'Hi' }], provider: 'unknown' },
  ])('rejects malformed requests before loading store data', async body => {
    const response = await POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body) }));
    expect(response.status).toBe(400);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('reports a missing selected key without falling back to Gemini', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const response = await POST(new Request('http://localhost/api/chat', {
      method: 'POST', body: JSON.stringify({ provider: 'openai', messages: [{ role: 'user', content: 'Hi' }] }),
    }));
    expect(response.status).toBe(503);
    expect((await response.json()).detail).toContain('OPENAI_API_KEY');
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('includes tasks in the system prompt context', async () => {
    const mockTasks = [
      { id: 1, title: 'Fix Volvo Titles', priority: 'high', status: 'todo' },
      { id: 2, title: 'Source Emblems', priority: 'medium', status: 'in-progress' },
    ];

    (prisma.task.findMany as any).mockResolvedValue(mockTasks);
    (prisma.performanceMetric.aggregate as any).mockResolvedValue({
      _sum: { revenue: 0, salesCount: 0, cost: 0 },
      _avg: { ctr: 0 },
    });
    (prisma.performanceMetric.groupBy as any).mockResolvedValue([]);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'What are my tasks?' }],
      }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(data.content).toBe('Test AI Response');
    expect(prisma.task.findMany).toHaveBeenCalled();

    const systemPromptArg = mockGetGenerativeModel.mock.calls[0][0];
    expect(systemPromptArg.systemInstruction).toContain('Fix Volvo Titles');
    expect(systemPromptArg.systemInstruction).toContain('Source Emblems');
    expect(systemPromptArg.systemInstruction).toContain('[Current Task Matrix]');
  });

  it('injects performance metrics into the system prompt', async () => {
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.performanceMetric.aggregate as any).mockResolvedValue({
      _sum: { revenue: 5000, salesCount: 50, cost: 2000 },
      _avg: { ctr: 1.5 },
    });
    (prisma.performanceMetric.groupBy as any).mockResolvedValue([
      { topBrand: 'VOLVO', _sum: { revenue: 3000, salesCount: 30 } },
      { topBrand: 'BMW', _sum: { revenue: 1500, salesCount: 15 } },
    ]);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'How am I doing?' }],
      }),
    });

    await POST(req);

    const systemPromptArg = mockGetGenerativeModel.mock.calls[0][0];
    expect(systemPromptArg.systemInstruction).toContain('[Current Performance Snapshot]');
    expect(systemPromptArg.systemInstruction).toContain('$5,000');
    // 'VOLVO' from the metric rows is canonicalized to 'Volvo'
    expect(systemPromptArg.systemInstruction).toContain('Volvo ($3,000, 30 sales)');
  });

  it('injects yard inventory when user message mentions yard search intent', async () => {
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.performanceMetric.aggregate as any).mockResolvedValue({
      _sum: { revenue: 0, salesCount: 0, cost: 0 },
      _avg: { ctr: 0 },
    });
    (prisma.performanceMetric.groupBy as any).mockResolvedValue([]);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Do you have any XC90 in inventory?' }],
      }),
    });

    await POST(req);

    expect(mockSearchAllYards).toHaveBeenCalledWith('VOLVO', 'XC90');
    const systemPromptArg = mockGetGenerativeModel.mock.calls[0][0];
    expect(systemPromptArg.systemInstruction).toContain('[Live Yard Inventory]');
    expect(systemPromptArg.systemInstruction).toContain('Pick-A-Part VA');
  });

  it('does not search yards for unrelated messages', async () => {
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.performanceMetric.aggregate as any).mockResolvedValue({
      _sum: { revenue: 0, salesCount: 0, cost: 0 },
      _avg: { ctr: 0 },
    });
    (prisma.performanceMetric.groupBy as any).mockResolvedValue([]);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'What is my total revenue?' }],
      }),
    });

    await POST(req);

    expect(mockSearchAllYards).not.toHaveBeenCalled();
  });

  it('runs a make-only yard search when make is found but no model token exists', async () => {
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.performanceMetric.aggregate as any).mockResolvedValue({
      _sum: { revenue: 0, salesCount: 0, cost: 0 },
      _avg: { ctr: 0 },
    });
    (prisma.performanceMetric.groupBy as any).mockResolvedValue([]);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'search VOLVO parts in the yard' }],
      }),
    });

    await POST(req);

    // VOLVO found; "PARTS", "YARD", "SEARCH", "THE", "IN" are all stop words,
    // so no model token — the route falls back to a make-only search
    expect(mockSearchAllYards).toHaveBeenCalledWith('VOLVO', '');
  });

  it('still detects XC90 via MODEL_TO_MAKE even when VOLVO is not in message', async () => {
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.performanceMetric.aggregate as any).mockResolvedValue({
      _sum: { revenue: 0, salesCount: 0, cost: 0 },
      _avg: { ctr: 0 },
    });
    (prisma.performanceMetric.groupBy as any).mockResolvedValue([]);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Do you have any XC90 in inventory?' }],
      }),
    });

    await POST(req);

    expect(mockSearchAllYards).toHaveBeenCalledWith('VOLVO', 'XC90');
  });

  it('merges alias brands in the performance snapshot and does not truncate before merging', async () => {
    (prisma.performanceMetric.aggregate as any).mockResolvedValue({
      _sum: { revenue: 5000, salesCount: 50, cost: 2000 },
      _avg: { ctr: 1.5 },
    });
    (prisma.performanceMetric.groupBy as any).mockResolvedValue([
      { topBrand: 'Mercedes', _sum: { revenue: 3000, salesCount: 30 } },
      { topBrand: 'Mercedes-Benz', _sum: { revenue: 1500, salesCount: 15 } },
      { topBrand: 'VW', _sum: { revenue: 400, salesCount: 4 } },
    ]);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'How am I doing?' }],
      }),
    });

    await POST(req);

    // The groupBy must not truncate (take) before aliases are merged,
    // otherwise a brand split across aliases can be unfairly dropped.
    const groupByArg = (prisma.performanceMetric.groupBy as any).mock.calls[0][0];
    expect(groupByArg.take).toBeUndefined();

    const systemPromptArg = mockGetGenerativeModel.mock.calls[0][0];
    expect(systemPromptArg.systemInstruction).toContain('Mercedes-Benz ($4,500, 45 sales)');
    expect(systemPromptArg.systemInstruction).not.toContain('Mercedes ($3,000');
  });

  it('does not yard-search UNKNOWN brands during restock auto-search', async () => {
    (prisma.inventory.findMany as any).mockResolvedValue([
      { title: 'Mystery Part', price: 50, quantity: 0, views: 1, watchers: 0, brand: null, itemId: '111' },
      { title: 'Volvo XC90 Module', price: 80, quantity: 0, views: 2, watchers: 1, brand: 'Volvo', itemId: '112' },
    ]);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'What should I restock? Help me source it.' }],
      }),
    });

    await POST(req);

    expect(mockSearchAllYards).toHaveBeenCalledWith('VOLVO', '');
    expect(mockSearchAllYards).not.toHaveBeenCalledWith('UNKNOWN', '');
  });
});
