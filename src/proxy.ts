import http from 'http';
import { PROVIDER_CONFIGS, type Provider } from './detector.js';
import { getRotator } from './rotator.js';
import { logRequest } from './db.js';
import { toOllamaBody, fromOllamaResponse, toOllamaPath } from './ollama.js';
import { forwardAuto } from './auto.js';
import { routeAidoModel } from './models/router.js';

const DEFAULT_PROVIDER: Provider =
  (process.env.DEFAULT_PROVIDER as Provider) ?? 'zen';

const PORT = parseInt(process.env.PROXY_PORT ?? '4141', 10);
const MAX_RETRIES = 3;

function isAidoPath(pathname: string): boolean {
  const clean = pathname.trim().replace(/^\/+|\/+$/g, '');
  return clean.toLowerCase().startsWith('aido');
}

export function resolveProvider(pathname: string): { provider: Provider | 'auto'; upstreamPath: string; isAidoAuto?: boolean; model?: string } {
  if (pathname.startsWith('/auto/')) {
    return { provider: 'auto', upstreamPath: pathname.slice('/auto'.length) };
  }
  
  if (isAidoPath(pathname)) {
    const v1Index = pathname.indexOf('/v1/');
    let aidoPath: string;
    let restPath: string;
    
    if (v1Index !== -1) {
      aidoPath = pathname.slice(1, v1Index);
      restPath = pathname.slice(v1Index + 1);
    } else {
      const slashIndex = pathname.indexOf('/', 1);
      aidoPath = slashIndex === -1 ? pathname.slice(1) : pathname.slice(1, slashIndex);
      restPath = slashIndex === -1 ? '' : pathname.slice(slashIndex);
    }
    
    const route = routeAidoModel(aidoPath);
    return { 
      provider: route.provider, 
      upstreamPath: restPath || '/v1/chat/completions',
      isAidoAuto: route.isAuto,
      model: route.model,
    };
  }
  
  const known: Provider[] = ['ollama-local', 'ollama', 'zen', 'openai', 'anthropic', 'groq', 'google'];
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
  const isOllama = config.nativeFormat === true;

  const upstreamPath = isOllama ? toOllamaPath(path) : path;
  const upstreamBody = isOllama && method !== 'GET' ? toOllamaBody(body) : body;
  const url = `${config.baseUrl}${upstreamPath}`;

  const forwardHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...config.authHeader(key),
  };

  try {
    const res = await fetch(url, {
      method,
      headers: forwardHeaders,
      body: method !== 'GET' && method !== 'HEAD' ? upstreamBody : undefined,
    });

    const rawBody = await res.text();
    const responseBody = isOllama ? fromOllamaResponse(rawBody) : rawBody;
    logRequest(key, provider, res.status);

    if (res.status === 404 && provider === 'ollama-local') {
      let model = '(unknown)';
      try { model = (JSON.parse(upstreamBody) as { model?: string }).model ?? model; } catch { /* ok */ }
      return {
        status: 404,
        body: JSON.stringify({
          error: `Model "${model}" not found in local Ollama. Run: ollama pull ${model}`,
        }),
        headers: { 'content-type': 'application/json' },
      };
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = res.headers.get('retry-after');
      const cooldown = retryAfter ? parseInt(retryAfter, 10) : 3600;
      rotator.markLimited(key, cooldown);
      console.log(`[proxy] 429 on ${provider} key ...${key.slice(-8)} → rotating (attempt ${attempt + 1}/${MAX_RETRIES})`);
      return forwardRequest(provider, path, method, headers, body, attempt + 1);
    }

    const responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
    res.headers.forEach((value, name) => {
      if (name !== 'content-type') responseHeaders[name] = value;
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
    const { provider, upstreamPath, isAidoAuto } = resolveProvider(url.pathname + url.search);

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString();

    const result = provider === 'auto' || isAidoAuto
      ? await forwardAuto(upstreamPath, req.method ?? 'GET', body)
      : await forwardRequest(provider, upstreamPath, req.method ?? 'GET', req.headers as Record<string, string>, body);

    res.writeHead(result.status, result.headers);
    res.end(result.body);
  });
}

export function startProxy(): void {
  const server = createProxyServer();
  server.listen(PORT, () => {
    console.log(`[aido-proxy] Listening on http://localhost:${PORT}`);
    console.log(`[aido-proxy] Routes:`);
    console.log(`             /auto/v1/...       → auto (legacy)`);
    console.log(`             /aido/auto/...     → auto (tries all providers in order)`);
    console.log(`             /aido/cloud/...    → cloud (zen → groq → openai → anthropic)`);
    console.log(`             /aido/local/...   → local ollama`);
    console.log(`             /aido/<provider>/... → specific provider`);
    console.log(`             /v1/...            → ${DEFAULT_PROVIDER} (default)`);
    console.log(`             /ollama-local/...  → Local Ollama`);
    console.log(`             /ollama/...        → Ollama Cloud`);
    console.log(`             /zen/v1/...        → OpenCode Zen`);
  });
}
