import { describe, expect, it } from 'vitest';

import { sha256Hex, sniffImage } from './image-bytes.js';
import {
  jpeg,
  webpExtended,
  webpLossless,
  webpLossy,
} from './image-fixtures.test-support.js';

describe('sniffImage', () => {
  it('reads a JPEG and each kind of WebP with the size its header declares', () => {
    expect(sniffImage(jpeg(600, 838))).toEqual({
      type: 'image/jpeg',
      width: 600,
      height: 838,
    });
    expect(sniffImage(webpLossless(600, 838))).toEqual({
      type: 'image/webp',
      width: 600,
      height: 838,
    });
    expect(sniffImage(webpLossy(512, 715))).toEqual({
      type: 'image/webp',
      width: 512,
      height: 715,
    });
    expect(sniffImage(webpExtended(1000, 1400))).toEqual({
      type: 'image/webp',
      width: 1000,
      height: 1400,
    });
  });

  it('refuses anything else, whatever it claims to be', () => {
    const text = new TextEncoder();
    for (const bytes of [
      new Uint8Array(0),
      text.encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      text.encode('<html><script>alert(1)</script></html>'),
      // A PNG and a GIF: real pictures, but not ones the store keeps.
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
      text.encode('GIF89a\u0001\u0000\u0001\u0000'),
      // A JPEG cut off before its frame header, and one with none.
      jpeg(600, 838).slice(0, 22),
      new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]),
      // A WebP whose RIFF size claims more than there is.
      (() => {
        const bytes = webpLossless(10, 10);
        bytes[4] = 0xff;
        return bytes;
      })(),
      // A lossy WebP without its key frame's start code.
      (() => {
        const bytes = webpLossy(10, 10);
        bytes[23] = 0;
        return bytes;
      })(),
    ]) {
      expect(sniffImage(bytes)).toBeNull();
    }
  });
});

describe('sha256Hex', () => {
  it('names bytes by their SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});
