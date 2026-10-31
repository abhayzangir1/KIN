import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RadixRouter, HttpMethod } from '../src/server/fast_router.js';

describe('RadixRouter Fast Trie Routing', () => {
  it('registers and matches static routes', () => {
    const router = new RadixRouter();
    const handler = vi.fn();
    router.register('GET', '/api/health', handler);

    const match = router.match('GET', '/api/health');
    expect(match).not.toBeNull();
    expect(match?.params).toEqual({});
  });

  it('registers and matches parameterized routes with parameters extracted', () => {
    const router = new RadixRouter();
    const handler = vi.fn();
    router.register('GET', '/api/projects/:id/agents', handler);

    const match = router.match('GET', '/api/projects/proj-123/agents');
    expect(match).not.toBeNull();
    expect(match?.params.id).toBe('proj-123');
  });

  it('registers and matches multiple parameters', () => {
    const router = new RadixRouter();
    const handler = vi.fn();
    router.register('DELETE', '/api/projects/:id/uploads/:uploadId', handler);

    const match = router.match('DELETE', '/api/projects/p-1/uploads/up-99');
    expect(match).not.toBeNull();
    expect(match?.params.id).toBe('p-1');
    expect(match?.params.uploadId).toBe('up-99');
  });

  it('supports legacy aliases pointing to canonical handlers', () => {
    const router = new RadixRouter();
    const canonicalHandler = vi.fn();
    router.register('GET', '/api/health', canonicalHandler);
    router.registerAlias('GET', '/health', '/api/health', canonicalHandler);

    const match = router.match('GET', '/health');
    expect(match).not.toBeNull();
    expect(match?.handler).toBe(canonicalHandler);
  });

  it('returns null for unmatched routes or mismatched methods', () => {
    const router = new RadixRouter();
    router.register('GET', '/api/health', vi.fn());

    expect(router.match('POST', '/api/health')).toBeNull();
    expect(router.match('GET', '/api/nonexistent')).toBeNull();
  });

  it('dispatches matched routes with full context', async () => {
    const router = new RadixRouter();
    let capturedId = '';
    router.register('GET', '/api/projects/:id', (ctx) => {
      capturedId = ctx.params.id;
    });

    const mockReq = { method: 'GET' } as IncomingMessage;
    const mockRes = {} as ServerResponse;
    const parsedUrl = new URL('http://localhost:3000/api/projects/proj-abc?tab=overview');

    const dispatched = await router.dispatch(mockReq, mockRes, '/api/projects/proj-abc', parsedUrl);
    expect(dispatched).toBe(true);
    expect(capturedId).toBe('proj-abc');
  });
});
