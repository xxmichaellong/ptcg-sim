import {
  limitlessNumber,
  resolvePastedDecklistImageUrl,
} from '@ptcgsim/deck-core';
import { useState, type ImgHTMLAttributes } from 'react';

import {
  cardImageAddresses,
  useCardImageLanguage,
} from '../../i18n/card-image-language.js';

/** Limitless's small size of one of its full scans (`_R_EN.png`). */
const smallLimitlessScan = (url: string): string =>
  url.replace(/(\/tpci\/.+_R_[A-Z]{2})\.png$/u, '$1_SM.png');

/**
 * The same printing's scan on Limitless's CDN, for a TCGdex image that
 * fails to load (TCGdex's image host has its bad moments). A thumbnail
 * (`small`) falls back to Limitless's small size, a tenth of the bytes of
 * its full scan.
 */
export const limitlessScanOf = (
  card: {
    readonly name: string;
    readonly image: string;
    readonly set?: string;
    readonly number?: string;
  },
  size: 'full' | 'small' = 'full'
): string | undefined => {
  if (!card.image.includes('assets.tcgdex.net') || !card.set || !card.number)
    return undefined;
  const scan = resolvePastedDecklistImageUrl({
    name: card.name,
    setCode: card.set,
    // An alternate printing's letter is lower case in the scan's name.
    number: limitlessNumber(card.number),
  });
  return scan && size === 'small' ? smallLimitlessScan(scan) : scan;
};

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
