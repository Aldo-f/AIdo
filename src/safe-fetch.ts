/**
 * Safe fetch wrapper that handles Cloudflare IPv6 fallback issues.
 * 
 * Node.js 24's built-in fetch has issues with Cloudflare endpoints
 * (like opencode.ai). When IPv6 fails, it should fall back to IPv4,
 * but the default timeout is too short. This wrapper retries failed
 * requests with exponential backoff to work around this.
 * 
 * This mirrors what OpenCode SDK does:
 * @see https://github.com/opencode-ai/sdk/blob/main/src/client.js
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;

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
      return await globalThis.fetch(input, init);
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

      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
