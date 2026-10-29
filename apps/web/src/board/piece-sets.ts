import {
  resolveCardPresentation,
  type MatchViewState,
  type ViewCard,
  type ViewCardId,
} from '@ptcgsim/game-core';

import { locateViewCardActionSource } from './locateViewCardActionSource.js';

/** Where a card printed in pieces sits in its whole (CardPresentation.join). */
export interface CardPiece {
  /** The print the pieces make together: the same key, the same card. */
  readonly key: string;
  readonly columns: number;
  readonly rows: number;
  /** Its place, in reading order from the top left. */
  readonly part: number;
}

/**
 * The piece a card is, when the viewer sees it face up: a V-UNION's
 * quarter, a LEGEND's half, a split Stadium's half. Null for any other
 * card, and for one face down or unknown.
 */
export const cardPieceOf = (
  view: MatchViewState,
  card: ViewCard
): CardPiece | null => {
  if (card.kind !== 'known' || card.face !== 'up') return null;
  const definition = view.definitions[card.definitionId];
  const join = definition ? resolveCardPresentation(definition)?.join : null;
  return join
    ? {
        key: join.key,
        columns: join.columns,
        rows: join.rows,
        part: join.part,
      }
    : null;
};

/**
 * Pieces of one print, one card for each part they have: played together
 * they make one card (a Pokémon, or the Stadium).
 */
export interface PieceSet {
  readonly key: string;
  readonly columns: number;
  readonly rows: number;
  /** One card per part, in part order. */
  readonly cardIds: readonly ViewCardId[];
  /** The parts they are, in the same order. */
  readonly parts: readonly number[];
  /** Every part is there. A set short of some still plays, with gaps. */
  readonly complete: boolean;
  /** A Pokémon's pieces go into play; a Stadium's, to the Stadium. */
  readonly kind: 'pokemon' | 'stadium';
}

/** What a group is made of, in the order its cards were selected. */
export type GroupUnit =
  | { readonly kind: 'card'; readonly cardId: ViewCardId }
  | { readonly kind: 'set'; readonly set: PieceSet };

/** A card and where it lies, for the pieces a group holds. */
const looseCard = (
  view: MatchViewState,
  cardId: ViewCardId
): ViewCard | null => {
  const located = locateViewCardActionSource(view, cardId);
  // A card in play is part of a Pokémon, which moves whole: not a piece.
  return located && located.sourceKind !== 'stack' ? located.card : null;
};

const setOf = (
  piece: CardPiece,
  kind: PieceSet['kind'],
  members: readonly { readonly cardId: ViewCardId; readonly part: number }[]
): PieceSet => {
  const ordered = [...members].sort((left, right) => left.part - right.part);
  return {
    key: piece.key,
    columns: piece.columns,
    rows: piece.rows,
    cardIds: ordered.map((member) => member.cardId),
    parts: ordered.map((member) => member.part),
    complete: ordered.length === piece.columns * piece.rows,
    kind,
  };
};

/**
 * A group split into what plays as one: the pieces of one print, one per
 * part (two copies of a LEGEND's halves make two sets, as artwork never
 * repeats a part), and every other card on its own. A set stands where its
 * first piece was selected; a piece alone is a card. Cards in play are a
 * Pokémon's own and never pieces here.
 */
export const partitionPieceSets = (
  view: MatchViewState,
  cardIds: readonly ViewCardId[]
): readonly GroupUnit[] => {
  type Building = {
    readonly piece: CardPiece;
    readonly kind: PieceSet['kind'];
    readonly members: { readonly cardId: ViewCardId; readonly part: number }[];
  };
  const slots: (ViewCardId | Building)[] = [];
  const open = new Map<string, Building[]>();
  for (const cardId of cardIds) {
    const card = looseCard(view, cardId);
    const piece = card ? cardPieceOf(view, card) : null;
    if (!card || !piece) {
      slots.push(cardId);
      continue;
    }
    const key = `${piece.key}\u0000${piece.columns}x${piece.rows}`;
    const sets = open.get(key) ?? [];
    const target = sets.find(
      (set) => !set.members.some((member) => member.part === piece.part)
    );
    if (target) {
      target.members.push({ cardId, part: piece.part });
      continue;
    }
    const building: Building = {
      piece,
      kind:
        card.kind === 'known' && card.category === 'Pokémon'
          ? 'pokemon'
          : 'stadium',
      members: [{ cardId, part: piece.part }],
    };
    sets.push(building);
    open.set(key, sets);
    slots.push(building);
  }
  return slots.map((slot): GroupUnit =>
    typeof slot === 'string'
      ? { kind: 'card', cardId: slot }
      : slot.members.length === 1
        ? { kind: 'card', cardId: slot.members[0]!.cardId }
        : { kind: 'set', set: setOf(slot.piece, slot.kind, slot.members) }
  );
};

/**
 * The pieces "Play as one card" takes with a piece: one for each part, of
 * the same print and owner, that the viewer sees face up where a player
 * would reach for them -- where the piece lies, its owner's hand and
 * discard pile, and the pile open in the viewer -- nearest first. Null
 * when none is in sight but the piece itself.
 */
export const visiblePieceSetOf = (
  view: MatchViewState,
  cardId: ViewCardId,
  openedZoneId?: string | null
): PieceSet | null => {
  const card = looseCard(view, cardId);
  const piece = card ? cardPieceOf(view, card) : null;
  if (!card || !piece) return null;
  const located = locateViewCardActionSource(view, cardId)!;
  const ownZone = (kind: 'hand' | 'discard') =>
    Object.values(view.zones).find(
      (zone) => zone.kind === kind && zone.ownerId === card.ownerId
    );
  const workAreaCards = (id: string): readonly ViewCard[] => {
    for (const areas of Object.values(view.workAreas)) {
      if (areas.inspection?.id === id) return areas.inspection.cards;
      if (areas.attachmentResolution?.id === id)
        return areas.attachmentResolution.cards;
    }
    return [];
  };
  const places: readonly (readonly ViewCard[])[] = [
    view.zones[located.sourceId]?.cards ?? workAreaCards(located.sourceId),
    ownZone('hand')?.cards ?? [],
    ownZone('discard')?.cards ?? [],
    (openedZoneId ? view.zones[openedZoneId]?.cards : undefined) ?? [],
  ];
  const members = new Map<number, ViewCardId>([[piece.part, cardId]]);
  for (const cards of places) {
    for (const candidate of cards) {
      if (candidate.ownerId !== card.ownerId) continue;
      const other = cardPieceOf(view, candidate);
      if (
        other &&
        other.key === piece.key &&
        other.columns === piece.columns &&
        other.rows === piece.rows &&
        !members.has(other.part)
      ) {
        members.set(other.part, candidate.id);
      }
    }
  }
  if (members.size < 2) return null;
  return setOf(
    piece,
    card.kind === 'known' && card.category === 'Pokémon'
      ? 'pokemon'
      : 'stadium',
    [...members].map(([part, member]) => ({ cardId: member, part }))
  );
};

/**
 * The unfinished Pokémon a piece joins (`b` on a lone V-UNION piece): one
 * of the same print in play on that board, whose top card is a piece and
 * which lacks every part given. Null when there is none, or more than one
 * to choose between.
 */
export const unfinishedPokemonFor = (
  view: MatchViewState,
  piece: CardPiece,
  parts: readonly number[],
  boardPlayerId: string
): string | null => {
  const matching = Object.values(view.stacks).filter((stack) => {
    if (stack.boardPlayerId !== boardPlayerId) return false;
    const pieces = stack.evolutionCards.map((card) => cardPieceOf(view, card));
    const top = pieces.at(-1);
    return (
      top != null &&
      top.key === piece.key &&
      top.columns === piece.columns &&
      top.rows === piece.rows &&
      pieces.every((other) => other === null || other.key === piece.key) &&
      parts.every((part) => !pieces.some((other) => other?.part === part))
    );
  });
  return matching.length === 1 ? matching[0]!.id : null;
};
