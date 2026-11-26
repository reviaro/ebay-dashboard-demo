import 'server-only';
import { assertLiveIntegrationAllowed } from '../demo/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIProvider, AIProviderSettings, ChatMessage } from './types';

const PROVIDERS = {
  gemini: { label: 'Gemini', key: 'GOOGLE_API_KEY', model: 'GEMINI_MODEL', defaultModel: 'gemini-3.0-flash' },
  openai: { label: 'OpenAI', key: 'OPENAI_API_KEY', model: 'OPENAI_MODEL', defaultModel: 'gpt-5-mini' },
  anthropic: { label: 'Claude', key: 'ANTHROPIC_API_KEY', model: 'ANTHROPIC_MODEL', defaultModel: 'claude-sonnet-5-5' },
} as const;

export class AIError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
  }
}

function isProvider(value: unknown): value is AIProvider {
  return typeof value === 'string' && Object.hasOwn(PROVIDERS, value);
}

function modelFor(provider: AIProvider) {
  return process.env[PROVIDERS[provider].model]?.trim() || PROVIDERS[provider].defaultModel;
}

export function getProviderSettings(): AIProviderSettings {
  const providers = (Object.keys(PROVIDERS) as AIProvider[]).map(id => ({
    id,
    label: PROVIDERS[id].label,
    model: modelFor(id),
    configured: Boolean(process.env[PROVIDERS[id].key]?.trim()),
  }));
  const preferred = process.env.AI_PROVIDER?.trim();
  if (preferred && !isProvider(preferred)) {
    throw new AIError('Set AI_PROVIDER to gemini, openai, or anthropic in .env.local.', 503);
  }
  return {
    defaultProvider: preferred as AIProvider || providers.find(p => p.configured)?.id || 'gemini',
    providers,
  };
}

export function resolveProvider(value: unknown): AIProvider {
  const provider = value === undefined ? getProviderSettings().defaultProvider : value;
  if (!isProvider(provider)) {
    throw new AIError('Choose Gemini, OpenAI, or Claude as the AI provider.', 400);
  }
  if (!process.env[PROVIDERS[provider].key]?.trim()) {
    throw new AIError(`${PROVIDERS[provider].label} is not configured. Add ${PROVIDERS[provider].key} to .env.local and restart the app.`, 503);
  }
  return provider;
}

export function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(m =>
    !m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()
  ) || value[value.length - 1].role !== 'user') {
    throw new AIError('Send a non-empty conversation ending with a user message.', 400);
  }
  // The drawer starts with an assistant greeting. All providers start at the first user turn.
  return value.slice(value.findIndex(m => m.role === 'user'))
    .map(m => ({ role: m.role, content: m.content }));
}

function upstreamError(provider: AIProvider, status?: number): AIError {
  const { label, key, model } = PROVIDERS[provider];
  if (status === 429) return new AIError(`${label} rate limit or quota exceeded. Try again later or check your ${label} API billing and limits.`, 429);
  if (status === 401 || status === 403) return new AIError(`${label} rejected the API credentials. Check ${key} and model access.`, 502);
  if (status === 404) return new AIError(`${label} model is unavailable. Check ${model} and your account's model access.`, 502);
  if (status === 400 || status === 413 || status === 422) return new AIError(`${label} could not process this conversation. Try a shorter conversation or check ${model}.`, 502);
  return new AIError(`${label} is unavailable right now. Please try again.`, 502);
}

interface TextBlock { type: string; text?: string }
interface ProviderResponse {
  status?: string;
  stop_reason?: string;
  content?: TextBlock[];
  output?: { type: string; content?: TextBlock[] }[];
}

async function requestJSON(provider: AIProvider, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<ProviderResponse> {
  const timeout = AbortSignal.timeout(120_000);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: 'no-store',
  });
  // Never forward upstream error bodies: they can include credentials or store data.
  if (!response.ok) throw upstreamError(provider, response.status);
  return response.json();
}

export async function generateReply(provider: AIProvider, system: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  assertLiveIntegrationAllowed();
  const apiKey = process.env[PROVIDERS[provider].key]?.trim() || '';
  const model = modelFor(provider);
  try {
    let text = '';
    if (provider === 'gemini') {
      const client = new GoogleGenerativeAI(apiKey);
      const models = [...new Set([model, 'gemini-3.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'])];
      for (const name of models) {
        try {
          const chat = client.getGenerativeModel({ model: name, systemInstruction: system }).startChat({
            history: messages.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
            generationConfig: { maxOutputTokens: 16000 },
          });
          text = (await chat.sendMessage(messages[messages.length - 1].content)).response.text();
          break;
        } catch (error) {
          const status = (error as { status?: number; httpStatusCode?: number }).status
            || (error as { httpStatusCode?: number }).httpStatusCode;
          if (status === 404) continue;
          throw upstreamError(provider, status);
        }
      }
      if (!text) throw upstreamError(provider, 404);
    } else if (provider === 'openai') {
      const result = await requestJSON(provider, 'https://api.openai.com/v1/responses', {
        Authorization: `Bearer ${apiKey}`,
      }, { model, instructions: system, input: messages, max_output_tokens: 16000, store: false }, signal);
      if (result.status !== 'completed') throw new AIError('OpenAI did not complete the response. Try a shorter request.');
      text = (result.output || []).filter(item => item.type === 'message')
        .flatMap(item => item.content || []).filter(block => block.type === 'output_text')
        .map(block => block.text || '').join('\n');
    } else {
      const result = await requestJSON(provider, 'https://api.anthropic.com/v1/messages', {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }, { model, system, messages, max_tokens: 16000 }, signal);
      if (result.stop_reason === 'max_tokens') throw new AIError('Claude reached its response limit. Try a shorter request.');
      text = (result.content || []).filter(block => block.type === 'text').map(block => block.text || '').join('\n');
    }
    if (!text.trim()) throw new AIError(`${PROVIDERS[provider].label} returned no text. Please try again.`);
    return text;
  } catch (error) {
    if (error instanceof AIError) throw error;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new AIError(`${PROVIDERS[provider].label} request timed out or was cancelled. Please try again.`, 504);
    }
    throw upstreamError(provider);
  }
}
