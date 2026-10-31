import type { CardPresentation, QuarterTurns } from '@ptcgsim/game-core';
import {
  composeCardArtwork,
  fitCardComposition,
  turnCardComposition,
  unionCardBounds,
  type CardComposition,
  type ComposedCardBox,
} from './card-composition.js';
import {
  layoutLegacyPlayRow,
  type BoardLayoutRegion,
  type LegacyPlayRowStackInput,
} from './layout.js';
import type { Rect } from './model.js';

export interface ComposedPlayRowInput extends LegacyPlayRowStackInput {
  readonly evolution: readonly {
    readonly id: string;
    readonly presentation?: CardPresentation;
    readonly rotation: QuarterTurns;
  }[];
  readonly attachmentIds: readonly string[];
  readonly attachmentRotations: readonly QuarterTurns[];
}

/**
 * A piece's own turn on top of its arrangement. v1 had no arrangements, so
 * players laid BREAK and LEGEND cards sideways themselves: Alt+R toggles a
 * card between upright and one quarter-turn. For a piece whose arrangement
 * already turns it that way, no turn and that same turn both mean "as it
 * reads"; any other turn still adds, so a deliberate one shows.
 */
const pieceTurn = (
  arranged: QuarterTurns,
  reading: QuarterTurns,
  own: QuarterTurns
): QuarterTurns =>
  reading !== 0 && (own === 0 || own === reading)
    ? arranged
    : (((arranged + own) % 4) as QuarterTurns);

/** A row is packed by whole silhouettes when one of its stacks is nonstandard. */
export const layoutComposedPlayRow = (
  region: BoardLayoutRegion,
  inputs: readonly ComposedPlayRowInput[]
): readonly (CardComposition & { readonly mainBounds: Rect })[] | null => {
  const artworks = inputs.map((input) => {
    const artwork = composeCardArtwork(input.evolution);
    if (!artwork) return null;
    const cards = artwork.cards.map((card, index) => ({
      ...card,
      rotationQuarterTurns: pieceTurn(
        card.rotationQuarterTurns,
        input.evolution[index]!.presentation?.readingQuarterTurns ?? 0,
        input.evolution[index]!.rotation
      ),
    }));
    return {
      ...artwork,
      cards,
      bounds: unionCardBounds([
        ...cards,
        { bounds: artwork.bounds, rotationQuarterTurns: 0 },
      ]),
    };
  });
  if (!artworks.some(Boolean)) return null;
  const raw = inputs.map((input, index) => {
    const artwork = artworks[index];
    const ordinary = layoutLegacyPlayRow(
      {
        ...region,
        side: 'local',
        physicalDeclaredBounds: { x: 0, y: 0, width: 300, height: 88 },
      },
      63 / 88,
      [input]
    )[0]!;
    const evolution: readonly ComposedCardBox[] =
      artwork?.cards ??
      ordinary.evolutionCards.map((card, i) => ({
        id: input.evolution[i]!.id,
        bounds: card.bounds,
        rotationQuarterTurns: input.evolution[i]!.rotation,
        layer: i,
      }));
    const mainBounds = artwork?.bounds ?? unionCardBounds(evolution);
    const attachments = ordinary.attachmentCards.map(
      (card, i): ComposedCardBox => ({
        id: input.attachmentIds[i]!,
        bounds: artwork
          ? {
              ...card.bounds,
              x: mainBounds.x + mainBounds.width - 63 + (i + 1) * 10.5,
              y: mainBounds.y + mainBounds.height - 88,
            }
          : card.bounds,
        rotationQuarterTurns: ((card.rotationQuarterTurns +
          input.attachmentRotations[i]!) %
          4) as QuarterTurns,
        layer: -i - 1,
      })
    );
    const all = [...evolution, ...attachments];
    const bounds = unionCardBounds([
      ...all,
      { bounds: mainBounds, rotationQuarterTurns: 0 },
    ]);
    const rotation = ((input.rotationQuarterTurns +
      (region.side === 'opponent' ? 2 : 0)) %
      4) as QuarterTurns;
    const turned = turnCardComposition(
      { kind: artwork?.kind ?? 'overlay', bounds, cards: all },
      rotation
    );
    // Main-envelope marker anchor follows the exact same group transform.
    const main = turnCardComposition(
      {
        kind: turned.kind,
        bounds,
        cards: [
          { id: 'main', bounds: mainBounds, rotationQuarterTurns: 0, layer: 0 },
        ],
      },
      rotation
    );
    return { ...turned, mainBounds: unionCardBounds(main.cards) };
  });
  const bounds = region.physicalDeclaredBounds;
  const gap = Math.min(12, bounds.width * 0.015);
  const naturalWidths = raw.map(
    (item) => (bounds.height * item.bounds.width) / item.bounds.height
  );
  const scale = Math.min(
    1,
    Math.max(0, bounds.width - gap * (raw.length - 1)) /
      Math.max(
        Number.EPSILON,
        naturalWidths.reduce((a, b) => a + b, 0)
      )
  );
  const total =
    naturalWidths.reduce((a, b) => a + b * scale, 0) + gap * (raw.length - 1);
  let cursor = bounds.x + (bounds.width - total) / 2;
  const result: (CardComposition & { readonly mainBounds: Rect })[] = [];
  const order = raw.map((_, index) => index);
  if (region.side === 'opponent') order.reverse();
  for (const index of order) {
    const item = raw[index]!;
    const width = naturalWidths[index]! * scale;
    const target = { x: cursor, y: bounds.y, width, height: bounds.height };
    const fitted = fitCardComposition(item, target);
    const main = fitCardComposition(
      {
        ...item,
        cards: [
          {
            id: 'main',
            bounds: item.mainBounds,
            rotationQuarterTurns: 0,
            layer: 0,
          },
        ],
      },
      target
    );
    result[index] = { ...fitted, mainBounds: main.cards[0]!.bounds };
    cursor += width + gap;
  }
  return result;
};
