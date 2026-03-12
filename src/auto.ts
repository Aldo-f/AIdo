import { PROVIDER_CONFIGS, type Provider } from './detector.js';
import { getRotator } from './rotator.js';
import { logRequest } from './db.js';
import { toOllamaBody, fromOllamaResponse, toOllamaPath } from './ollama.js';

// Priority order for auto mode — free/unlimited first, paid last
// A provider is skipped if it has no keys configured (or is unavailable)
export const AUTO_PRIORITY: Array<{ provider: Provider; model: string }> = [
  { provider: 'zen',          model: 'big-pickle'       },
  { provider: 'ollama-local', model: 'qwen3:8b'         }, // no limits, offline
  { provider: 'ollama',       model: 'glm-5:cloud'      },
  { provider: 'groq',         model: 'llama3-8b-8192'   },
  { provider: 'openai',       model: 'gpt-4o-mini'      },
  { provider: 'anthropic',    model: 'claude-haiku-4-5' },
];

/** Non-retryable HTTP status codes */
const FATAL_STATUSES = new Set([400, 401, 403, 404]);

export interface AutoResult {
  status: number;
  body: string;
  headers: Record<string, string>;
  usedProvider: Provider;
  usedModel: string;
}

export async function forwardAuto(
  openaiPath: string,
  method: string,
  body: string,
): Promise<AutoResult> {
  const tried: string[] = [];

  for (const { provider, model } of AUTO_PRIORITY) {
    const rotator = getRotator(provider);
    const key = rotator.next();

    // Skip if no keys available for this provider
    if (!key) {
      tried.push(`${provider}(no keys)`);
      continue;
    }

    const config = PROVIDER_CONFIGS[provider];
    const isOllama = config.nativeFormat === true;

    // Rewrite the model in the request body to the provider's preferred model
    let upstreamBody = body;
    try {
      const parsed = JSON.parse(body);
      // Only override model if client sent "auto" or no model
      if (!parsed.model || parsed.model === 'auto') {
        parsed.model = model;
      }
      upstreamBody = JSON.stringify(parsed);
    } catch { /* leave body as-is */ }

    if (isOllama) upstreamBody = toOllamaBody(upstreamBody);

    const upstreamPath = isOllama ? toOllamaPath(openaiPath) : openaiPath;
    const url = `${config.baseUrl}${upstreamPath}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...config.authHeader(key),
        },
        body: method !== 'GET' && method !== 'HEAD' ? upstreamBody : undefined,
      });
    } catch (err) {
      tried.push(`${provider}(network error: ${(err as Error).message})`);
      continue;
    }

    const rawBody = await res.text();
    const responseBody = isOllama ? fromOllamaResponse(rawBody) : rawBody;
    logRequest(key, provider, res.status);

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after');
      rotator.markLimited(key, retryAfter ? parseInt(retryAfter, 10) : 3600);
      tried.push(`${provider}(429)`);
      console.log(`[auto] ${provider}/${model} rate limited → trying next`);
      continue;
    }

    if (FATAL_STATUSES.has(res.status)) {
      tried.push(`${provider}(${res.status})`);
      console.log(`[auto] ${provider}/${model} → ${res.status}, trying next`);
      continue;
    }

    // Success
    console.log(`[auto] ✓ ${provider}/${model} (tried: ${tried.join(', ') || 'none'})`);
    const responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
    res.headers.forEach((v, k) => { if (k !== 'content-type') responseHeaders[k] = v; });

    return { status: res.status, body: responseBody, headers: responseHeaders, usedProvider: provider, usedModel: model };
  }

  return {
    status: 503,
    body: JSON.stringify({
      error: 'All providers exhausted.',
      tried,
      hint: 'Add more API keys with: aido add <key>',
    }),
    headers: { 'content-type': 'application/json' },
    usedProvider: 'zen',
    usedModel: 'auto',
  };
}
