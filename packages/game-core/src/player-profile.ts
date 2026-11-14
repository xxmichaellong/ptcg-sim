/** A mat is a built-in look or a sleeve-designer image/reference. */
import { isCardBackValue } from './card-back.js';
export const isPlaymatValue = (value: unknown): value is string =>
  typeof value === 'string' &&
  (value.startsWith('style:')
    ? /^style:(default|cream|frost|sakura|parchment|classic|ocean|slate|midnight|burgundy|charcoal)$/u.test(
        value
      )
    : isCardBackValue(value));
export const isPlayerDisplayName = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 64 &&
  [...value].every((character) => {
    const code = character.codePointAt(0)!;
    return code >= 32 && code !== 127;
  });
