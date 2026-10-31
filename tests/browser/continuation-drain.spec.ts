import { expect, test } from '@playwright/test';

const saveId = 'A'.repeat(22);
const capability = `ptcgsave.v1.${saveId}.${'B'.repeat(43)}`;

test('rollout drain hides create and restore while retaining revoke', async ({
  request,
}) => {
  const health = await request.get('/v2/health');
  expect(health.status()).toBe(200);
  expect(health.headers()['cache-control']).toContain('no-store');
  const origin = new URL(health.url()).origin;
  const headers = { 'Content-Type': 'application/json', Origin: origin };

  const creation = await request.post('/v2/rooms/BCDEFGHJ2345/continuations', {
    headers,
    data: {
      resumeToken: 'syntactically-valid-resume-capability-0000000001',
      operationId: 'C'.repeat(43),
    },
  });
  const restore = await request.post(`/v2/continuations/${saveId}/restore`, {
    headers,
    data: { capability, operationId: 'R'.repeat(43) },
  });
  const revocation = await request.delete(`/v2/continuations/${saveId}`, {
    headers,
    data: { capability },
  });

  expect(creation.status()).toBe(404);
  expect(await creation.text()).toBe('Not Found');
  expect(restore.status()).toBe(404);
  expect(await restore.text()).toBe('Not Found');
  expect(revocation.status()).toBe(204);
  expect(revocation.headers()['cache-control']).toBe('no-store, max-age=0');
  expect(await revocation.text()).toBe('');
});
