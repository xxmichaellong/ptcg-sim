import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  type CommandContext,
  type MatchState,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import {
  emptyProjectionIdentityState,
  projectRecipient,
} from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

/**
 * A flipped Solo board acts for the other seat: its deck shortcuts shuffle
 * and privately view that seat's deck. Multiplayer keeps each deck its
 * owner's.
 */

const p1 = asPlayerId('solo-deck-controller');
const p2 = asPlayerId('solo-deck-other');
const context: CommandContext = {
  nextCardId: (() => {
    let card = 0;
    return () => asCardInstanceId(`solo-deck-card-${++card}`);
  })(),
  nextStackId: () => asStackId('solo-deck-stack'),
  nextInspectionId: () => asInspectionId('solo-deck-inspection'),
  nextWorkAreaId: () => asWorkAreaId('solo-deck-work-area'),
  shuffle: (values) => [...values].reverse(),
  randomInt: () => 0,
};
const session: AuthoritySession = {
  id: 'solo-deck-session',
  viewer: { kind: 'player', playerId: p1 },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};

const withOtherDeck = (count = 3): MatchState => {
  const empty = createEmptyMatch(asMatchId('solo-deck-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const loaded = executeCommand(
    empty,
    {
      type: 'LoadDeck',
      playerId: p2,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('solo-deck-definition'),
            name: 'Other seat card',
            category: 'Trainer',
            imageUrl: 'https://cards.example/other-seat.png',
          },
          count,
        },
      ],
    },
    context
  );
  if (!loaded.accepted) throw new Error(loaded.message);
  return loaded.state;
};

const resolve = (
  state: MatchState,
  command: WireGameCommand,
  mode: 'solo' | 'multiplayer',
  identities = emptyProjectionIdentityState()
) =>
  resolveWireCommand(
    state,
    identities,
    session,
    command,
    DEFAULT_AUTHORITY_POLICY,
    state.revision,
    { mode }
  );

describe("a flipped Solo board's deck shortcuts", () => {
  it("shuffle the other seat's deck in Solo only", () => {
    const state = withOtherDeck();
    const shuffle: WireGameCommand = {
      type: 'ShuffleZone',
      zoneId: playerZoneId(p2, 'deck'),
    };
    expect(resolve(state, shuffle, 'multiplayer')).toEqual({
      accepted: false,
      code: 'unauthorized',
    });
    const solo = resolve(state, shuffle, 'solo');
    expect(solo.accepted).toBe(true);
    if (!solo.accepted) return;
    expect(executeCommand(state, solo.command, context).accepted).toBe(true);
  });

  it("show the other seat's deck privately to Solo's player only", () => {
    const state = withOtherDeck();
    const look: WireGameCommand = {
      type: 'ExtractDeckCardsForInspection',
      ownerPlayerId: p2,
      count: 2,
      edge: 'top',
      visibility: 'private',
    };
    expect(resolve(state, look, 'multiplayer')).toEqual({
      accepted: false,
      code: 'unauthorized',
    });
    const solo = resolve(state, look, 'solo');
    expect(solo.accepted).toBe(true);
    if (!solo.accepted) return;
    expect(solo.command).toMatchObject({ playerId: p2, viewerIds: [p1] });
    const looked = executeCommand(state, solo.command, context);
    expect(looked.accepted).toBe(true);
    if (!looked.accepted) return;
    expect(looked.state.workAreas[p2]?.inspection?.cardIds).toHaveLength(2);
  });

  it("move a card out of the other seat's window in Solo only", () => {
    const state = withOtherDeck();
    const looked = resolve(
      state,
      {
        type: 'ExtractDeckCardsForInspection',
        ownerPlayerId: p2,
        count: 2,
        edge: 'top',
        visibility: 'private',
      },
      'solo'
    );
    if (!looked.accepted) throw new Error('look refused');
    const opened = executeCommand(state, looked.command, context);
    if (!opened.accepted) throw new Error(opened.message);
    let opaque = 0;
    const projected = projectRecipient(
      opened.state,
      session.viewer,
      emptyProjectionIdentityState(),
      {
        nextOpaqueId: (kind) =>
          `solo-deck-${kind}-${String(++opaque).padStart(8, '0')}`,
      },
      'solo'
    );
    const window = projected.snapshot.workAreas[p2]!.inspection!;
    const move: WireGameCommand = {
      type: 'MoveInspectedCard',
      cardId: window.cards[0]!.id,
      expectedWorkAreaId: window.id,
      destinationZoneId: playerZoneId(p2, 'hand'),
    };
    expect(
      resolve(opened.state, move, 'multiplayer', projected.identities)
    ).toEqual({ accepted: false, code: 'unauthorized' });
    const solo = resolve(opened.state, move, 'solo', projected.identities);
    expect(solo.accepted).toBe(true);
    if (!solo.accepted) return;
    const moved = executeCommand(opened.state, solo.command, context);
    expect(moved.accepted).toBe(true);
    if (!moved.accepted) return;
    expect(moved.state.zones[playerZoneId(p2, 'hand')]!.cardIds).toHaveLength(
      1
    );
  });

  it("look at the other seat's prizes once both seats have consented, as a Solo room's do", () => {
    const loaded = withOtherDeck(20);
    const prized = executeCommand(
      loaded,
      { type: 'SetupPlayer', playerId: p2 },
      context
    );
    if (!prized.accepted) throw new Error(prized.message);
    const solo: MatchState = {
      ...prized.state,
      players: Object.fromEntries(
        Object.entries(prized.state.players).map(([id, player]) => [
          id,
          { ...player, coachingConsent: true },
        ])
      ),
    };
    let opaque = 0;
    const projected = projectRecipient(
      solo,
      session.viewer,
      emptyProjectionIdentityState(),
      {
        nextOpaqueId: (kind) =>
          `solo-prize-${kind}-${String(++opaque).padStart(8, '0')}`,
      },
      'solo'
    );
    const prizes = projected.snapshot.zones[playerZoneId(p2, 'prizes')]!;
    expect(prizes.cards.length).toBeGreaterThan(0);
    const look: WireGameCommand = {
      type: 'BeginZoneInspection',
      targetPlayerId: p2,
      zoneId: prizes.id,
      expectedCardIds: prizes.cards.map((card) => card.id),
    };
    const resolved = resolve(solo, look, 'solo', projected.identities);
    expect(resolved.accepted).toBe(true);
    if (!resolved.accepted) return;
    expect(resolved.command).toMatchObject({ viewerPlayerId: p1 });
    expect(executeCommand(solo, resolved.command, context).accepted).toBe(true);
  });

  it("take the other seat's face-down prize, shuffle its discard back, and add to and close its window, in Solo only", () => {
    const prized = executeCommand(
      withOtherDeck(20),
      { type: 'SetupPlayer', playerId: p2 },
      context
    );
    if (!prized.accepted) throw new Error(prized.message);
    let state = prized.state;
    let opaque = 0;
    const project = () =>
      projectRecipient(
        state,
        session.viewer,
        emptyProjectionIdentityState(),
        {
          nextOpaqueId: (kind) =>
            `solo-more-${kind}-${String(++opaque).padStart(8, '0')}`,
        },
        'solo'
      );
    const both = (
      command: WireGameCommand,
      identities: ReturnType<typeof project>['identities']
    ) => {
      expect(resolve(state, command, 'multiplayer', identities)).toMatchObject({
        accepted: false,
      });
      const solo = resolve(state, command, 'solo', identities);
      if (!solo.accepted) throw new Error(`refused: ${command.type}`);
      const executed = executeCommand(state, solo.command, context);
      if (!executed.accepted) throw new Error(executed.message);
      state = executed.state;
      return solo.command;
    };

    // A face-down prize into its seat's hand.
    let projected = project();
    const prizes = projected.snapshot.zones[playerZoneId(p2, 'prizes')]!;
    expect(prizes.cards[0]!.kind).toBe('concealed');
    both(
      {
        type: 'MoveCard',
        cardId: prizes.cards[0]!.id,
        expectedSourceZoneId: prizes.id,
        destinationZoneId: playerZoneId(p2, 'hand'),
      },
      projected.identities
    );
    // Its discard shuffled into its own deck.
    projected = project();
    const hand = projected.snapshot.zones[playerZoneId(p2, 'hand')]!;
    both(
      {
        type: 'MoveCard',
        cardId: hand.cards[0]!.id,
        expectedSourceZoneId: hand.id,
        destinationZoneId: playerZoneId(p2, 'discard'),
      },
      projected.identities
    );
    projected = project();
    expect(
      both(
        {
          type: 'ShuffleZoneIntoDeck',
          sourceZoneId: playerZoneId(p2, 'discard'),
        },
        projected.identities
      )
    ).toMatchObject({ playerId: p2 });
    // A card dropped into its open window, which then closes.
    const opened = resolve(
      state,
      {
        type: 'ExtractDeckCardsForInspection',
        ownerPlayerId: p2,
        count: 1,
        edge: 'top',
        visibility: 'private',
      },
      'solo'
    );
    if (!opened.accepted) throw new Error('look refused');
    const looked = executeCommand(state, opened.command, context);
    if (!looked.accepted) throw new Error(looked.message);
    state = looked.state;
    projected = project();
    const window = projected.snapshot.workAreas[p2]!.inspection!;
    const inHand = projected.snapshot.zones[playerZoneId(p2, 'hand')]!;
    both(
      {
        type: 'MoveCardToWorkArea',
        cardId: inHand.cards[0]!.id,
        expectedWorkAreaId: window.id,
      },
      projected.identities
    );
    expect(state.workAreas[p2]?.inspection?.cardIds).toHaveLength(2);
    expect(
      both(
        {
          type: 'CloseInspection',
          expectedWorkAreaId: window.id,
          returnTo: 'top',
        },
        project().identities
      )
    ).toMatchObject({ playerId: p2 });
    expect(state.workAreas[p2]?.inspection).toBeNull();
  });
});
