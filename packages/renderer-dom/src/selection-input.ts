import {
  selectionItemOf,
  type BoardScene,
  type BoardSide,
  type CardSceneNode,
  type Rect,
} from '@ptcgsim/renderer-contract';

/** Whether the page runs on macOS or iOS, where ⌘ is the platform modifier. */
export const isApplePlatform = (): boolean => {
  const navigator = globalThis.navigator as
    | (Navigator & { readonly userAgentData?: { readonly platform?: string } })
    | undefined;
  const platform =
    navigator?.userAgentData?.platform ?? navigator?.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
};

/**
 * Whether a press adds an item to the selection, or takes it out, keeping
 * the rest (ADR-042 §2): Shift everywhere, and the platform modifier -- ⌘ on
 * macOS, Ctrl elsewhere. Ctrl on a Mac is a secondary click, the browser's
 * context menu, never a press here.
 */
export const addsToSelection = (
  event: Pick<MouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>,
  apple = isApplePlatform()
): boolean => event.shiftKey || (apple ? event.metaKey : event.ctrlKey);

/** How far a press on the felt moves before it draws a rectangle. */
export const SWEEP_THRESHOLD_PX = 6;

const PILE_KINDS = new Set(['deck', 'discard', 'lostZone']);

/** A card a rectangle may take, where it is painted. */
export interface SweepCandidate {
  readonly card: CardSceneNode;
  /** Its painted box, on the screen (the surface's own units). */
  readonly box: Rect;
}

/**
 * The cards a rectangle drawn in one half may take (ADR-042 §2): the cards
 * of that half the player can pick up -- not a pile's cover or its top
 * (deck, discard pile, Lost Zone: they are opened to pick from), nor the
 * other player's face-down hand, unless the player works both seats (a Solo
 * table with that hand covered, `readsEveryHand`).
 */
export const sweepCandidates = (
  scene: BoardScene,
  side: BoardSide,
  boxOf: (card: CardSceneNode) => Rect,
  readsEveryHand = false
): readonly SweepCandidate[] => {
  const zoneKinds = new Map(scene.zones.map((zone) => [zone.id, zone.kind]));
  const candidates: SweepCandidate[] = [];
  for (const card of scene.cards) {
    if (
      card.renderKey === null ||
      !card.interactive ||
      card.primaryAction ||
      card.side !== side
    )
      continue;
    const zoneKind = zoneKinds.get(card.parentId);
    if (zoneKind && PILE_KINDS.has(zoneKind)) continue;
    if (
      !readsEveryHand &&
      card.concealed &&
      card.side === 'opponent' &&
      zoneKind === 'hand'
    )
      continue;
    candidates.push({ card, box: boxOf(card) });
  }
  return candidates;
};

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** What a rectangle takes, as it stands. */
export interface Sweep {
  /** The items, in reading order: rows top to bottom, each left to right. */
  readonly items: readonly CardSceneNode['id'][];
  /** The cards painted under it (whose items it takes). */
  readonly cards: readonly CardSceneNode[];
}

/**
 * The items whose painted cards a rectangle touches, in reading order. A
 * card of a Pokémon takes the whole Pokémon (by its top card); a card
 * attached to a Pokémon the rectangle also takes goes with it, not as an
 * item of its own.
 */
export const sweptItems = (
  scene: BoardScene,
  candidates: readonly SweepCandidate[],
  rect: Rect
): Sweep => {
  const hit = candidates.filter((candidate) => overlaps(candidate.box, rect));
  const pokemon = new Set(
    hit
      .filter((candidate) => candidate.card.role === 'stackEvolution')
      .map((candidate) => candidate.card.parentId)
  );
  const firstBox = new Map<CardSceneNode['id'], Rect>();
  const cards: CardSceneNode[] = [];
  for (const { card, box } of hit) {
    if (card.role === 'stackAttachment' && pokemon.has(card.parentId)) continue;
    cards.push(card);
    const item = selectionItemOf(scene, card.id);
    if (!firstBox.has(item)) firstBox.set(item, box);
  }
  // Reading order: a row is the cards whose middles lie within half a card
  // of the row's first; rows run down the screen, each across it.
  const placed = [...firstBox].map(([item, box]) => ({
    item,
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    half: box.height / 2,
  }));
  placed.sort((left, right) => left.y - right.y);
  const rows: (typeof placed)[] = [];
  for (const entry of placed) {
    const row = rows.at(-1);
    if (row && entry.y - row[0]!.y <= row[0]!.half) row.push(entry);
    else rows.push([entry]);
  }
  return {
    items: rows.flatMap((row) =>
      row.sort((left, right) => left.x - right.x).map((entry) => entry.item)
    ),
    cards,
  };
};

/** The rectangle between two points, kept within `[top, bottom]`. */
export const sweepRect = (
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  limits: { readonly top: number; readonly bottom: number }
): Rect => {
  const clamp = (y: number) => Math.max(limits.top, Math.min(limits.bottom, y));
  const top = clamp(Math.min(from.y, to.y));
  const bottom = clamp(Math.max(from.y, to.y));
  const left = Math.min(from.x, to.x);
  return {
    x: left,
    y: top,
    width: Math.max(from.x, to.x) - left,
    height: bottom - top,
  };
};
