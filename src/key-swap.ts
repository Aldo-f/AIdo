import fs from 'fs';
import path from 'path';
import os from 'os';
import { readEnvFile } from './env.ts';
import { validateKey } from './hunt.ts';

export interface SwapResult {
  workingKey: string | null;
  updated: boolean;
  message: string;
}

const OPENCODE_CONFIG_PATH = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

interface ProviderConfig {
  options?: {
    apiKey?: string;
  };
  baseURL?: string;
}

interface OpenCodeConfig {
  provider?: Record<string, ProviderConfig>;
}

function findOpenCodeProvider(config: OpenCodeConfig): { name: string; config: ProviderConfig } | null {
  const providers = config.provider;
  if (!providers) return null;

  for (const [name, providerConfig] of Object.entries(providers)) {
    if (name.toLowerCase().includes('opencode')) {
      return { name, config: providerConfig };
    }

    if (providerConfig.baseURL === 'https://opencode.ai/zen/v1') {
      return { name, config: providerConfig };
    }
  }

  return null;
}

export async function swapOpenCodeZenKey(): Promise<SwapResult> {
  const envMap = readEnvFile();
  const opencodeKeys = envMap.get('OPENCODE_ZEN_KEYS') || envMap.get('OPENCODE_KEYS');

  if (!opencodeKeys) {
    return {
      workingKey: null,
      updated: false,
      message: 'No OPENCODE_KEYS found in .env file',
    };
  }

  const keys = opencodeKeys.split(',').map((k) => k.trim()).filter(Boolean);

  if (keys.length === 0) {
    return {
      workingKey: null,
      updated: false,
      message: 'OPENCODE_KEYS is empty in .env file',
    };
  }

  let workingKey: string | null = null;

  for (const key of keys) {
    const isValid = await validateKey(key, 'opencode');
    if (isValid) {
      workingKey = key;
      break;
    }
  }

  if (!workingKey) {
    return {
      workingKey: null,
      updated: false,
      message: 'No working key found in OPENCODE_KEYS',
    };
  }

  if (!fs.existsSync(OPENCODE_CONFIG_PATH)) {
    return {
      workingKey,
      updated: false,
      message: `OpenCode config not found at ${OPENCODE_CONFIG_PATH}`,
    };
  }

  try {
    const configContent = fs.readFileSync(OPENCODE_CONFIG_PATH, 'utf8');
    const config: OpenCodeConfig = JSON.parse(configContent);

    const providerEntry = findOpenCodeProvider(config);

    if (!providerEntry) {
      return {
        workingKey,
        updated: false,
        message: 'No OpenCode provider found in config',
      };
    }

    const { name: providerName } = providerEntry;

    if (!config.provider) {
      return {
        workingKey,
        updated: false,
        message: 'Provider configuration is missing',
      };
    }

    if (!config.provider[providerName]) {
      config.provider[providerName] = {};
    }

    if (!config.provider[providerName].options) {
      config.provider[providerName].options = {};
    }

    const currentKey = config.provider[providerName].options?.apiKey;
    
    if (currentKey === workingKey) {
      return {
        workingKey,
        updated: false,
        message: 'Config already has the working key',
      };
    }

    config.provider[providerName].options!.apiKey = workingKey;

    fs.writeFileSync(OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');

    return {
      workingKey,
      updated: true,
      message: `Successfully updated OpenCode config with working key`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      workingKey,
      updated: false,
      message: `Failed to update config: ${message}`,
    };
  }
}
