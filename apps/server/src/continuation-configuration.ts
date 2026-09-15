import {
  WebCryptoContinuationCryptography,
  importContinuationEncryptionKey,
} from './continuation-custody.js';
import {
  ContinuationConfigurationError,
  decodeContinuationKeyMaterial,
  readContinuationKeyringConfiguration,
} from './continuation-keyring-schema.js';

export {
  CONTINUATION_KEYRING_FORMAT,
  MAX_CONTINUATION_DECRYPT_KEYS,
  MAX_CONTINUATION_KEYRING_CODE_UNITS,
  ContinuationConfigurationError,
  readContinuationKeyringConfiguration,
  type ContinuationConfigurationFailure,
  type EncodedContinuationKey,
  type EncodedContinuationKeyring,
} from './continuation-keyring-schema.js';

export const createContinuationCryptographyFromConfiguration = async (
  configuration: unknown
): Promise<WebCryptoContinuationCryptography> => {
  const parsed = readContinuationKeyringConfiguration(configuration);
  const imported = new Map<string, CryptoKey>();
  try {
    for (const encoded of parsed.keys) {
      const raw = decodeContinuationKeyMaterial(encoded.material);
      try {
        imported.set(
          encoded.id,
          await importContinuationEncryptionKey(
            raw,
            encoded.id === parsed.activeKeyId
              ? ['encrypt', 'decrypt']
              : ['decrypt']
          )
        );
      } finally {
        raw.fill(0);
      }
    }
    return new WebCryptoContinuationCryptography(parsed.activeKeyId, imported);
  } catch (error) {
    if (error instanceof ContinuationConfigurationError) throw error;
    throw new ContinuationConfigurationError('key_import_failed');
  }
};
