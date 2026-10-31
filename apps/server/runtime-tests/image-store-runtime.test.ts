import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://play.example';

/** A lossless WebP header naming a 600×838 picture, with some padding. */
const webp = (salt: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(64);
  bytes.set(
    [...'RIFF'].map((char) => char.charCodeAt(0)),
    0
  );
  bytes.set([56, 0, 0, 0], 4);
  bytes.set(
    [...'WEBPVP8L'].map((char) => char.charCodeAt(0)),
    8
  );
  bytes.set([44, 0, 0, 0], 16);
  bytes[20] = 0x2f;
  const bits = (600 - 1) | ((838 - 1) << 14);
  bytes.set(
    [
      bits & 0xff,
      (bits >>> 8) & 0xff,
      (bits >>> 16) & 0xff,
      (bits >>> 24) & 0xff,
    ],
    21
  );
  bytes[63] = salt;
  return bytes;
};

const upload = (bytes: Uint8Array<ArrayBuffer>, origin = ORIGIN) =>
  exports.default.fetch(
    new Request(`${ORIGIN}/v2/images`, {
      method: 'POST',
      body: bytes,
      headers: { Origin: origin, 'Content-Type': 'image/webp' },
    })
  );

describe('the image store, through the Worker', () => {
  it('stores an uploaded picture once and serves it from its own origin', async () => {
    const bytes = webp(1);
    const first = await upload(bytes);
    expect(first.status).toBe(201);
    const { ref } = await first.json<{ ref: string }>();
    expect(ref).toMatch(/^img:[0-9a-f]{64}$/u);
    const again = await upload(bytes);
    expect(await again.json()).toEqual({ ref });

    const served = await exports.default.fetch(
      new Request(`${ORIGIN}/v2/images/${ref.slice(4)}`)
    );
    expect(served.status).toBe(200);
    expect(served.headers.get('Content-Type')).toBe('image/webp');
    expect(served.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect([...new Uint8Array(await served.arrayBuffer())]).toEqual([...bytes]);
  });

  it('refuses another site and a file that is no picture it keeps', async () => {
    expect((await upload(webp(2), 'https://elsewhere.example')).status).toBe(
      403
    );
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"/>'
    );
    expect((await upload(svg)).status).toBe(415);
    expect(
      (
        await exports.default.fetch(
          new Request(`${ORIGIN}/v2/images/${'0'.repeat(64)}`)
        )
      ).status
    ).toBe(404);
  });

  it('bans a picture by its hash: neither served again, even after it was, nor taken again', async () => {
    const bytes = webp(3);
    const { ref } = await (await upload(bytes)).json<{ ref: string }>();
    const sha256 = ref.slice(4);
    // Served once: no copy may outlive a ban at the edge.
    expect(
      (
        await exports.default.fetch(
          new Request(`${ORIGIN}/v2/images/${sha256}`)
        )
      ).status
    ).toBe(200);
    const store = env.PTCG_IMAGE_STORE.getByName(`images-${sha256.charAt(0)}`);
    // Moderation is by RPC only: no route bans a picture.
    await store.block(sha256);
    expect(
      (
        await exports.default.fetch(
          new Request(`${ORIGIN}/v2/images/${sha256}`)
        )
      ).status
    ).toBe(404);
    const refused = await upload(bytes);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'image_blocked' });
  });
});
