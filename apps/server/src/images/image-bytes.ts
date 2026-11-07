/**
 * What an uploaded file is, read from its own bytes (ADR-041): a store that
 * trusted `Content-Type` would serve anything a browser can be talked into
 * sniffing. Only JPEG and WebP pass, with the size their header declares.
 */

export type StoredImageType = 'image/jpeg' | 'image/webp';

/** Bytes on their own buffer, as bodies and digests take them. */
export type ImageBytes = Uint8Array<ArrayBuffer>;

export interface SniffedImage {
  readonly type: StoredImageType;
  readonly width: number;
  readonly height: number;
}

const ascii = (bytes: Uint8Array, at: number, text: string): boolean =>
  [...text].every((char, index) => bytes[at + index] === char.charCodeAt(0));

const u16be = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);

const u16le = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);

const u24le = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);

/** Start-of-frame markers: every coding but DHT (C4), JPG (C8) and DAC (CC). */
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const sniffJpeg = (bytes: Uint8Array): SniffedImage | null => {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    // Fill bytes before a marker.
    while (bytes[at] === 0xff && at < bytes.length) at += 1;
    const marker = bytes[at] ?? 0;
    at += 1;
    // Markers without a length.
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      continue;
    // Start of scan or end of image before any frame: no size to read.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = u16be(bytes, at);
    if (length < 2 || at + length > bytes.length) return null;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (length < 7) return null;
      const height = u16be(bytes, at + 3);
      const width = u16be(bytes, at + 5);
      return width > 0 && height > 0
        ? { type: 'image/jpeg', width, height }
        : null;
    }
    at += length;
  }
  return null;
};

const sniffWebp = (bytes: Uint8Array): SniffedImage | null => {
  if (bytes.length < 30 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP'))
    return null;
  // The RIFF size covers everything after its own 8 bytes.
  const riffSize =
    (bytes[4] ?? 0) |
    ((bytes[5] ?? 0) << 8) |
    ((bytes[6] ?? 0) << 16) |
    ((bytes[7] ?? 0) << 24);
  if (riffSize + 8 > bytes.length || riffSize < 22) return null;
  if (ascii(bytes, 12, 'VP8 ')) {
    // A key frame's start code, then 14-bit width and height.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a)
      return null;
    const width = u16le(bytes, 26) & 0x3fff;
    const height = u16le(bytes, 28) & 0x3fff;
    return width > 0 && height > 0
      ? { type: 'image/webp', width, height }
      : null;
  }
  if (ascii(bytes, 12, 'VP8L')) {
    if (bytes[20] !== 0x2f) return null;
    const bits =
      (bytes[21] ?? 0) |
      ((bytes[22] ?? 0) << 8) |
      ((bytes[23] ?? 0) << 16) |
      ((bytes[24] ?? 0) << 24);
    return {
      type: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  if (ascii(bytes, 12, 'VP8X')) {
    return {
      type: 'image/webp',
      width: u24le(bytes, 24) + 1,
      height: u24le(bytes, 27) + 1,
    };
  }
  return null;
};

/** The file's type and size, or null for anything but a JPEG or a WebP. */
export const sniffImage = (bytes: Uint8Array): SniffedImage | null =>
  sniffJpeg(bytes) ?? sniffWebp(bytes);

export const sha256Hex = async (bytes: ImageBytes): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
