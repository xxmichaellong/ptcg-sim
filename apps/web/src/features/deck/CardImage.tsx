import {
  limitlessNumber,
  resolvePastedDecklistImageUrl,
} from '@ptcgsim/deck-core';
import { useState, type ImgHTMLAttributes } from 'react';

import {
  cardImageAddresses,
  useCardImageLanguage,
} from '../../i18n/card-image-language.js';

/**
 * The same printing's scan on Limitless's CDN, for a TCGdex image that
 * fails to load (TCGdex's image host has its bad moments).
 */
export const limitlessScanOf = (card: {
  readonly name: string;
  readonly image: string;
  readonly set?: string;
  readonly number?: string;
}): string | undefined =>
  card.image.includes('assets.tcgdex.net') && card.set && card.number
    ? resolvePastedDecklistImageUrl({
        name: card.name,
        setCode: card.set,
        // An alternate printing's letter is lower case in the scan's name.
        number: limitlessNumber(card.number),
      })
    : undefined;

/**
 * A card image in the language this player sees cards in. It tries each
 * address in turn before showing as broken: the scan in that language, the
 * fallback source's in it, then each as given (cardImageCandidates).
 */
export const CardImage = ({
  src,
  fallback,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & {
  readonly src: string;
  readonly fallback: string | undefined;
}) => {
  const language = useCardImageLanguage();
  const addresses = cardImageAddresses(src, fallback, language);
  const key = addresses.join('\n');
  const [failed, setFailed] = useState<{
    readonly key: string;
    readonly count: number;
  }>();
  const tried = failed?.key === key ? failed.count : 0;
  const last = addresses.length - 1;
  return (
    <img
      {...rest}
      src={addresses[Math.min(tried, last)] ?? src}
      onError={(event) => {
        if (tried < last) setFailed({ key, count: tried + 1 });
        rest.onError?.(event);
      }}
    />
  );
};
