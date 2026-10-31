import { describe, expect, it } from 'vitest';

import {
  CONTINUATION_KEYRING_FORMAT,
  MAX_CONTINUATION_DECRYPT_KEYS,
  MAX_CONTINUATION_KEYRING_CODE_UNITS,
  ContinuationConfigurationError,
  createContinuationCryptographyFromConfiguration,
} from './continuation-configuration.js';
import {
  WebCryptoContinuationCryptography,
  importContinuationEncryptionKey,
} from './continuation-custody.js';

const encodeKey = (byte: number): string =>
  btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');

const configuration = (
  activeKeyId = 'key-current',
  keys: readonly { readonly id: string; readonly material: string }[] = [
    { id: activeKeyId, material: encodeKey(1) },
  ]
): string =>
  JSON.stringify({
    format: CONTINUATION_KEYRING_FORMAT,
    activeKeyId,
    keys,
  });

const context = {
  saveId: 'A'.repeat(22),
  capabilityDigest: 'B'.repeat(43),
  createdAt: 2_000_000_000_000,
  expiresAt: 2_000_086_400_000,
};

describe('continuation keyring configuration', () => {
  it('imports the active key for encryption and prior keys for decryption', async () => {
    const oldKey = await importContinuationEncryptionKey(
      new Uint8Array(32).fill(2)
    );
    const oldCryptography = new WebCryptoContinuationCryptography(
      'key-old',
      new Map([['key-old', oldKey]])
    );
    const priorPlaintext = new TextEncoder().encode('prior ciphertext');
    const prior = await oldCryptography.seal(priorPlaintext, context);

    const rotated = await createContinuationCryptographyFromConfiguration(
      configuration('key-current', [
        { id: 'key-current', material: encodeKey(1) },
        { id: 'key-old', material: encodeKey(2) },
      ])
    );
    const current = await rotated.seal(
      new TextEncoder().encode('current ciphertext'),
      context
    );

    expect(current.keyId).toBe('key-current');
    await expect(rotated.open(prior, context)).resolves.toEqual(priorPlaintext);
  });

  it.each([
    { value: undefined, failure: 'missing' },
    { value: '', failure: 'missing' },
    {
      value: 'x'.repeat(MAX_CONTINUATION_KEYRING_CODE_UNITS + 1),
      failure: 'oversized',
    },
    { value: '{', failure: 'malformed' },
    { value: 'null', failure: 'invalid_keyring' },
    {
      value: JSON.stringify({
        format: 'ptcgsim-continuation-keyring-v2',
        activeKeyId: 'key-current',
        keys: [{ id: 'key-current', material: encodeKey(1) }],
      }),
      failure: 'unsupported_format',
    },
    {
      value: JSON.stringify({
        format: CONTINUATION_KEYRING_FORMAT,
        activeKeyId: 'key-current',
        keys: [],
        unexpected: true,
      }),
      failure: 'invalid_keyring',
    },
    {
      value: configuration('missing-active', [
        { id: 'key-current', material: encodeKey(1) },
      ]),
      failure: 'invalid_keyring',
    },
    {
      value: configuration('key-current', [
        { id: 'key-current', material: encodeKey(1) },
        { id: 'key-current', material: encodeKey(2) },
      ]),
      failure: 'invalid_keyring',
    },
    {
      value: configuration('key-current', [
        { id: 'key-current', material: encodeKey(1) },
        { id: 'key-old', material: encodeKey(1) },
      ]),
      failure: 'invalid_keyring',
    },
    {
      value: configuration(
        'key-current',
        Array.from(
          { length: MAX_CONTINUATION_DECRYPT_KEYS + 1 },
          (_, index) => ({
            id: index === 0 ? 'key-current' : `key-${index}`,
            material: encodeKey(index + 1),
          })
        )
      ),
      failure: 'invalid_keyring',
    },
    {
      value: configuration('key-current', [
        { id: 'key-current', material: `${'A'.repeat(42)}B` },
      ]),
      failure: 'invalid_keyring',
    },
  ])('fails closed for $failure configuration', async ({ value, failure }) => {
    const promise = createContinuationCryptographyFromConfiguration(value);
    await expect(promise).rejects.toMatchObject({ failure });
    await expect(promise).rejects.toBeInstanceOf(
      ContinuationConfigurationError
    );
  });

  it('never includes malformed secret material in its error', async () => {
    const secretSentinel = 'secret-key-material-that-must-not-be-reported';
    const invalid = configuration('key-current', [
      { id: 'key-current', material: secretSentinel },
    ]);

    const error = await createContinuationCryptographyFromConfiguration(
      invalid
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ContinuationConfigurationError);
    expect(String(error)).not.toContain(secretSentinel);
    expect(JSON.stringify(error)).not.toContain(secretSentinel);
  });
});
