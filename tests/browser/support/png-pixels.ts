import { inflateSync } from 'node:zlib';

/** A screenshot's pixels, row by row, `channels` bytes each. */
export interface PngPixels {
  readonly width: number;
  readonly height: number;
  /** 3 (RGB) or 4 (RGBA). */
  readonly channels: number;
  readonly data: Uint8Array;
}

/**
 * Reads the pixels of a Playwright screenshot: an 8-bit, non-interlaced RGB
 * or RGBA PNG. Read here rather than drawn into a canvas in the page, whose
 * image decode can stall a busy runner past a test's timeout.
 */
export const pngPixels = (png: Buffer): PngPixels => {
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colorType = body[9]!;
      interlace = body[12]!;
    } else if (type === 'IDAT') {
      compressed.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `Unexpected PNG: depth ${depth}, colour type ${colorType}, interlace ${interlace}`
    );
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = y * (stride + 1) + 1;
    const out = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? data[out + x - channels]! : 0;
      const up = y > 0 ? data[out - stride + x]! : 0;
      const corner =
        x >= channels && y > 0 ? data[out - stride + x - channels]! : 0;
      let value = raw[line + x]!;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const guess = left + up - corner;
        const toLeft = Math.abs(guess - left);
        const toUp = Math.abs(guess - up);
        const toCorner = Math.abs(guess - corner);
        value +=
          toLeft <= toUp && toLeft <= toCorner
            ? left
            : toUp <= toCorner
              ? up
              : corner;
      }
      data[out + x] = value & 255;
    }
  }
  return { width, height, channels, data };
};
