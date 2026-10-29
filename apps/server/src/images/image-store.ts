import {
  sha256Hex,
  sniffImage,
  type ImageBytes,
  type StoredImageType,
} from './image-bytes.js';

/** The largest upload: a card back at card size is ~20–90 KB. */
export const MAX_IMAGE_UPLOAD_BYTES = 200 * 1024;
/** The largest picture: a card's 63:88 at well over its drawn size. */
export const MAX_IMAGE_WIDTH = 1000;
export const MAX_IMAGE_HEIGHT = 1400;
/** How many stores the images are spread over, by their hash's first digit. */
export const IMAGE_STORE_SHARDS = 16;

export const imageStoreName = (sha256: string): string =>
  `images-${sha256.charAt(0)}`;

export type ImagePutResult =
  | { readonly kind: 'stored'; readonly sha256: string }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'invalid'; readonly reason: ImageRefusal };

export type ImageRefusal = 'too_large' | 'unsupported_type' | 'too_big_picture';

export interface StoredImage {
  readonly type: StoredImageType;
  readonly bytes: ImageBytes;
}

/** What a picture's bytes are refused for, if anything. */
export const checkImageBytes = (
  bytes: Uint8Array
): { readonly type: StoredImageType } | { readonly refusal: ImageRefusal } => {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_UPLOAD_BYTES)
    return { refusal: 'too_large' };
  const image = sniffImage(bytes);
  if (!image) return { refusal: 'unsupported_type' };
  if (image.width > MAX_IMAGE_WIDTH || image.height > MAX_IMAGE_HEIGHT)
    return { refusal: 'too_big_picture' };
  return { type: image.type };
};

/** The SQL the store needs of a Durable Object's storage. */
export interface ImageSql {
  exec(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): Record<string, unknown>[] };
}

/**
 * Images by the SHA-256 of their bytes, stored once each, and a blocklist of
 * hashes refused on upload and on serving (ADR-041).
 */
export class ImageStoreSql {
  constructor(private readonly sql: ImageSql) {
    sql.exec(
      `CREATE TABLE IF NOT EXISTS images (
         sha TEXT PRIMARY KEY,
         type TEXT NOT NULL,
         bytes BLOB NOT NULL,
         size INTEGER NOT NULL,
         created INTEGER NOT NULL
       )`
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS blocked (
         sha TEXT PRIMARY KEY,
         created INTEGER NOT NULL
       )`
    );
  }

  private isBlocked(sha256: string): boolean {
    return (
      this.sql.exec('SELECT 1 FROM blocked WHERE sha = ?', sha256).toArray()
        .length > 0
    );
  }

  /** Checks and keeps a picture, once, named by its hash. */
  async put(bytes: ImageBytes, now: number): Promise<ImagePutResult> {
    const checked = checkImageBytes(bytes);
    if ('refusal' in checked)
      return { kind: 'invalid', reason: checked.refusal };
    const sha256 = await sha256Hex(bytes);
    if (this.isBlocked(sha256)) return { kind: 'blocked' };
    // Stored already: a second upload of the same picture writes nothing.
    this.sql.exec(
      `INSERT OR IGNORE INTO images (sha, type, bytes, size, created)
       VALUES (?, ?, ?, ?, ?)`,
      sha256,
      checked.type,
      bytes,
      bytes.byteLength,
      now
    );
    return { kind: 'stored', sha256 };
  }

  get(sha256: string): StoredImage | null {
    if (this.isBlocked(sha256)) return null;
    const [row] = this.sql
      .exec('SELECT type, bytes FROM images WHERE sha = ?', sha256)
      .toArray();
    if (!row) return null;
    const type = row['type'];
    const bytes = row['bytes'];
    if (type !== 'image/jpeg' && type !== 'image/webp') return null;
    return {
      type,
      bytes: new Uint8Array(
        bytes instanceof ArrayBuffer
          ? bytes
          : (bytes as Uint8Array).slice().buffer
      ),
    };
  }

  /** Bans a picture: refused on upload and on serving, and forgotten. */
  block(sha256: string, now: number): void {
    this.sql.exec(
      'INSERT OR IGNORE INTO blocked (sha, created) VALUES (?, ?)',
      sha256,
      now
    );
    this.sql.exec('DELETE FROM images WHERE sha = ?', sha256);
  }
}
