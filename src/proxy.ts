import http from 'http';
import { PROVIDER_CONFIGS, type Provider } from './detector.js';
import { getRotator } from './rotator.js';
import { logRequest } from './db.js';

const DEFAULT_PROVIDER: Provider =
  (process.env.DEFAULT_PROVIDER as Provider) ?? 'zen';

const PORT = parseInt(process.env.PROXY_PORT ?? '4141', 10);
const MAX_RETRIES = 3;

// Route: /zen/v1/... → zen, /openai/v1/... → openai, /v1/... → default
function resolveProvider(pathname: string): { provider: Provider; upstreamPath: string } {
  const known: Provider[] = ['zen', 'openai', 'anthropic', 'groq', 'google'];
  for (const p of known) {
    if (pathname.startsWith(`/${p}/`)) {
      return { provider: p, upstreamPath: pathname.slice(p.length + 1) };
    }
  }
  return { provider: DEFAULT_PROVIDER, upstreamPath: pathname };
}

async function forwardRequest(
  provider: Provider,
  path: string,
  method: string,
  headers: Record<string, string>,
  body: string,
  attempt = 0,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const rotator = getRotator(provider);
  const key = rotator.next();

  if (!key) {
    return {
      status: 503,
      body: JSON.stringify({ error: 'All API keys are rate limited. Try again later.' }),
      headers: { 'content-type': 'application/json' },
    };
  }

  const config = PROVIDER_CONFIGS[provider];
  const url = `${config.baseUrl}${path}`;
  const authHeaders = config.authHeader(key);

  // Strip hop-by-hop headers and inject auth
  const forwardHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...authHeaders,
  };

  try {
    const res = await fetch(url, {
      method,
      headers: forwardHeaders,
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
    });

    const responseBody = await res.text();
    logRequest(key, provider, res.status);

    if (res.status === 429 && attempt < MAX_RETRIES) {
      // Parse retry-after header if present
      const retryAfter = res.headers.get('retry-after');
      const cooldown = retryAfter ? parseInt(retryAfter, 10) : 3600;
      rotator.markLimited(key, cooldown);

      console.log(`[proxy] 429 on ${provider} key ...${key.slice(-8)} → rotating (attempt ${attempt + 1}/${MAX_RETRIES})`);
      return forwardRequest(provider, path, method, headers, body, attempt + 1);
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });

    return { status: res.status, body: responseBody, headers: responseHeaders };
  } catch (err) {
    return {
      status: 502,
      body: JSON.stringify({ error: `Upstream error: ${(err as Error).message}` }),
      headers: { 'content-type': 'application/json' },
    };
  }
}

export function createProxyServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const { provider, upstreamPath } = resolveProvider(url.pathname + url.search);

    // Collect body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString();

    const reqHeaders = req.headers as Record<string, string>;
    const result = await forwardRequest(
      provider,
      upstreamPath,
      req.method ?? 'GET',
      reqHeaders,
      body,
    );

    res.writeHead(result.status, result.headers);
    res.end(result.body);
  });
}

export function startProxy(): void {
  const server = createProxyServer();
  server.listen(PORT, () => {
    console.log(`[aido-proxy] Listening on http://localhost:${PORT}`);
    console.log(`[aido-proxy] Default provider: ${DEFAULT_PROVIDER}`);
    console.log(`[aido-proxy] Routes: /zen/v1/..., /openai/v1/..., /v1/... (→ ${DEFAULT_PROVIDER})`);
  });
}
