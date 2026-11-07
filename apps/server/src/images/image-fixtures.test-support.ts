/** The smallest files whose headers name a picture of the given size. */

export const webpLossless = (
  width: number,
  height: number,
  padding = 0
): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(30 + padding);
  bytes.set(
    [...'RIFF'].map((char) => char.charCodeAt(0)),
    0
  );
  const riffSize = bytes.length - 8;
  bytes.set(
    [riffSize & 0xff, (riffSize >> 8) & 0xff, (riffSize >> 16) & 0xff, 0],
    4
  );
  bytes.set(
    [...'WEBPVP8L'].map((char) => char.charCodeAt(0)),
    8
  );
  const chunk = bytes.length - 20;
  bytes.set([chunk & 0xff, (chunk >> 8) & 0xff, (chunk >> 16) & 0xff, 0], 16);
  bytes[20] = 0x2f;
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  bytes.set(
    [
      bits & 0xff,
      (bits >>> 8) & 0xff,
      (bits >>> 16) & 0xff,
      (bits >>> 24) & 0xff,
    ],
    21
  );
  return bytes;
};

export const webpLossy = (
  width: number,
  height: number
): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(40);
  bytes.set(
    [...'RIFF'].map((char) => char.charCodeAt(0)),
    0
  );
  bytes.set([32, 0, 0, 0], 4);
  bytes.set(
    [...'WEBPVP8 '].map((char) => char.charCodeAt(0)),
    8
  );
  bytes.set([20, 0, 0, 0], 16);
  // Frame tag (3), start code (3), 14-bit width and height.
  bytes.set([0x9d, 0x01, 0x2a], 23);
  bytes.set(
    [width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f],
    26
  );
  return bytes;
};

export const webpExtended = (
  width: number,
  height: number
): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(40);
  bytes.set(
    [...'RIFF'].map((char) => char.charCodeAt(0)),
    0
  );
  bytes.set([32, 0, 0, 0], 4);
  bytes.set(
    [...'WEBPVP8X'].map((char) => char.charCodeAt(0)),
    8
  );
  bytes.set([10, 0, 0, 0], 16);
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return bytes;
};

export const jpeg = (width: number, height: number): Uint8Array<ArrayBuffer> =>
  new Uint8Array([
    0xff,
    0xd8,
    // APP0 (JFIF), 16 bytes with its length.
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    // SOF0: length 17, precision 8, height, width, three components.
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);
