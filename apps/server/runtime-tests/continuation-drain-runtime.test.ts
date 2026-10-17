import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RUNTIME_ORIGIN } from './runtime-harness.js';

const saveId = 'A'.repeat(22);
const capability = `ptcgsave.v1.${saveId}.${'B'.repeat(43)}`;

const jsonRequest = (
  path: string,
  method: 'DELETE' | 'POST',
  body: Record<string, unknown>
): Promise<Response> =>
  exports.default.fetch(
    new Request(`${RUNTIME_ORIGIN}${path}`, {
      method,
      headers: {
        'CF-Connecting-IP': '198.51.100.120',
        'Content-Type': 'application/json',
        Origin: RUNTIME_ORIGIN,
      },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('continuation HTTP rollout drain', () => {
  it('hides create and restore while retaining indistinguishable revocation', async () => {
    const creation = await jsonRequest(
      '/v2/rooms/BCDEFGHJ2345/continuations',
      'POST',
      {
        resumeToken: 'syntactically-valid-resume-capability-0000000001',
        operationId: 'C'.repeat(43),
      }
    );
    const restore = await jsonRequest(
      `/v2/continuations/${saveId}/restore`,
      'POST',
      { capability, operationId: 'R'.repeat(43) }
    );
    const revocation = await jsonRequest(
      `/v2/continuations/${saveId}`,
      'DELETE',
      { capability }
    );

    expect(creation.status).toBe(404);
    expect(await creation.text()).toBe('Not Found');
    expect(restore.status).toBe(404);
    expect(await restore.text()).toBe('Not Found');
    expect(revocation.status).toBe(204);
    expect(revocation.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    expect(await revocation.text()).toBe('');
  });

  it('keeps the exposed revoke path method-strict', async () => {
    const response = await jsonRequest(`/v2/continuations/${saveId}`, 'POST', {
      capability,
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('DELETE');
    expect(await response.json()).toEqual({ error: 'method_not_allowed' });
  });
});
