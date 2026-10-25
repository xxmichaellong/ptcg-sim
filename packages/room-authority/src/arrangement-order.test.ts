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
  type GameCommand,
  type MatchState,
  type ViewerRole,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import {
  emptyProjectionIdentityState,
  projectRecipient,
} from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const blue = asPlayerId('arrangement-blue');
const red = asPlayerId('arrangement-red');
const session: AuthoritySession = {
  id: 'arrangement-session',
  viewer: { kind: 'player', playerId: blue },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};
const viewers: readonly ViewerRole[] = [
  session.viewer,
  { kind: 'player', playerId: red },
  { kind: 'spectator' },
];

const fixture = (kind: 'hand' | 'board', inspected = true) => {
  let next = 0;
  const context: CommandContext = {
    nextCardId: () => asCardInstanceId(`arrangement-card-${++next}`),
    nextStackId: () => asStackId(`arrangement-stack-${++next}`),
    nextInspectionId: () => asInspectionId(`arrangement-inspection-${++next}`),
    nextWorkAreaId: () => asWorkAreaId(`arrangement-work-${++next}`),
    shuffle: (cards) => [...cards],
    randomInt: () => 0,
  };
  let state = createEmptyMatch(asMatchId('native-arrangement'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red' },
  ]);
  const run = (command: GameCommand) => {
    const result = executeCommand(state, command, context);
    if (!result.accepted) throw new Error(result.message);
    state = result.state;
  };
  run({
    type: 'LoadDeck',
    playerId: blue,
    entries: [0, 1, 2, 3].map((index) => ({
      definition: {
        id: asCardDefinitionId(`arrangement-definition-${index}`),
        name: `Card ${index}`,
        category: 'Pokémon' as const,
        imageUrl: `/arrangement-${index}.png`,
      },
      count: 1,
    })),
  });
  const deck = playerZoneId(blue, 'deck');
  const zone = playerZoneId(blue, kind);
  const [selected, second, third, spare] = state.zones[deck]!.cardIds;
  for (const cardId of [selected!, second!, third!])
    run({
      type: 'MoveCard',
      cardId,
      expectedSourceZoneId: deck,
      destinationZoneId: zone,
    });
  if (kind === 'board')
    run({
      type: 'ChangeCardCategory',
      playerId: blue,
      cardId: selected!,
      expectedSourceId: zone,
      category: 'Energy',
    });
  if (kind === 'board')
    run({
      type: 'SetPublicReveal',
      actorPlayerId: blue,
      playerId: blue,
      cardId: selected!,
      expectedSourceId: zone,
      revealed: false,
    });
  if (inspected) {
    for (const playerId of [blue, red])
      run({ type: 'SetCoachingConsent', playerId, consent: true });
    run({
      type: 'BeginCardInspection',
      playerId: blue,
      viewerPlayerId: red,
      cardId: selected!,
      expectedSourceId: zone,
    });
  }
  if (kind === 'hand')
    run({
      type: 'SetPublicReveal',
      actorPlayerId: blue,
      playerId: blue,
      cardId: selected!,
      expectedSourceId: zone,
      revealed: true,
    });
  const opaqueIds = {
    nextOpaqueId: (type: 'card' | 'definition') =>
      `arrangement-${type}-${String(++next).padStart(12, '0')}`,
  };
  let identities = emptyProjectionIdentityState();
  const project = (current: MatchState, viewer: ViewerRole) => {
    const result = projectRecipient(
      current,
      viewer,
      identities,
      opaqueIds,
      'multiplayer'
    );
    identities = result.identities;
    return result.snapshot;
  };
  const before = viewers.map((viewer) => project(state, viewer));
  const alias = before[0]!.zones[zone]!.cards.find(
    (card) =>
      card.kind === 'known' &&
      card.category === (kind === 'board' ? 'Energy' : 'Pokémon')
  )!.id;
  const command = {
    type: 'MoveCard' as const,
    cardId: alias,
    expectedSourceZoneId: zone,
    destinationZoneId: zone,
    destinationIndex: kind === 'board' ? 0 : 2,
  };
  const resolve = (
    wire: WireGameCommand = command,
    current = state,
    actor = session,
    policy = DEFAULT_AUTHORITY_POLICY
  ) =>
    resolveWireCommand(
      current,
      identities,
      actor,
      wire,
      policy,
      state.revision
    );
  return {
    state,
    context,
    zone,
    deck,
    selected: selected!,
    spare: spare!,
    before,
    project,
    command,
    resolve,
  };
};

describe('native arrangement resolution and disclosure', () => {
  it.each(['hand', 'board'] as const)(
    'opts explicit same-zone %s ordering in and preserves every recipient alias, grant and disclosure',
    (kind) => {
      const prepared = fixture(kind);
      const resolved = prepared.resolve();
      expect(resolved).toMatchObject({
        accepted: true,
        command: { arrangementOrderVersion: 1 },
      });
      if (!resolved.accepted) throw new Error(resolved.code);
      const result = executeCommand(
        prepared.state,
        resolved.command,
        prepared.context
      );
      if (!result.accepted) throw new Error(result.message);
      expect(result.state.cards).toBe(prepared.state.cards);
      expect(result.state.visibility).toBe(prepared.state.visibility);
      viewers.forEach((viewer, index) => {
        const after = prepared.project(result.state, viewer);
        expect(after.zones[prepared.zone]!.cards).toEqual(
          kind === 'board'
            ? [
                prepared.before[index]!.zones[prepared.zone]!.cards[2],
                ...prepared.before[index]!.zones[prepared.zone]!.cards.slice(
                  0,
                  2
                ),
              ]
            : [
                ...prepared.before[index]!.zones[prepared.zone]!.cards.slice(1),
                prepared.before[index]!.zones[prepared.zone]!.cards[0],
              ]
        );
        expect(after.definitions).toEqual(prepared.before[index]!.definitions);
        expect(after.privateInspections).toEqual(
          prepared.before[index]!.privateInspections
        );
      });
    }
  );

  it('never reveals a hidden loose-board card or its unique artwork when it is rearranged', () => {
    const prepared = fixture('board', false);
    const resolved = prepared.resolve();
    if (!resolved.accepted) throw new Error(resolved.code);
    const result = executeCommand(
      prepared.state,
      resolved.command,
      prepared.context
    );
    if (!result.accepted) throw new Error(result.message);
    for (const index of [1, 2]) {
      expect(JSON.stringify(prepared.before[index])).not.toContain(
        '/arrangement-0.png'
      );
      const after = prepared.project(result.state, viewers[index]!);
      expect(JSON.stringify(after)).not.toContain('/arrangement-0.png');
      expect(after.zones[prepared.zone]!.cards[0]).toEqual(
        prepared.before[index]!.zones[prepared.zone]!.cards[2]
      );
      expect(after.zones[prepared.zone]!.cards[0]!.kind).toBe('concealed');
    }
  });

  it.each(['hand', 'board'] as const)(
    'keeps omitted-index and cross-zone %s movement unflagged',
    (kind) => {
      const prepared = fixture(kind);
      const { destinationIndex: _index, ...implicit } = prepared.command;
      for (const wire of [
        implicit,
        {
          ...prepared.command,
          destinationZoneId: playerZoneId(blue, 'discard'),
        },
      ]) {
        const resolved = prepared.resolve(wire);
        if (!resolved.accepted) throw new Error(resolved.code);
        expect(resolved.command).not.toHaveProperty('arrangementOrderVersion');
      }
    }
  );

  it('keeps spectators and own-cards-only policy excluded and rejects a source that departed', () => {
    const prepared = fixture('board');
    expect(
      prepared.resolve(prepared.command, prepared.state, {
        ...session,
        viewer: { kind: 'spectator' },
      })
    ).toEqual({ accepted: false, code: 'unauthorized' });
    const redView = prepared.before[1]!;
    const redCard = redView.zones[prepared.zone]!.cards[2]!;
    expect(
      prepared.resolve(
        { ...prepared.command, cardId: redCard.id },
        prepared.state,
        { ...session, viewer: { kind: 'player', playerId: red } },
        { ...DEFAULT_AUTHORITY_POLICY, allowOpponentPublicInteraction: false }
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
    const moved = executeCommand(
      prepared.state,
      {
        type: 'MoveCard',
        cardId: prepared.selected,
        expectedSourceZoneId: prepared.zone,
        destinationZoneId: playerZoneId(blue, 'discard'),
      },
      prepared.context
    );
    if (!moved.accepted) throw new Error(moved.message);
    const resolved = prepared.resolve(prepared.command, moved.state);
    if (!resolved.accepted) throw new Error(resolved.code);
    expect(
      executeCommand(moved.state, resolved.command, prepared.context)
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
  });
});
