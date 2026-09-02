import { describe, expect, it } from 'vitest';

import { WebCryptoAuthoritySource } from './authority-crypto.js';

describe('Web Crypto authority source', () => {
  it('creates bounded, unique, high-entropy capabilities and IDs', () => {
    const source = new WebCryptoAuthoritySource();
    const values = [
      source.nextSeatCapability(),
      source.nextSpectatorCapability(),
      source.nextAdmissionTicket(),
      source.nextResumeCapability(),
      source.nextSessionId(),
      source.nextOpaqueId('card'),
      source.nextOpaqueId('definition'),
      source.nextCardId(),
      source.nextStackId(),
      source.nextInspectionId(),
      source.nextWorkAreaId(),
    ];

    expect(new Set(values).size).toBe(values.length);
    expect(
      values.every((value) => value.length >= 24 && value.length <= 128)
    ).toBe(true);
  });

  it('hashes capabilities without retaining their content', async () => {
    const source = new WebCryptoAuthoritySource();
    const capability = source.nextResumeCapability();
    const digest = await source.digestCapability(capability);

    expect(digest).toHaveLength(43);
    expect(digest).not.toContain(capability);
    expect(source.equalDigest(digest, digest)).toBe(true);
    expect(source.equalDigest(digest, `${digest.slice(0, -1)}x`)).toBe(false);
    expect(source.equalDigest(digest, digest.slice(1))).toBe(false);
  });

  it('produces bounded integers and permutation-preserving shuffles', () => {
    const source = new WebCryptoAuthoritySource();
    for (const maximum of [1, 2, 3, 10, 257]) {
      const samples = Array.from({ length: 100 }, () =>
        source.randomInt(maximum)
      );
      expect(
        samples.every(
          (value) =>
            Number.isSafeInteger(value) && value >= 0 && value < maximum
        )
      ).toBe(true);
    }

    const input = Array.from({ length: 100 }, (_, index) => index);
    const shuffled = source.shuffle(input);
    expect([...shuffled].sort((left, right) => left - right)).toEqual(input);
    expect(input).toEqual(Array.from({ length: 100 }, (_, index) => index));
  });

  it('rejects invalid random bounds', () => {
    const source = new WebCryptoAuthoritySource();
    expect(() => source.randomInt(0)).toThrow(RangeError);
    expect(() => source.randomInt(2 ** 32 + 1)).toThrow(RangeError);
    expect(() => source.randomInt(1.5)).toThrow(RangeError);
  });
});
