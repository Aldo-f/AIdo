import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { safeFetch } = await import('../src/safe-fetch.js');

describe('safeFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes timeout:false to fetch when called with url and init', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await safeFetch('https://example.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    // Should be called with (url, init) where init has timeout: false
    expect(callArgs[0]).toBe('https://example.com/api');
    expect((callArgs[1] as Record<string, unknown>).timeout).toBe(false);
    expect((callArgs[1] as RequestInit).method).toBe('POST');
    expect((callArgs[1] as RequestInit).body).toBe(JSON.stringify({ test: true }));
  });

  it('passes Request objects through to fetch without modification', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const req = new Request('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
    });

    await safeFetch(req);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledReq = mockFetch.mock.calls[0][0] as Request;
    // Request is passed through as-is (no timeout modification)
    expect(calledReq).toBe(req);
    expect(calledReq.method).toBe('POST');
  });

  it('preserves all init options when calling fetch', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await safeFetch('https://example.com/api', {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer test-key',
        'X-Custom': 'value',
      },
      body: 'test body',
    });

    const callArgs = mockFetch.mock.calls[0];
    expect((callArgs[1] as RequestInit).method).toBe('PUT');
    expect((callArgs[1] as RequestInit).headers).toEqual({
      'Authorization': 'Bearer test-key',
      'X-Custom': 'value',
    });
    expect((callArgs[1] as RequestInit).body).toBe('test body');
  });
});
