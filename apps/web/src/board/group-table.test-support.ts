import {
  asPlayerId,
  asViewCardId,
  asViewDefinitionId,
  type CardPresentation,
  type MatchViewState,
  type PlayerId,
  type ViewCard,
  type ViewCardId,
} from '@ptcgsim/game-core';
import {
  createBoardSceneForViewport,
  createEmptyBoardView,
  type BoardScene,
} from '@ptcgsim/renderer-contract';

import type { SelectionContext } from './selection.js';

export const BLUE = asPlayerId('lobby-blue');
export const RED = asPlayerId('lobby-red');

type Mutable<T> = { -readonly [Key in keyof T]: Mutable<T[Key]> };
type Zone = MatchViewState['zones'][string];
type ZoneKind = Zone['kind'];

export interface CardSpec {
  readonly name?: string;
  readonly category?: 'Pokémon' | 'Trainer' | 'Energy';
  readonly presentation?: CardPresentation;
  readonly face?: 'up' | 'down';
  /** Dealt face down and unknown to the viewer. */
  readonly concealed?: boolean;
  readonly abilityUsed?: boolean;
}

/** One of a print's pieces (a V-UNION's quarter, a split Stadium's half). */
export const piece = (
  key: string,
  part: number,
  columns = 2,
  rows = 2
): CardPresentation => ({
  readingQuarterTurns: 0,
  join: {
    key,
    columns: columns as 1 | 2 | 3 | 4,
    rows: rows as 1 | 2 | 3 | 4,
    part: part as 0 | 1 | 2 | 3,
  },
});

/**
 * A table to select on: two seats, empty, filled card by card. The viewer
 * is Blue; `solo` makes Blue play both seats.
 */
export const groupTable = () => {
  const view = structuredClone(
    createEmptyBoardView()
  ) as unknown as Mutable<MatchViewState>;
  let next = 0;
  const card = (ownerId: PlayerId, spec: CardSpec = {}): ViewCard => {
    const index = next++;
    const id = asViewCardId(`card-${index}`);
    if (spec.concealed) {
      return {
        kind: 'concealed',
        id,
        ownerId,
        cardBackUrl: view.players[ownerId]!.cardBackUrl,
        publiclyRevealed: false,
      };
    }
    const definitionId = asViewDefinitionId(`definition-${index}`);
    const category = spec.category ?? 'Pokémon';
    view.definitions[definitionId] = {
      id: definitionId,
      name: spec.name ?? `Card ${index}`,
      category,
      imageUrl: `/v2/assets/cardback.png?${index}`,
      ...(spec.presentation
        ? { presentation: spec.presentation as Mutable<CardPresentation> }
        : {}),
    };
    return {
      kind: 'known',
      id,
      definitionId,
      ownerId,
      category,
      face: spec.face ?? 'up',
      orientationQuarterTurns: 0,
      abilityUsed: spec.abilityUsed ?? false,
      publiclyRevealed: false,
    };
  };
  const zoneId = (ownerId: PlayerId | null, kind: ZoneKind) =>
    ownerId === null ? 'zone:shared:stadium' : `zone:${ownerId}:${kind}`;
  /** Cards put in a zone, on top of (after) those there. */
  const put = (
    ownerId: PlayerId | null,
    kind: ZoneKind,
    ...specs: CardSpec[]
  ): ViewCardId[] => {
    const zone = view.zones[zoneId(ownerId, kind)]!;
    const cards = specs.map((spec) => card(ownerId ?? BLUE, spec));
    zone.cards.push(...(cards as Mutable<ViewCard>[]));
    return cards.map((entry) => entry.id);
  };
  let stacks = 0;
  /** A Pokémon in play: its line from the Basic up, then what's attached. */
  const pokemon = (
    ownerId: PlayerId,
    slot: 'active' | 'bench',
    line: readonly CardSpec[],
    attached: readonly CardSpec[] = [],
    state: { readonly damage?: number; readonly abilityUsed?: boolean } = {}
  ) => {
    const id = `stack-${stacks++}`;
    const evolutionCards = line.map((spec) => card(ownerId, spec));
    const attachmentCards = attached.map((spec) =>
      card(ownerId, { category: 'Energy', ...spec })
    );
    view.stacks[id] = {
      id,
      boardPlayerId: ownerId,
      slot,
      evolutionCards: evolutionCards as Mutable<ViewCard>[],
      attachmentCards: attachmentCards as Mutable<ViewCard>[],
      rotationQuarterTurns: 0,
      damage: state.damage ?? null,
      specialCondition: null,
      abilityUsed: state.abilityUsed ?? false,
    };
    const board = view.boards[ownerId]!;
    if (slot === 'active') board.activeStackId = id;
    else board.benchStackIds.push(id);
    return {
      stackId: id,
      top: evolutionCards.at(-1)!.id,
      line: evolutionCards.map((entry) => entry.id),
      attached: attachmentCards.map((entry) => entry.id),
    };
  };
  return {
    view: view as MatchViewState,
    put,
    pokemon,
    zoneId,
    scene: (): BoardScene =>
      createBoardSceneForViewport(view as MatchViewState, {
        viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
        bottomPlayerId: BLUE,
        splitRatio: 0.5,
        geometryVersion: 1,
      }),
    context: (
      options: Omit<SelectionContext, 'view' | 'scene'> = {}
    ): SelectionContext => ({
      view: view as MatchViewState,
      scene: createBoardSceneForViewport(view as MatchViewState, {
        viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
        bottomPlayerId: BLUE,
        splitRatio: 0.5,
        geometryVersion: 1,
      }),
      ...options,
    }),
  };
};
