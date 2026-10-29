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
 * What a card shows when no address has its picture (a promo neither
 * source has scanned, SVP 85): a blank card with a picture's outline, not
 * the browser's broken image. Its name is beside it wherever it is drawn.
 */
export const MISSING_CARD_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="630" height="880" viewBox="0 0 63 88">' +
    '<rect x="0.5" y="0.5" width="62" height="87" rx="3.5" fill="#8a8178" fill-opacity="0.2" stroke="#8a8178" stroke-opacity="0.55"/>' +
    '<g fill="none" stroke="#8a8178" stroke-opacity="0.8" stroke-width="1.6" stroke-linejoin="round">' +
    '<rect x="21" y="35" width="21" height="17" rx="2"/>' +
    '<path d="M21 49l6-6 4 4 3-3 8 7"/></g></svg>'
)}`;

/**
 * A card image in the language this player sees cards in. It tries each
 * address in turn: the scan in that language, the fallback source's in it,
 * then each as given (cardImageCandidates); with none left, a blank card
 * (MISSING_CARD_IMAGE).
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
  const missing = tried >= addresses.length;
  return (
    <img
      {...rest}
      src={missing ? MISSING_CARD_IMAGE : (addresses[tried] ?? src)}
      data-image-missing={missing ? '' : undefined}
      onError={(event) => {
        if (!missing) setFailed({ key, count: tried + 1 });
        rest.onError?.(event);
      }}
    />
  );
};
