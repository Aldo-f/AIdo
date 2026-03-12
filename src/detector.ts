// Key format → provider detection
// Order matters: most specific patterns first

export type Provider = 'zen' | 'openai' | 'anthropic' | 'groq' | 'google';

export interface ProviderConfig {
  baseUrl: string;
  authHeader: (key: string) => Record<string, string>;
}

export const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
  zen: {
    baseUrl: 'https://opencode.ai/zen/v1',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    authHeader: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
};

// Zen keys: sk- prefix, 60+ chars (e.g. sk-LXREfPN2uSYZ74VW4HLp...68 chars total)
// OpenAI keys: sk-proj-... or sk- + ~48 chars
// Anthropic: sk-ant-
const PATTERNS: Array<{ test: (key: string) => boolean; provider: Provider }> = [
  { test: (k) => k.startsWith('sk-ant-'),                       provider: 'anthropic' },
  { test: (k) => k.startsWith('sk-proj-'),                      provider: 'openai'    },
  { test: (k) => k.startsWith('gsk_'),                          provider: 'groq'      },
  { test: (k) => k.startsWith('AIza'),                          provider: 'google'    },
  { test: (k) => k.startsWith('sk-') && k.length >= 60,         provider: 'zen'       },
  { test: (k) => k.startsWith('sk-'),                           provider: 'openai'    },
];

export function detectProvider(key: string): Provider | null {
  for (const { test, provider } of PATTERNS) {
    if (test(key)) return provider;
  }
  return null;
}
