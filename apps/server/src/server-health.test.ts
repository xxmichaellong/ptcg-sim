import { describe, expect, it } from 'vitest';

import { handleServerHealthRequest } from './server-health.js';

describe('server health boundary', () => {
  it('returns only public build and schema health metadata', async () => {
    const response = handleServerHealthRequest(
      new Request('https://play.example/v2/health'),
      'build-abc.123'
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      buildId: 'build-abc.123',
      protocolVersion: 2,
      authoritySchemaVersion: 6,
      matchStateSchemaVersion: 2,
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('rejects unsafe methods, queries, and build identifiers', async () => {
    const wrongMethod = handleServerHealthRequest(
      new Request('https://play.example/v2/health', { method: 'POST' }),
      'build'
    );
    const query = handleServerHealthRequest(
      new Request('https://play.example/v2/health?secret=forbidden'),
      'build'
    );
    const unsafeBuild = handleServerHealthRequest(
      new Request('https://play.example/v2/health'),
      'credential\nmaterial'
    );

    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('Allow')).toBe('GET');
    expect(query.status).toBe(400);
    expect(await unsafeBuild.json()).toMatchObject({
      buildId: 'invalid-build',
    });
  });
});
