import fs from 'fs';
import path from 'path';
import os from 'os';

const PROXY_BASE = 'http://localhost:4141';

async function fetchLocalOllamaModels(): Promise<Record<string, { name: string }>> {
  const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return fallbackLocalModels();
    const json = await res.json() as { models?: Array<{ name: string }> };
    const models = json.models ?? [];
    if (models.length === 0) return fallbackLocalModels();
    return Object.fromEntries(
      models.map(m => [m.name, { name: m.name + ' (local)' }])
    );
  } catch {
    return fallbackLocalModels();
  }
}

function fallbackLocalModels(): Record<string, { name: string }> {
  return {
    'qwen3:8b': { name: 'Qwen3 8B (local)' },
    'glm-4.7-flash': { name: 'GLM-4.7 Flash (local)' },
  };
}

// ─── Claude Code ───────────────────────────────────────────────────────────────
// Claude Code respects ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY env vars.
// We write a shell snippet the user can source, and optionally patch .bashrc/.zshrc

function launchClaudeCode(port: number): void {
  const base = `http://localhost:${port}/anthropic`;
  const snippet = [
    `export ANTHROPIC_BASE_URL="${base}"`,
    `export ANTHROPIC_API_KEY="aido-proxy"  # key injected by proxy`,
  ].join('\n');

  console.log('\n── Claude Code ───────────────────────────────────────────');
  console.log('Add to your shell profile (or run now):\n');
  console.log(snippet);

  // Try to write to shell profile
  const profile = getShellProfile();
  if (profile && patchShellProfile(profile, snippet)) {
    console.log(`\n✓ Patched ${profile}`);
    console.log('  Restart your terminal or run: source ' + profile);
  }
}

// ─── OpenCode ──────────────────────────────────────────────────────────────────
// OpenCode config: ~/.config/opencode/opencode.json
// Schema: https://opencode.ai/config.json
// Custom provider needs: npm, name, options.baseURL, options.apiKey, models

interface OpenCodeProviderConfig {
  npm: string;
  name: string;
  options: { baseURL: string; apiKey: string };
  models: Record<string, { name: string }>;
}

interface OpenCodeConfig {
  $schema?: string;
  model?: string;
  provider?: Record<string, OpenCodeProviderConfig>;
  [key: string]: unknown;
}

// Free models on OpenCode Zen (from /zen/v1/models)
const ZEN_FREE_MODELS: Record<string, string> = {
  'big-pickle':          'Big Pickle (Free)',
  'mimo-v2-flash-free':  'MiMo V2 Flash (Free)',
  'nemotron-3-super-free': 'Nemotron 3 Super (Free)',
  'minimax-m2.5-free':   'MiniMax M2.5 (Free)',
};

async function launchOpenCode(port: number): Promise<void> {
  const configDir = path.join(os.homedir(), '.config', 'opencode');
  const configPath = path.join(configDir, 'opencode.json');

  let config: OpenCodeConfig = { $schema: 'https://opencode.ai/config.json' };
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      console.warn(`[launch] Could not parse ${configPath}, creating fresh config`);
    }
  }

  config.$schema ??= 'https://opencode.ai/config.json';
  config.provider ??= {};

  // aido/auto — meta-model, tries all providers in order automatically
  config.provider['aido-auto'] = {
    npm: '@ai-sdk/openai-compatible',
    name: 'AIdo → Auto (all providers)',
    options: {
      baseURL: `http://localhost:${port}/aido/auto/v1`,
      apiKey: 'aido-proxy',
    },
    models: {
      'auto': { name: '⚡ Auto (best available)' },
    },
  };

  // aido/cloud — all cloud providers (zen → groq → openai → anthropic)
  config.provider['aido-cloud'] = {
    npm: '@ai-sdk/openai-compatible',
    name: 'AIdo → Cloud (all cloud providers)',
    options: {
      baseURL: `http://localhost:${port}/aido/cloud/v1`,
      apiKey: 'aido-proxy',
    },
    models: {
      'cloud': { name: '☁️ Cloud Auto' },
    },
  };

  // Zen free tier via aido proxy
  config.provider['aido'] = {
    npm: '@ai-sdk/openai-compatible',
    name: 'AIdo → Zen (free)',
    options: {
      baseURL: `http://localhost:${port}/aido/zen/v1`,
      apiKey: 'aido-proxy',
    },
    models: Object.fromEntries(
      Object.entries(ZEN_FREE_MODELS).map(([id, name]) => [id, { name }]),
    ),
  };

  // Fetch local Ollama models dynamically
  const localModels = await fetchLocalOllamaModels();

  // Ollama Cloud via aido proxy
  config.provider['aido-ollama'] = {
    npm: '@ai-sdk/openai-compatible',
    name: 'AIdo → Ollama Cloud',
    options: {
      baseURL: `http://localhost:${port}/aido/ollama/v1`,
      apiKey: 'aido-proxy',
    },
    models: {
      'glm-5:cloud':        { name: 'GLM-5 Cloud' },
      'kimi-k2.5:cloud':    { name: 'Kimi K2.5 Cloud' },
      'minimax-m2.5:cloud': { name: 'MiniMax M2.5 Cloud' },
    },
  };

  // Local Ollama via aido proxy (no auth, locally downloaded models)
  config.provider['aido-local'] = {
    npm: '@ai-sdk/openai-compatible',
    name: 'AIdo → Local Ollama',
    options: {
      baseURL: `http://localhost:${port}/aido/local/v1`,
      apiKey: 'aido-proxy',
    },
    models: localModels,
  };

  // Set default model to auto if not already set
  config.model ??= 'aido-auto/auto';

  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log('\n── OpenCode ──────────────────────────────────────────────');
  console.log(`✓ Wrote ${configPath}`);
  console.log(`  aido-auto    → Auto (tries all providers) ← default`);
  console.log(`  aido-cloud  → Cloud (zen → groq → openai → anthropic)`);
  console.log(`  aido        → Zen (big-pickle, mimo-v2-flash-free, ...)`);
  console.log(`  aido-ollama → Ollama Cloud (glm-5:cloud, kimi-k2.5:cloud, ...)`);
  console.log(`  aido-local  → Local Ollama (${Object.keys(localModels).join(', ')})`);
  console.log(`\n  In OpenCode: /models → select aido-auto for fully automatic routing`);
  console.log(`  Note: aido-local models only work if downloaded via 'ollama pull <model>'`);
  console.log('  Restart OpenCode to apply changes.');
}

// ─── Shell profile helpers ─────────────────────────────────────────────────────

function getShellProfile(): string | null {
  const shell = process.env.SHELL ?? '';
  const home = os.homedir();
  if (shell.includes('zsh')) return path.join(home, '.zshrc');
  if (shell.includes('bash')) return path.join(home, '.bashrc');
  return null;
}

const MARKER = '# aido-proxy config';

function patchShellProfile(profile: string, snippet: string): boolean {
  try {
    let content = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf8') : '';

    // Remove previous block if present
    const markerStart = content.indexOf(MARKER);
    if (markerStart !== -1) {
      const markerEnd = content.indexOf(MARKER, markerStart + 1);
      content = content.slice(0, markerStart) + content.slice(markerEnd + MARKER.length + 1);
    }

    content += `\n${MARKER}\n${snippet}\n${MARKER}\n`;
    fs.writeFileSync(profile, content);
    return true;
  } catch {
    return false;
  }
}

// ─── Entry ─────────────────────────────────────────────────────────────────────

export interface LaunchOptions {
  port: number;
  target: 'all' | 'claude' | 'opencode';
}

export async function launch(opts: LaunchOptions): Promise<void> {
  const { port, target } = opts;

  console.log(`[launch] Configuring tools to use proxy at http://localhost:${port}`);

  if (target === 'all' || target === 'claude') {
    launchClaudeCode(port);
  }
  if (target === 'all' || target === 'opencode') {
    await launchOpenCode(port);
  }
  console.log('\n✓ Done. Start the proxy with: aido-proxy proxy');
}
