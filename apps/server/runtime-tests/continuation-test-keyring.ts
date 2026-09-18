const material = btoa(String.fromCharCode(...new Uint8Array(32).fill(29)))
  .replaceAll('+', '-')
  .replaceAll('/', '_')
  .replace(/=+$/u, '');

/** Deterministic local-only keyring injected solely into the workerd test pool. */
export const continuationTestKeyring = JSON.stringify({
  format: 'ptcgsim-continuation-keyring-v1',
  activeKeyId: 'runtime-test-key',
  keys: [{ id: 'runtime-test-key', material }],
});
