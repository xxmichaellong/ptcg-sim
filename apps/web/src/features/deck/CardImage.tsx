import {
  limitlessNumber,
  resolvePastedDecklistImageUrl,
} from '@ptcgsim/deck-core';
import { useState, type ImgHTMLAttributes } from 'react';

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

/** A card image that tries one fallback address before showing as broken. */
export const CardImage = ({
  src,
  fallback,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & {
  readonly src: string;
  readonly fallback: string | undefined;
}) => {
  const [failedFor, setFailedFor] = useState<string>();
  const useFallback = failedFor === src && fallback !== undefined;
  return (
    <img
      {...rest}
      src={useFallback ? fallback : src}
      onError={(event) => {
        if (failedFor !== src) setFailedFor(src);
        rest.onError?.(event);
      }}
    />
  );
};
