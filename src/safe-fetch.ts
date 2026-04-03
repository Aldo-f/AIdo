/**
 * Safe fetch wrapper that handles Cloudflare IPv6 fallback issues
 * and transient network errors with exponential backoff.
 * 
 * Node.js 24's built-in fetch has issues with Cloudflare endpoints
 * (like opencode.ai). When IPv6 fails, it should fall back to IPv4,
 * but the default timeout is too short. This wrapper retries failed
 * requests with exponential backoff to work around this.
 * 
 * 429 responses are NOT retried here - they are handled by the key
 * rotation logic which can try different keys/models.
 * 
 * This mirrors what OpenCode SDK does:
 * @see https://github.com/opencode-ai/sdk/blob/main/src/client.js
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;
const MAX_DELAY_MS = 5000;

export async function safeFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // If input is already a Request, fetch it directly without modification
  if (input instanceof Request) {
    return fetchWithRetry(input);
  }

  // For URL + init, pass through directly with timeout:false
  return fetchWithRetry(input, {
    ...init,
    timeout: false,
  } as RequestInit);
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await globalThis.fetch(input, init);

      // Don't retry 429 here - let key rotation handle it
      // (rate limiting is per model, not per key)
      if (response.status === 429) {
        return response;
      }

      return response;
    } catch (err) {
      lastError = err as Error;
      const cause = (err as Error).cause as { code?: string } | undefined;
      const isNetworkError = cause?.code === 'ETIMEDOUT' ||
        cause?.code === 'ECONNREFUSED' ||
        cause?.code === 'ENETUNREACH' ||
        (err as Error).message.includes('fetch failed');

      if (!isNetworkError || attempt === MAX_RETRIES) {
        throw err;
      }

      const delay = calculateBackoff(attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

function calculateBackoff(attempt: number): number {
  // Exponential backoff with jitter
  const base = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  const jitter = Math.random() * base * 0.5;
  return base + jitter;
}
