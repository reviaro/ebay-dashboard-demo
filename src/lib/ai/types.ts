export type AIProvider = 'gemini' | 'openai' | 'anthropic';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIProviderOption {
  id: AIProvider;
  label: string;
  model: string;
  configured: boolean;
}

export interface AIProviderSettings {
  defaultProvider: AIProvider;
  providers: AIProviderOption[];
}
