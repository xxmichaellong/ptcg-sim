import type {
  KnownViewCard,
  MatchViewState,
  ViewCard,
  ViewCardId,
} from '@ptcgsim/game-core';
import {
  createBoardSceneForViewport,
  createRendererSpikeView,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  createInitialBoardSessionControllerState,
  type BoardSessionControllerState,
} from './BoardSessionController.js';
import {
  contextActionOutcome,
  outcomeOfCommand,
  type TwoWayContextAction,
} from './contextActionOutcome.js';
import { resolveLegacyBoardOverlayAction } from './resolveLegacyBoardOverlayAction.js';

const base = createRendererSpikeView();
const blue = base.playerOrder[0]!;
const red = base.playerOrder[1]!;
const prizesOf = (playerId: string) => `zone:${playerId}:prizes`;
const handOf = (playerId: string) => `zone:${playerId}:hand`;

/** A card made known (and so readable) where it lies. */
const knownAs = (
  card: ViewCard,
  patch: Partial<KnownViewCard> = {}
): KnownViewCard => {
  const definitionId = Object.keys(base.definitions)[0]!;
  return {
    kind: 'known',
    id: card.id,
    definitionId: definitionId as KnownViewCard['definitionId'],
    ownerId: card.ownerId,
    category: 'Pokémon',
    face: 'up',
    orientationQuarterTurns: 0,
    abilityUsed: false,
    publiclyRevealed: false,
    decklistRank: 0,
    ...patch,
  };
};

const withZone = (
  view: MatchViewState,
  zoneId: string,
  cards: (cards: readonly ViewCard[]) => readonly ViewCard[]
): MatchViewState => ({
  ...view,
  zones: {
    ...view.zones,
    [zoneId]: {
      ...view.zones[zoneId]!,
      cards: cards(view.zones[zoneId]!.cards),
    },
  },
});

const stateOf = (
  view: MatchViewState,
  patch: Partial<BoardSessionControllerState> = {}
): BoardSessionControllerState => ({
  ...createInitialBoardSessionControllerState(),
  generation: 1,
  sessionPhase: 'ready',
  source: { kind: 'live' },
  view,
  scene: createBoardSceneForViewport(view, {
    geometryVersion: 1,
    viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    bottomPlayerId: blue,
    splitRatio: 0.5,
  }),
  canSubmitCommands: true,
  ...patch,
});

const cardOf = (view: MatchViewState, zoneId: string, index = 0) =>
  view.zones[zoneId]!.cards[index]!.id as ViewCardId;

/** The way the controller's own resolver goes for the same request. */
const resolvedWay = (
  view: MatchViewState,
  action: TwoWayContextAction,
  cardId: ViewCardId
) => {
  const resolution = resolveLegacyBoardOverlayAction(
    view,
    { kind: 'context', action, cardId },
    blue
  );
  return resolution.ok && 'command' in resolution && resolution.command
    ? outcomeOfCommand(resolution.command)
    : null;
};

describe('the way a two-way menu action goes', () => {
  it("reveals a card that isn't revealed and hides one that is", () => {
    const hand = handOf(blue);
    const revealed = withZone(base, hand, (cards) =>
      cards.map((card, index) =>
        index === 1 ? knownAs(card, { publiclyRevealed: true }) : card
      )
    );
    expect(
      contextActionOutcome(
        stateOf(revealed),
        cardOf(revealed, hand, 0),
        'revealCard'
      )
    ).toBe('reveal');
    expect(
      contextActionOutcome(
        stateOf(revealed),
        cardOf(revealed, hand, 1),
        'revealCard'
      )
    ).toBe('hide');
    expect(resolvedWay(revealed, 'revealCard', cardOf(revealed, hand, 1))).toBe(
      'hide'
    );
  });

  it('reveals or hides the Prizes by the Prize the menu was opened on', () => {
    const prizes = prizesOf(blue);
    // One Prize shown to both players, the rest face down.
    const mixed = withZone(base, prizes, (cards) =>
      cards.map((card, index) =>
        index === 2 ? knownAs(card, { publiclyRevealed: true }) : card
      )
    );
    const state = stateOf(mixed);
    expect(
      contextActionOutcome(state, cardOf(mixed, prizes, 2), 'revealPrizes')
    ).toBe('hide');
    expect(
      contextActionOutcome(state, cardOf(mixed, prizes, 0), 'revealPrizes')
    ).toBe('reveal');
    // As the room is asked: every Prize hidden, or every Prize shown.
    expect(resolvedWay(mixed, 'revealPrizes', cardOf(mixed, prizes, 2))).toBe(
      'hide'
    );
    expect(resolvedWay(mixed, 'revealPrizes', cardOf(mixed, prizes, 0))).toBe(
      'reveal'
    );
  });

  it('looks at Prizes face down, covers a look, and offers nothing with nothing to see', () => {
    const prizes = prizesOf(red);
    expect(
      contextActionOutcome(stateOf(base), cardOf(base, prizes), 'togglePrizes')
    ).toBe('look');
    const looked: MatchViewState = {
      ...withZone(base, prizes, (cards) => cards.map((card) => knownAs(card))),
      privateInspections: [
        {
          id: 'look-1',
          sourcePlayerId: red,
          sourceId: prizes,
          cardIds: base.zones[prizes]!.cards.map((card) => card.id),
        },
      ],
    };
    expect(
      contextActionOutcome(
        stateOf(looked),
        cardOf(looked, prizes),
        'togglePrizes'
      )
    ).toBe('cover');
    // Shown to both players and looked at by no one: no look to begin or end.
    const shown = withZone(base, prizes, (cards) =>
      cards.map((card) => knownAs(card, { publiclyRevealed: true }))
    );
    expect(
      contextActionOutcome(
        stateOf(shown),
        cardOf(shown, prizes),
        'togglePrizes'
      )
    ).toBeNull();
  });

  it("looks at the other hand, covers it, and on a live Solo table follows the table's switch", () => {
    const hand = handOf(red);
    expect(
      contextActionOutcome(
        stateOf(base),
        cardOf(base, hand),
        'toggleOpponentHand'
      )
    ).toBe('look');
    const looked: MatchViewState = {
      ...withZone(base, hand, (cards) => cards.map((card) => knownAs(card))),
      privateInspections: [
        {
          id: 'look-1',
          sourcePlayerId: red,
          sourceId: hand,
          cardIds: base.zones[hand]!.cards.map((card) => card.id),
        },
      ],
    };
    expect(
      contextActionOutcome(
        stateOf(looked),
        cardOf(looked, hand),
        'toggleOpponentHand'
      )
    ).toBe('cover');
    // Solo shows both hands (the room's view): its switch hides one.
    const solo = withZone(base, hand, (cards) =>
      cards.map((card) => knownAs(card))
    );
    expect(
      contextActionOutcome(
        stateOf(solo),
        cardOf(solo, hand),
        'toggleOpponentHand',
        {
          soloOpponentHandHidden: false,
        }
      )
    ).toBe('cover');
    expect(
      contextActionOutcome(
        stateOf(base),
        cardOf(base, hand),
        'toggleOpponentHand',
        {
          soloOpponentHandHidden: true,
        }
      )
    ).toBe('look');
  });

  it('marks an Ability used, and a used one unused', () => {
    const blueActive = base.stacks['stack:blue:active']!.evolutionCards.at(-1)!
      .id as ViewCardId;
    const discard = cardOf(base, `zone:${blue}:discard`);
    expect(
      contextActionOutcome(stateOf(base), blueActive, 'toggleAbility')
    ).toBe('markUnused');
    expect(contextActionOutcome(stateOf(base), discard, 'toggleAbility')).toBe(
      'markUsed'
    );
  });

  it("goes by the replay's local display in a replay", () => {
    const prizes = prizesOf(red);
    const definitionId = 'replay-local-definition';
    const disclosure = {
      definitions: [
        {
          id: definitionId,
          name: 'Replay card',
          category: 'Pokémon' as const,
          imageUrl: '/replay.png',
        },
      ],
      zoneIds: [prizesOf(blue), prizes, handOf(red)],
      cards: [prizesOf(blue), prizes, handOf(red)].flatMap((zoneId) =>
        base.zones[zoneId]!.cards.map((card) =>
          knownAs(card, {
            definitionId: definitionId as KnownViewCard['definitionId'],
          })
        )
      ),
    };
    const replay = (zoneModes: Record<string, 'shown' | 'hidden'>) =>
      stateOf(base, {
        source: {
          kind: 'replay',
          replayId: 'replay',
          playbackGeneration: 1,
          frameIndex: 0,
        },
        canSubmitCommands: false,
        replayLocalDisplay: {
          disclosure: disclosure as never,
          zoneModes,
          cardModes: {},
        },
      });
    const card = cardOf(base, prizes);
    expect(contextActionOutcome(replay({}), card, 'revealPrizes')).toBe(
      'reveal'
    );
    expect(contextActionOutcome(replay({}), card, 'togglePrizes')).toBe('look');
    expect(
      contextActionOutcome(replay({ [prizes]: 'shown' }), card, 'revealPrizes')
    ).toBe('hide');
    expect(
      contextActionOutcome(replay({ [prizes]: 'shown' }), card, 'togglePrizes')
    ).toBe('cover');
    expect(
      contextActionOutcome(replay({ [prizes]: 'shown' }), card, 'revealCard')
    ).toBe('hide');
    // Not a card the replay can disclose: nothing to name.
    expect(
      contextActionOutcome(
        replay({}),
        cardOf(base, `zone:${blue}:deck`),
        'revealCard'
      )
    ).toBeNull();
  });
});
