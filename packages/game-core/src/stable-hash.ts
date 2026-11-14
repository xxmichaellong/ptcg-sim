/**
 * Keys sort in one fixed collation, so the canonical bytes are the same in
 * every runtime: a Turkish locale orders "I" and "i" differently, and a
 * replay file hashed in one browser failed its check in another. en-US is
 * the order every stored hash and replay file was already made in (the
 * Worker's default, and most browsers'); a plain code-unit order would
 * orphan them.
 */
const keyOrder = new Intl.Collator('en-US').compare;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => keyOrder(left, right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
};

export const stableSerialize = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

export const stableHash = (value: unknown): string => {
  const serialized = stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
