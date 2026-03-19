// Free model discovery module
// Automatically queries provider APIs to discover available free models

import { PROVIDER_CONFIGS, type Provider } from './detector.ts';
import { loadKeysForProvider } from './rotator.ts';
import { getFreeModels, saveFreeModels } from './db.ts';

/**
 * Represents a discovered free model
 */
export interface FreeModel {
  /** Model ID from the provider API */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Provider this model belongs to */
  provider: Provider;
  /** Whether this model is confirmed as free tier */
  isFree: boolean;
  /** Timestamp when this model was discovered */
  discoveredAt: number;
  /** Timestamp when this cache entry expires */
  expiresAt: number;
}

/**
 * Raw model data from provider API response
 */
export interface RawModel {
  id: string;
  name?: string;
  object?: string;
  owned_by?: string;
  // Additional provider-specific fields
  [key: string]: unknown;
}

/**
 * Provider API response structure
 */
export interface ProviderModels {
  object: string;
  data: RawModel[];
}

/**
 * Discovery result including free and paid models
 */
export interface DiscoveryResult {
  provider: Provider;
  freeModels: FreeModel[];
  paidModels: FreeModel[];
  totalModels: number;
  discoveredAt: number;
}

/**
 * Fetch models from a provider's API
 * @param provider - The provider to query
 * @returns Promise resolving to raw model data from the provider
 */
export async function fetchModels(provider: Provider): Promise<RawModel[]> {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const keys = loadKeysForProvider(provider);
  if (keys.length === 0) {
    throw new Error(`No keys configured for provider: ${provider}`);
  }

  const key = keys[0];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.authHeader(key),
  };

  const baseUrl = config.baseUrl;
  const modelsUrl = `${baseUrl}/models`;

  const response = await fetch(modelsUrl, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch models from ${provider}: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as ProviderModels;
  return data.data ?? [];
}

/**
 * Discover free models for a given provider
 * @param provider - The provider to query
 * @returns Promise resolving to array of free models
 */
export async function discoverFreeModels(provider: Provider): Promise<FreeModel[]> {
  // Check cache first
  const cachedModels = getFreeModels(provider);
  if (cachedModels.length > 0) {
    return cachedModels as FreeModel[];
  }
  
  // Cache miss - fetch from provider API
  const rawModels = await fetchModels(provider);
  if (rawModels.length === 0) {
    return [];
  }
  
  // Identify free models
  const freeModels = identifyFreeModels(provider, rawModels);
  
  // Save to cache
  if (freeModels.length > 0) {
    saveFreeModels(provider, freeModels);
  }
  
  return freeModels;
}

/**
 * Discover models for all configured providers
 * @returns Promise resolving to map of provider -> free models
 */
export async function discoverAllFreeModels(): Promise<Map<Provider, FreeModel[]>> {
  // This will be implemented in Task 6
  return new Map();
}

/**
 * Check if cached free models are expired for a provider
 * @param provider - The provider to check
 * @returns true if cache is expired or missing
 */
export function isCacheExpired(provider: Provider): boolean {
  // This will be implemented in Task 5
  return true;
}

/**
 * Manually refresh the free model cache for a provider
 * @param provider - The provider to refresh
 */
export async function refreshFreeModelCache(provider: Provider): Promise<void> {
  // This will be implemented in Task 6
}

/**
 * Manually refresh the free model cache for all configured providers
 */
export async function refreshAllFreeModelCaches(): Promise<void> {
  // This will be implemented in Task 6
}

// ─── Free Model Identification Rules ───────────────────────────────────────────

// Free model patterns for Zen (models ending with -free)
const ZEN_FREE_PATTERN = /-free$/;

// Special free models on Zen that don't follow the -free naming convention
const ZEN_SPECIAL_FREE_MODELS = new Set(['big-pickle']);

// Free model patterns for OpenRouter (models ending with :free)
const OPENROUTER_FREE_PATTERN = /:free$/;

// Free Gemini models on Google (Flash models have free tier)
const GOOGLE_FREE_PATTERNS = [
  /gemini-[\d.]+-flash/i,
  /gemini-[\d.]+-flash-lite/i,
  /gemini-exp/i,
];

// Free model patterns for Groq (Groq offers free access to models)
const GROQ_FREE_PATTERNS = [
  /^llama-[\d.]+-/,
  /^mixtral-/,
  /^gemma[\d]?-/,
  /^qwen-/,
];

function isZenFree(modelId: string): boolean {
  return ZEN_SPECIAL_FREE_MODELS.has(modelId) || ZEN_FREE_PATTERN.test(modelId);
}

function isOpenRouterFree(modelId: string): boolean {
  return OPENROUTER_FREE_PATTERN.test(modelId);
}

function isGoogleFree(modelId: string): boolean {
  return GOOGLE_FREE_PATTERNS.some(pattern => pattern.test(modelId));
}

function isGroqFree(modelId: string): boolean {
  return GROQ_FREE_PATTERNS.some(pattern => pattern.test(modelId));
}

export function identifyFreeModels(provider: Provider, models: RawModel[]): FreeModel[] {
  const now = Date.now();
  const defaultCacheDuration = 60 * 60 * 1000;

  return models.map(model => {
    const modelId = model.id;
    let isFree = false;

    switch (provider) {
      case 'zen':
        isFree = isZenFree(modelId);
        break;

      case 'openrouter':
        isFree = isOpenRouterFree(modelId);
        break;

      case 'google':
        isFree = isGoogleFree(modelId);
        break;

      case 'groq':
        isFree = isGroqFree(modelId);
        break;

      case 'ollama-local':
        // Local Ollama is always free
        isFree = true;
        break;

      case 'ollama':
        // Ollama Cloud: unknown free status, default to false
        isFree = false;
        break;

      case 'openai':
      case 'anthropic':
        // OpenAI and Anthropic have no free tier
        isFree = false;
        break;

      default:
        // Unknown provider, assume not free
        isFree = false;
    }

    return {
      id: modelId,
      name: model.name ?? modelId,
      provider,
      isFree,
      discoveredAt: now,
      expiresAt: now + defaultCacheDuration,
    };
  });
}
