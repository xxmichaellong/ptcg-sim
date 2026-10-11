import type { CardPresentation, QuarterTurns } from '@ptcgsim/game-core';
import type {
  Rect,
  BoardScene,
  CardSceneNode,
  MarkerSceneNode,
  BoardPresentation,
} from './model.js';

export interface CompositionCard {
  readonly id: string;
  readonly presentation?: CardPresentation;
}
export interface ComposedCardBox {
  readonly id: string;
  /** Portrait scan box, rotated about its centre. */
  readonly bounds: Rect;
  readonly rotationQuarterTurns: QuarterTurns;
  readonly layer: number;
}
export interface CardComposition {
  readonly kind: 'joined' | 'overlay';
  readonly bounds: Rect;
  readonly cards: readonly ComposedCardBox[];
}

export const paintedCardBounds = (bounds: Rect, rotation: number): Rect =>
  rotation % 2 === 0
    ? bounds
    : {
        x: bounds.x + (bounds.width - bounds.height) / 2,
        y: bounds.y + (bounds.height - bounds.width) / 2,
        width: bounds.height,
        height: bounds.width,
      };

export const unionCardBounds = (
  cards: readonly Pick<ComposedCardBox, 'bounds' | 'rotationQuarterTurns'>[]
): Rect => {
  if (cards.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const boxes = cards.map((card) =>
    paintedCardBounds(card.bounds, card.rotationQuarterTurns)
  );
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
};

/** Reusable geometry in physical card units. Never sorts or invents cards. */
export const composeCardArtwork = (
  cards: readonly CompositionCard[]
): CardComposition | null => {
  const top = cards.at(-1);
  if (!top) return null;
  const join = top.presentation?.join;
  if (
    join &&
    cards.every(
      (card) =>
        card.presentation?.join?.key === join.key &&
        card.presentation.join.columns === join.columns &&
        card.presentation.join.rows === join.rows &&
        card.presentation.readingQuarterTurns ===
          top.presentation!.readingQuarterTurns
    )
  ) {
    const parts = cards.map((card) => card.presentation!.join!.part);
    // Duplicate pieces are an ordinary stack, never silently hidden/replaced.
    if (new Set(parts).size !== parts.length) return null;
    const rotation = top.presentation!.readingQuarterTurns;
    const width = rotation % 2 ? 88 : 63;
    const height = rotation % 2 ? 63 : 88;
    const boxes = cards.map((card, index): ComposedCardBox => {
      const part = parts[index]!;
      return {
        id: card.id,
        bounds: {
          x: (part % join.columns) * width + (width - 63) / 2,
          y: Math.floor(part / join.columns) * height + (height - 88) / 2,
          width: 63,
          height: 88,
        },
        rotationQuarterTurns: rotation,
        layer: index,
      };
    });
    return {
      kind: 'joined',
      bounds: {
        x: 0,
        y: 0,
        width: width * join.columns,
        height: height * join.rows,
      },
      cards: boxes,
    };
  }
  if (top.presentation?.overlay === 'upper-half' && cards.length >= 2) {
    const boxes = cards.map((card, index): ComposedCardBox => ({
      id: card.id,
      bounds: {
        x: 0,
        y:
          index === cards.length - 1
            ? -31.5
            : -(cards.length - 2 - index) * 4.2,
        width: 63,
        height: 88,
      },
      rotationQuarterTurns:
        index === cards.length - 1 ? top.presentation!.readingQuarterTurns : 0,
      layer: index,
    }));
    return { kind: 'overlay', bounds: unionCardBounds(boxes), cards: boxes };
  }
  return null;
};

/** Rotate an entire arrangement; its seams stay joined at all four turns. */
export const turnCardComposition = (
  composition: CardComposition,
  turns: QuarterTurns
): CardComposition => {
  if (turns === 0) return composition;
  const center = {
    x: composition.bounds.x + composition.bounds.width / 2,
    y: composition.bounds.y + composition.bounds.height / 2,
  };
  const radians = (turns * Math.PI) / 2;
  const cards = composition.cards.map((card): ComposedCardBox => {
    const dx = card.bounds.x + card.bounds.width / 2 - center.x;
    const dy = card.bounds.y + card.bounds.height / 2 - center.y;
    return {
      ...card,
      bounds: {
        ...card.bounds,
        x:
          center.x +
          dx * Math.cos(radians) -
          dy * Math.sin(radians) -
          card.bounds.width / 2,
        y:
          center.y +
          dx * Math.sin(radians) +
          dy * Math.cos(radians) -
          card.bounds.height / 2,
      },
      rotationQuarterTurns: ((card.rotationQuarterTurns + turns) %
        4) as QuarterTurns,
    };
  });
  // Keep missing grid cells reserved as the composition turns.
  return {
    ...composition,
    cards,
    bounds: paintedCardBounds(composition.bounds, turns),
  };
};

export const fitCardComposition = (
  composition: CardComposition,
  target: Rect
): CardComposition => {
  const scale = Math.min(
    target.width / composition.bounds.width,
    target.height / composition.bounds.height
  );
  const x = target.x + (target.width - composition.bounds.width * scale) / 2;
  const y = target.y + (target.height - composition.bounds.height * scale) / 2;
  const fit = (box: Rect): Rect => ({
    x: x + (box.x - composition.bounds.x) * scale,
    y: y + (box.y - composition.bounds.y) * scale,
    width: box.width * scale,
    height: box.height * scale,
  });
  return {
    ...composition,
    bounds: fit(composition.bounds),
    cards: composition.cards.map((card) => ({
      ...card,
      bounds: fit(card.bounds),
    })),
  };
};

/** Follow the grabbed piece without collapsing the other pieces onto its centre. */
export const compositionHold = <
  T extends {
    readonly cardId: CardSceneNode['id'];
    readonly x: number;
    readonly y: number;
  },
>(
  scene: BoardScene,
  card: CardSceneNode,
  hold: T | null | undefined
): T | null => {
  if (!hold) return null;
  if (hold.cardId === card.id) return hold;
  const anchor = scene.cards.find((item) => item.id === hold.cardId);
  if (
    !anchor?.composition ||
    anchor.role !== 'stackEvolution' ||
    anchor.parentId !== card.parentId
  )
    return null;
  return {
    ...hold,
    x:
      hold.x +
      card.bounds.x +
      card.bounds.width / 2 -
      anchor.bounds.x -
      anchor.bounds.width / 2,
    y:
      hold.y +
      card.bounds.y +
      card.bounds.height / 2 -
      anchor.bounds.y -
      anchor.bounds.height / 2,
  };
};

/** Counters stay on their physical card while a card or assembly is held. */
export const presentHeldMarker = (
  scene: BoardScene,
  marker: MarkerSceneNode,
  presentation: BoardPresentation | null | undefined
): MarkerSceneNode => {
  const parent = scene.cards.find((card) => card.id === marker.parentCardId);
  if (!parent || !presentation) return marker;
  const drag = compositionHold(scene, parent, presentation.drag);
  const hold =
    drag ??
    presentation.settling
      .map((entry) => compositionHold(scene, parent, entry))
      .find(Boolean);
  if (!hold) return marker;
  return {
    ...marker,
    zIndex: (drag ? 10_000 : 9_000) + parent.zIndex + 100,
    bounds: {
      ...marker.bounds,
      x: marker.bounds.x + hold.x - parent.bounds.x - parent.bounds.width / 2,
      y: marker.bounds.y + hold.y - parent.bounds.y - parent.bounds.height / 2,
    },
  };
};
