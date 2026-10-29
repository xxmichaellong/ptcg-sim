import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { sha256Hex } from './image-bytes.js';
import { jpeg, webpLossless } from './image-fixtures.test-support.js';
import {
  ImageStoreSql,
  imageStoreName,
  MAX_IMAGE_UPLOAD_BYTES,
  type ImageSql,
} from './image-store.js';

/** A Durable Object's `sql.exec`, over Node's SQLite. */
const memorySql = (): ImageSql & {
  readonly rows: (table: string) => number;
} => {
  const db = new DatabaseSync(':memory:');
  return {
    exec: (query, ...bindings) => {
      const statement = db.prepare(query);
      if (/^\s*select/iu.test(query)) {
        const rows = statement.all(...(bindings as never[])) as Record<
          string,
          unknown
        >[];
        return { toArray: () => rows };
      }
      statement.run(...(bindings as never[]));
      return { toArray: () => [] };
    },
    rows: (table) =>
      Number(
        (
          db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
            n: number;
          }
        ).n
      ),
  };
};

describe('ImageStoreSql', () => {
  it('keeps a picture once, by its hash, and gives it back', async () => {
    const sql = memorySql();
    const store = new ImageStoreSql(sql);
    const bytes = webpLossless(600, 838, 64);
    const sha256 = await sha256Hex(bytes);
    expect(await store.put(bytes, 1)).toEqual({ kind: 'stored', sha256 });
    expect(await store.put(bytes, 2)).toEqual({ kind: 'stored', sha256 });
    expect(sql.rows('images')).toBe(1);
    const stored = store.get(sha256);
    expect(stored?.type).toBe('image/webp');
    expect([...(stored?.bytes ?? [])]).toEqual([...bytes]);
    expect(store.get('0'.repeat(64))).toBeNull();
    expect(imageStoreName(sha256)).toBe(`images-${sha256.charAt(0)}`);
  });

  it('refuses what is not a small JPEG or WebP', async () => {
    const store = new ImageStoreSql(memorySql());
    expect(await store.put(new TextEncoder().encode('<svg/>'), 1)).toEqual({
      kind: 'invalid',
      reason: 'unsupported_type',
    });
    expect(await store.put(jpeg(1001, 800), 1)).toEqual({
      kind: 'invalid',
      reason: 'too_big_picture',
    });
    expect(await store.put(jpeg(800, 1401), 1)).toEqual({
      kind: 'invalid',
      reason: 'too_big_picture',
    });
    expect(
      await store.put(webpLossless(600, 838, MAX_IMAGE_UPLOAD_BYTES), 1)
    ).toEqual({ kind: 'invalid', reason: 'too_large' });
  });

  it('bans a picture: forgotten, refused again and never served', async () => {
    const sql = memorySql();
    const store = new ImageStoreSql(sql);
    const bytes = jpeg(600, 838);
    const sha256 = await sha256Hex(bytes);
    await store.put(bytes, 1);
    store.block(sha256, 2);
    expect(sql.rows('images')).toBe(0);
    expect(store.get(sha256)).toBeNull();
    expect(await store.put(bytes, 3)).toEqual({ kind: 'blocked' });
    expect(sql.rows('images')).toBe(0);
  });
});
