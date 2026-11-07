import { parseCardBack } from './card-back.js';

/** Coins share the sleeve designer's references, with no legacy URLs. */
export const COIN_PRESETS = [
  'standard',
  'crimson',
  'azure',
  'amber',
  'violet',
  'teal',
  'jade',
  'slate',
] as const;

export const STANDARD_COIN = 'preset:standard';

export const isCoinValue = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 128) return false;
  const parsed = parseCardBack(value);
  return (
    parsed?.kind === 'design' ||
    parsed?.kind === 'image' ||
    (value.startsWith('preset:') &&
      parsed?.kind === 'preset' &&
      (COIN_PRESETS as readonly string[]).includes(parsed.id))
  );
};
