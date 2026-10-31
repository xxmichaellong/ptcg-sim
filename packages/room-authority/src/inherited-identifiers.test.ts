import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  asZoneId,
  assertMatchInvariants,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  type CommandContext,
  type GameCommand,
  type MatchState,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import {
  emptyProjectionIdentityState,
  projectRecipient,
} from './identity-registry.js';
import {
  DEFAULT_AUTHORITY_POLICY,
  type AuthorityMode,
  type AuthoritySession,
} from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const inheritedKeys = [
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
];
const blue = asPlayerId('own-entry-blue');
const red = asPlayerId('own-entry-red');
const fixture = (mode: AuthorityMode) => {
  let next = 0;
  const context: CommandContext = {
    nextCardId: () => asCardInstanceId(`own-entry-card-${++next}`),
    nextStackId: () => asStackId(`own-entry-stack-${++next}`),
    nextInspectionId: () => asInspectionId(`own-entry-inspection-${++next}`),
    nextWorkAreaId: () => asWorkAreaId(`own-entry-work-${++next}`),
    shuffle: (cards) => [...cards],
    randomInt: () => 0,
  };
  let state = createEmptyMatch(asMatchId('own-entry-match'), [
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
    entries: [
      {
        definition: {
          id: asCardDefinitionId('own-entry-definition'),
          name: 'Card',
          category: 'Pokémon',
          imageUrl: '/card',
        },
        count: 3,
      },
    ],
  });
  const deckId = playerZoneId(blue, 'deck');
  run({
    type: 'MoveCardToPlay',
    cardId: state.zones[deckId]!.cardIds[0]!,
    expectedSourceZoneId: deckId,
    boardPlayerId: blue,
    slot: 'active',
  });
  run({ type: 'DrawCards', playerId: blue, count: 1 });
  const session: AuthoritySession = {
    id: 'own-entry-session',
    viewer: { kind: 'player', playerId: blue },
    active: true,
    nextClientSequence: 1,
    recentOutcomes: [],
  };
  const projected = projectRecipient(
    state,
    session.viewer,
    emptyProjectionIdentityState(),
    {
      nextOpaqueId: (kind) =>
        `own-entry-${kind}-${String(++next).padStart(12, '0')}`,
    },
    mode
  );
  const handId = playerZoneId(blue, 'hand');
  const hand = projected.snapshot.zones[handId]!.cards[0]!;
  const stackId = state.boards[blue]!.activeStackId!;
  const top = projected.snapshot.stacks[stackId]!.evolutionCards[0]!;
  const resolve = (command: WireGameCommand, current: MatchState = state) =>
    resolveWireCommand(
      current,
      projected.identities,
      session,
      command,
      DEFAULT_AUTHORITY_POLICY,
      current.revision,
      { mode }
    );
  return { state, handId, hand, stackId, top, resolve };
};

for (const mode of ['multiplayer', 'solo'] as const) {
  describe(`${mode} native reference membership`, () => {
    it.each(inheritedKeys)(
      'rejects inherited %s references before reduction',
      (key) => {
        const f = fixture(mode);
        const commands: readonly WireGameCommand[] = [
          { type: 'LoadDeck', targetPlayerId: key, entries: [] },
          { type: 'ResetPlayer', targetPlayerId: key },
          { type: 'SetupPlayer', targetPlayerId: key },
          { type: 'SetCardBack', targetPlayerId: key, cardBackUrl: '/back' },
          { type: 'DrawCards', targetPlayerId: key, count: 1 },
          { type: 'DiscardHandAndDraw', targetPlayerId: key, count: 1 },
          { type: 'ShuffleHandIntoDeckAndDraw', targetPlayerId: key, count: 1 },
          {
            type: 'ShuffleHandToDeckBottomAndDraw',
            targetPlayerId: key,
            count: 1,
          },
          { type: 'FlipCoin', targetPlayerId: key },
          {
            type: 'SetOncePerGameMarker',
            targetPlayerId: key,
            marker: 'gx',
            used: true,
          },
          { type: 'ApplySoloUndo', targetPlayerId: key },
          {
            type: 'MoveCard',
            cardId: f.hand.id,
            expectedSourceZoneId: f.handId,
            destinationZoneId: key,
          },
          {
            type: 'MoveCard',
            cardId: key,
            expectedSourceZoneId: f.handId,
            destinationZoneId: playerZoneId(blue, 'discard'),
          },
          {
            type: 'MoveCardToPlay',
            cardId: f.hand.id,
            expectedSourceZoneId: f.handId,
            boardPlayerId: key,
            slot: 'bench',
          },
          {
            type: 'MoveCardToPlay',
            cardId: f.hand.id,
            expectedSourceZoneId: f.handId,
            boardPlayerId: blue,
            slot: 'bench',
            targetStackId: key,
          },
          {
            type: 'PlaceCardOnPlayStack',
            cardId: f.hand.id,
            expectedSourceId: f.handId,
            targetStackId: key,
            expectedTargetTopCardId: f.top.id,
            mode: 'evolution',
          },
          {
            type: 'MoveCardFromStack',
            cardId: f.top.id,
            expectedStackId: f.stackId,
            destinationZoneId: key,
          },
          { type: 'ShuffleZone', zoneId: key },
          { type: 'SetDamage', stackId: key, damage: 10 },
          { type: 'SetAbilityUsed', stackId: key, used: true },
          { type: 'RotateStack', stackId: key, rotationQuarterTurns: 1 },
          { type: 'EndPrivateInspection', inspectionId: key },
          {
            type: 'ExtractDeckCardsForInspection',
            ownerPlayerId: key,
            count: 1,
            edge: 'top',
            visibility: 'private',
          },
          {
            type: 'RestoreStagedStack',
            targetPlayerId: key,
            expectedWorkAreaId: 'missing-work',
            expectedActiveStackId: null,
            expectedBenchStackIds: [],
            destinationSlot: 'bench',
          },
          {
            type: 'ResolveStagedCards',
            targetPlayerId: key,
            expectedWorkAreaId: 'missing-work',
            destination: 'discard',
          },
          {
            type: 'ResolveInspectionCards',
            targetPlayerId: key,
            expectedWorkAreaId: 'missing-work',
            destination: 'discard',
          },
        ];
        for (const command of commands)
          expect(f.resolve(command), command.type).toEqual({
            accepted: false,
            // Multiplayer refuses another seat's private windows before it
            // looks them up; the own-entry guard does not broaden that policy.
            code:
              mode === 'multiplayer' &&
              (command.type === 'RestoreStagedStack' ||
                command.type === 'ResolveStagedCards' ||
                command.type === 'ResolveInspectionCards')
                ? 'unauthorized'
                : 'stale_reference',
          });
      }
    );

    it.each(inheritedKeys)(
      'keeps actual own entries and namespaced definitions named %s usable',
      (key) => {
        const f = fixture(mode);
        const zoneId = asZoneId(key);
        const ownZoneState: MatchState = {
          ...f.state,
          zones: {
            ...f.state.zones,
            [key]: { id: zoneId, kind: 'deck', ownerId: blue, cardIds: [] },
          },
        };
        assertMatchInvariants(ownZoneState);
        expect(
          f.resolve({ type: 'ShuffleZone', zoneId: key }, ownZoneState)
        ).toEqual({ accepted: true, command: { type: 'ShuffleZone', zoneId } });
        const { [f.stackId]: originalStack, ...otherStacks } = f.state.stacks;
        const ownStackState: MatchState = {
          ...f.state,
          stacks: {
            ...otherStacks,
            [key]: { ...originalStack!, id: asStackId(key) },
          },
          boards: {
            ...f.state.boards,
            [blue]: { ...f.state.boards[blue]!, activeStackId: asStackId(key) },
          },
        };
        assertMatchInvariants(ownStackState);
        expect(
          f.resolve(
            { type: 'SetDamage', stackId: key, damage: 10 },
            ownStackState
          )
        ).toEqual({
          accepted: true,
          command: { type: 'SetDamage', stackId: key, damage: 10 },
        });
        const empty = createEmptyMatch(asMatchId('own-player-key'), [
          { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue' },
          { playerId: red, displayName: 'Other', cardBackUrl: '/other' },
        ]);
        // Rename the empty second seat's keyed containers explicitly: the
        // native room factory itself only generates ordinary player IDs.
        const playerId = asPlayerId(key);
        const rename = <Value>(record: Readonly<Record<string, Value>>) =>
          Object.fromEntries(
            Object.entries(record).map(([id, value]) => [
              id === red ? key : id,
              value,
            ])
          );
        const ownPlayerState: MatchState = {
          ...empty,
          playerOrder: [blue, playerId],
          players: {
            ...rename(empty.players),
            [key]: { ...empty.players[red]!, id: playerId },
          },
          deckLists: rename(empty.deckLists),
          boards: rename(empty.boards),
          workAreas: rename(empty.workAreas),
          zones: Object.fromEntries(
            Object.values(empty.zones).map((zone) => {
              const renamed =
                zone.ownerId === red && zone.kind !== 'stadium'
                  ? {
                      ...zone,
                      id: playerZoneId(playerId, zone.kind),
                      ownerId: playerId,
                    }
                  : zone;
              return [renamed.id, renamed];
            })
          ),
        };
        assertMatchInvariants(ownPlayerState);
        expect(
          f.resolve({ type: 'FlipCoin', targetPlayerId: key }, ownPlayerState)
        ).toEqual({
          accepted: true,
          command: { type: 'FlipCoin', playerId: key },
        });
        const handCardId = f.state.zones[f.handId]!.cardIds[0]!;
        const ownGrantState: MatchState = {
          ...f.state,
          visibility: {
            ...f.state.visibility,
            inspectionGrants: {
              [key]: {
                inspectionId: asInspectionId(key),
                scope: 'card',
                sourcePlayerId: blue,
                sourceId: f.handId,
                cardIds: [handCardId],
                viewerIds: [blue],
              },
            },
          },
        };
        assertMatchInvariants(ownGrantState);
        expect(
          f.resolve(
            { type: 'EndPrivateInspection', inspectionId: key },
            ownGrantState
          )
        ).toEqual({
          accepted: true,
          command: {
            type: 'EndPrivateInspection',
            viewerPlayerId: blue,
            inspectionId: key,
          },
        });
        const loaded = f.resolve({
          type: 'LoadDeck',
          entries: [
            {
              definition: {
                id: key,
                name: 'Own definition',
                category: 'Pokémon',
                imageUrl: '/card',
              },
              count: 1,
            },
          ],
        });
        expect(loaded).toMatchObject({
          accepted: true,
          command: {
            type: 'LoadDeck',
            entries: [{ definition: { id: `${blue}/${key}` } }],
          },
        });
      }
    );
  });
}
