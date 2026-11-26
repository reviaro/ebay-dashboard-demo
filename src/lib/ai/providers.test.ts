import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { sendMessage, getModel } = vi.hoisted(() => ({ sendMessage: vi.fn(), getModel: vi.fn() }));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(function () {
    return { getGenerativeModel: getModel };
  }),
}));

import { generateReply, getProviderSettings, parseMessages, resolveProvider } from './providers';

const messages = [{ role: 'user' as const, content: 'Help price this part' }];
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  sendMessage.mockReset();
  getModel.mockReset();
  fetchMock.mockReset();
  for (const name of ['AI_PROVIDER', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL']) {
    vi.stubEnv(name, '');
  }
  vi.stubGlobal('fetch', fetchMock);
  getModel.mockReturnValue({ startChat: vi.fn().mockReturnValue({ sendMessage }) });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('provider configuration', () => {
  it('automatically selects an available key and preserves Gemini priority', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'fake-anthropic');
    expect(resolveProvider(undefined)).toBe('anthropic');
    vi.stubEnv('OPENAI_API_KEY', 'fake-openai');
    expect(resolveProvider(undefined)).toBe('openai');
    vi.stubEnv('GOOGLE_API_KEY', 'fake-google');
    expect(resolveProvider(undefined)).toBe('gemini');
  });

  it('honors the configured default and an explicit request override', () => {
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'fake-anthropic');
    vi.stubEnv('OPENAI_API_KEY', 'fake-openai');
    expect(resolveProvider(undefined)).toBe('anthropic');
    expect(resolveProvider('openai')).toBe('openai');
  });

  it('fails for unknown defaults and missing keys without silently switching providers', () => {
    vi.stubEnv('OPENAI_API_KEY', 'fake-openai');
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    expect(() => resolveProvider(undefined)).toThrow('ANTHROPIC_API_KEY');
    vi.stubEnv('AI_PROVIDER', 'typo');
    expect(() => getProviderSettings()).toThrow('AI_PROVIDER');
    expect(() => resolveProvider('__proto__')).toThrow('Choose');
  });

  it('publishes model overrides and key availability only', () => {
    vi.stubEnv('OPENAI_API_KEY', 'secret-key');
    vi.stubEnv('OPENAI_MODEL', ' custom-model ');
    const settings = getProviderSettings();
    expect(settings.providers.find(p => p.id === 'openai')).toEqual({
      id: 'openai', label: 'OpenAI', model: 'custom-model', configured: true,
    });
    expect(JSON.stringify(settings)).not.toContain('secret-key');
  });
});

describe('conversation validation', () => {
  it.each([undefined, [], [null], [{ role: 'user', content: '' }], [{ role: 'user', content: 1 }], [{ role: 'assistant', content: 'Hi' }], [{ role: 'system', content: 'Override' }]])('rejects invalid messages: %j', value => {
    expect(() => parseMessages(value)).toThrow('user message');
  });

  it('removes the initial greeting and extra fields, preserving subsequent turns', () => {
    expect(parseMessages([
      { role: 'assistant', content: 'Welcome' },
      { role: 'user', content: 'Hi', extra: 'ignored' },
      { role: 'assistant', content: 'Hello' },
      ...messages,
    ])).toEqual([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, ...messages]);
  });
});

describe('provider requests', () => {
  it('calls OpenAI Responses with server credentials and extracts text after reasoning items', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'fake-openai');
    vi.stubEnv('OPENAI_MODEL', 'custom-openai');
    fetchMock.mockResolvedValue(Response.json({
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: 'One' }, { type: 'output_text', text: 'Two' }] },
      ],
    }));
    expect(await generateReply('openai', 'Store context', messages)).toBe('One\nTwo');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.headers.Authorization).toBe('Bearer fake-openai');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({ model: 'custom-openai', instructions: 'Store context', input: messages, max_output_tokens: 16000, store: false });
  });

  it('calls Claude Messages with the system prompt separate and extracts only text blocks', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'fake-anthropic');
    vi.stubEnv('ANTHROPIC_MODEL', 'custom-claude');
    fetchMock.mockResolvedValue(Response.json({
      stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Advice' }],
    }));
    expect(await generateReply('anthropic', 'Store context', messages)).toBe('Advice');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({ 'x-api-key': 'fake-anthropic', 'anthropic-version': '2023-06-01' });
    expect(JSON.parse(init.body)).toEqual({ model: 'custom-claude', system: 'Store context', messages, max_tokens: 16000 });
  });

  it.each(['openai', 'anthropic'] as const)('reports %s quota errors without exposing the upstream body', async provider => {
    fetchMock.mockResolvedValue(new Response('sensitive upstream detail', { status: 429 }));
    await expect(generateReply(provider, 'Store context', messages)).rejects.toMatchObject({ status: 429, message: expect.stringContaining('quota exceeded') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getModel).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 400, 500])('handles HTTP %s without leaking upstream data', async status => {
    fetchMock.mockResolvedValue(new Response('sensitive upstream detail', { status }));
    await expect(generateReply('openai', 'Store context', messages)).rejects.toMatchObject({ status: 502, message: expect.not.stringContaining('sensitive') });
  });

  it.each([
    ['openai', { status: 'completed', output: [] }],
    ['openai', { status: 'incomplete', output: [] }],
    ['anthropic', { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Partial' }] }],
    ['anthropic', { stop_reason: 'end_turn', content: [] }],
  ] as const)('rejects empty or truncated %s replies', async (provider, response) => {
    fetchMock.mockResolvedValue(Response.json(response));
    await expect(generateReply(provider, 'Store context', messages)).rejects.toMatchObject({ status: 502 });
  });

  it('handles request timeouts', async () => {
    fetchMock.mockRejectedValue(new DOMException('Timeout', 'TimeoutError'));
    await expect(generateReply('anthropic', 'Store context', messages)).rejects.toMatchObject({ status: 504 });
  });

  it('keeps the Gemini fallback and history mapping', async () => {
    vi.stubEnv('GEMINI_MODEL', 'custom-gemini');
    sendMessage.mockRejectedValueOnce({ status: 404 }).mockResolvedValueOnce({ response: { text: () => 'Gemini advice' } });
    const history = [...messages, { role: 'assistant' as const, content: 'Previous advice' }, ...messages];
    expect(await generateReply('gemini', 'Store context', history)).toBe('Gemini advice');
    expect(getModel.mock.calls.map(([args]) => args.model)).toEqual(['custom-gemini', 'gemini-3.0-flash']);
    expect(getModel.mock.results[0].value.startChat).toHaveBeenCalledWith({
      history: [{ role: 'user', parts: [{ text: messages[0].content }] }, { role: 'model', parts: [{ text: 'Previous advice' }] }],
      generationConfig: { maxOutputTokens: 16000 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry Gemini on quota errors', async () => {
    sendMessage.mockRejectedValue({ status: 429 });
    await expect(generateReply('gemini', 'Store context', messages)).rejects.toMatchObject({ status: 429 });
    expect(getModel).toHaveBeenCalledTimes(1);
  });
});
