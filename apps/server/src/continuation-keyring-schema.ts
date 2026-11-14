export const CONTINUATION_KEYRING_FORMAT =
  'ptcgsim-continuation-keyring-v1' as const;
export const MAX_CONTINUATION_DECRYPT_KEYS = 4;
export const MAX_CONTINUATION_KEYRING_CODE_UNITS = 2_048;

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const KEY_MATERIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface EncodedContinuationKey {
  readonly id: string;
  readonly material: string;
}

export interface EncodedContinuationKeyring {
  readonly format: typeof CONTINUATION_KEYRING_FORMAT;
  readonly activeKeyId: string;
  readonly keys: readonly EncodedContinuationKey[];
}

export type ContinuationConfigurationFailure =
  | 'missing'
  | 'oversized'
  | 'malformed'
  | 'unsupported_format'
  | 'invalid_keyring'
  | 'key_import_failed';

/** Safe to report: this error never includes configuration or key material. */
export class ContinuationConfigurationError extends Error {
  constructor(readonly failure: ContinuationConfigurationFailure) {
    super('Continuation encryption keyring configuration is invalid');
    this.name = 'ContinuationConfigurationError';
  }
}

const exactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.every((key) => typeof key === 'string') &&
    JSON.stringify((keys as string[]).sort()) ===
      JSON.stringify([...expected].sort())
  );
};

const parseKeyring = (configuration: unknown): EncodedContinuationKeyring => {
  if (typeof configuration !== 'string' || configuration.length === 0) {
    throw new ContinuationConfigurationError('missing');
  }
  if (configuration.length > MAX_CONTINUATION_KEYRING_CODE_UNITS) {
    throw new ContinuationConfigurationError('oversized');
  }
  let value: unknown;
  try {
    value = JSON.parse(configuration) as unknown;
  } catch {
    throw new ContinuationConfigurationError('malformed');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, ['activeKeyId', 'format', 'keys'])
  ) {
    throw new ContinuationConfigurationError('invalid_keyring');
  }
  if (Reflect.get(value, 'format') !== CONTINUATION_KEYRING_FORMAT) {
    throw new ContinuationConfigurationError('unsupported_format');
  }
  const activeKeyId = Reflect.get(value, 'activeKeyId');
  const keys = Reflect.get(value, 'keys');
  if (
    typeof activeKeyId !== 'string' ||
    !KEY_ID_PATTERN.test(activeKeyId) ||
    !Array.isArray(keys) ||
    keys.length < 1 ||
    keys.length > MAX_CONTINUATION_DECRYPT_KEYS
  ) {
    throw new ContinuationConfigurationError('invalid_keyring');
  }
  const parsedKeys: EncodedContinuationKey[] = [];
  for (const entry of keys) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !exactKeys(entry, ['id', 'material']) ||
      typeof Reflect.get(entry, 'id') !== 'string' ||
      !KEY_ID_PATTERN.test(Reflect.get(entry, 'id')) ||
      typeof Reflect.get(entry, 'material') !== 'string' ||
      !KEY_MATERIAL_PATTERN.test(Reflect.get(entry, 'material'))
    ) {
      throw new ContinuationConfigurationError('invalid_keyring');
    }
    parsedKeys.push(entry as EncodedContinuationKey);
  }
  if (
    new Set(parsedKeys.map(({ id }) => id)).size !== parsedKeys.length ||
    new Set(parsedKeys.map(({ material }) => material)).size !==
      parsedKeys.length ||
    !parsedKeys.some(({ id }) => id === activeKeyId)
  ) {
    throw new ContinuationConfigurationError('invalid_keyring');
  }
  return { format: CONTINUATION_KEYRING_FORMAT, activeKeyId, keys: parsedKeys };
};

export const decodeContinuationKeyMaterial = (encoded: string): Uint8Array => {
  const standard = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const padded = standard.padEnd(
    standard.length + ((4 - (standard.length % 4)) % 4),
    '='
  );
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new ContinuationConfigurationError('invalid_keyring');
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== 32) {
    bytes.fill(0);
    throw new ContinuationConfigurationError('invalid_keyring');
  }
  const canonical = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
  if (canonical !== encoded) {
    bytes.fill(0);
    throw new ContinuationConfigurationError('invalid_keyring');
  }
  return bytes;
};

/** Parses the exact runtime schema and validates canonical 256-bit key material. */
export const readContinuationKeyringConfiguration = (
  configuration: unknown
): EncodedContinuationKeyring => {
  const parsed = parseKeyring(configuration);
  for (const encoded of parsed.keys) {
    const raw = decodeContinuationKeyMaterial(encoded.material);
    raw.fill(0);
  }
  return parsed;
};
