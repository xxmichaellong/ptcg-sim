import { describe, expect, it } from 'vitest';

import { applyEventBatch } from './apply-events.js';
import type { CommandContext, GameCommand } from './commands.js';
import {
  createEmptyMatch,
  playerZoneId,
  stadiumZoneId,
} from './create-match.js';
import type { DomainEvent } from './events.js';
import { executeCommand } from './execute-command.js';
import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
} from './ids.js';

const blue = asPlayerId('arrangement-blue');
const red = asPlayerId('arrangement-red');

const fixture = (kind: 'hand' | 'board') => {
  let next = 0;
  const context: CommandContext = {
    nextCardId: () => asCardInstanceId(`arrangement-card-${++next}`),
    nextStackId: () => asStackId(`arrangement-stack-${++next}`),
    nextInspectionId: () => asInspectionId(`arrangement-inspection-${++next}`),
    nextWorkAreaId: () => asWorkAreaId(`arrangement-work-${++next}`),
    shuffle: (cards) => [...cards],
    randomInt: () => 0,
  };
  let state = createEmptyMatch(asMatchId('arrangement-order'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red' },
  ]);
  const run = (command: GameCommand) => {
    const result = executeCommand(state, command, context);
    if (!result.accepted) throw new Error(result.message);
    state = result.state;
    return result;
  };
  run({
    type: 'LoadDeck',
    playerId: blue,
    entries: [
      {
        definition: {
          id: asCardDefinitionId('arrangement-definition'),
          name: 'Card',
          category: 'Pokémon',
          imageUrl: '/card',
        },
        count: 4,
      },
    ],
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
  // Internal/historical hand states may also contain a retyped card. The
  // ordering operation must preserve it just as it preserves a native board card.
  run({ type: 'SetCardCategory', cardId: selected!, category: 'Energy' });
  if (kind === 'board')
    run({
      type: 'SetPublicReveal',
      actorPlayerId: blue,
      playerId: blue,
      cardId: selected!,
      expectedSourceId: zone,
      revealed: false,
    });
  for (const playerId of [blue, red])
    run({ type: 'SetCoachingConsent', playerId, consent: true });
  run({
    type: 'BeginCardInspection',
    playerId: blue,
    viewerPlayerId: red,
    cardId: selected!,
    expectedSourceId: zone,
  });
  if (kind === 'hand')
    run({
      type: 'SetPublicReveal',
      actorPlayerId: blue,
      playerId: blue,
      cardId: selected!,
      expectedSourceId: zone,
      revealed: true,
    });
  return {
    state,
    context,
    zone,
    deck,
    selected: selected!,
    second: second!,
    third: third!,
    spare: spare!,
  };
};

const order = (prepared: ReturnType<typeof fixture>) => ({
  type: 'MoveCard' as const,
  cardId: prepared.selected,
  expectedSourceZoneId: prepared.zone,
  destinationZoneId: prepared.zone,
  destinationIndex: 2,
  arrangementOrderVersion: 1 as const,
});

describe('versioned native hand and loose-board arrangement', () => {
  it.each(['hand', 'board'] as const)(
    'changes only the %s order, preserving exact card and visibility references',
    (kind) => {
      const prepared = fixture(kind);
      const before = structuredClone(prepared.state);
      const result = executeCommand(
        prepared.state,
        order(prepared),
        prepared.context
      );
      if (!result.accepted) throw new Error(result.message);
      expect(result.batch.events).toEqual([
        {
          type: 'CardMoved',
          cardId: prepared.selected,
          expectedSourceZoneId: prepared.zone,
          destinationZoneId: prepared.zone,
          destinationIndex: 2,
          concealIdentity: false,
          arrangementOrderVersion: 1,
        },
      ]);
      expect(result.state).toEqual({
        ...before,
        revision: before.revision + 1,
        zones: {
          ...before.zones,
          [prepared.zone]: {
            ...before.zones[prepared.zone]!,
            cardIds: [prepared.second, prepared.third, prepared.selected],
          },
        },
      });
      expect(result.state.cards).toBe(prepared.state.cards);
      expect(result.state.visibility).toBe(prepared.state.visibility);
      expect(prepared.state).toEqual(before);
      expect(
        applyEventBatch(
          prepared.state,
          JSON.parse(JSON.stringify(result.batch))
        )
      ).toEqual(result.state);
      const clamped = executeCommand(
        prepared.state,
        { ...order(prepared), destinationIndex: 999 },
        prepared.context
      );
      expect(clamped.accepted && clamped.state).toEqual(result.state);
    }
  );

  it.each(['hand', 'board'] as const)(
    'preserves unflagged historical %s movement behavior',
    (kind) => {
      const prepared = fixture(kind);
      const { arrangementOrderVersion: _version, ...legacy } = order(prepared);
      const result = executeCommand(prepared.state, legacy, prepared.context);
      if (!result.accepted) throw new Error(result.message);
      expect(result.batch.events[0]).not.toHaveProperty(
        'arrangementOrderVersion'
      );
      expect(result.state.cards[prepared.selected]).toMatchObject({
        face: 'up',
        currentCategory: kind === 'hand' ? 'Pokémon' : 'Energy',
        visibilityGeneration:
          prepared.state.cards[prepared.selected]!.visibilityGeneration +
          (kind === 'hand' ? 1 : 0),
      });
      expect(result.state.visibility).toEqual({
        publicCardIds: [],
        inspectionGrants: {},
      });
      expect(
        applyEventBatch(
          prepared.state,
          JSON.parse(JSON.stringify(result.batch))
        )
      ).toEqual(result.state);
    }
  );

  it('rejects malformed, combined, implicit-index, cross-zone and unsupported-zone command modes atomically', () => {
    const prepared = fixture('hand');
    const before = structuredClone(prepared.state);
    const invalid = [
      ...[0, 2, true, false, null, '1'].map((arrangementOrderVersion) => ({
        ...order(prepared),
        arrangementOrderVersion,
      })),
      ...[
        undefined,
        null,
        -1,
        0.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
      ].map((destinationIndex) => ({ ...order(prepared), destinationIndex })),
      ...[1, 2, null].map((publicPileOrderVersion) => ({
        ...order(prepared),
        publicPileOrderVersion,
      })),
      { ...order(prepared), destinationZoneId: playerZoneId(blue, 'board') },
      {
        ...order(prepared),
        cardId: prepared.spare,
        expectedSourceZoneId: prepared.deck,
        destinationZoneId: prepared.deck,
      },
    ];
    for (const command of invalid) {
      expect(
        executeCommand(
          prepared.state,
          command as unknown as GameCommand,
          prepared.context
        )
      ).toMatchObject({ accepted: false, code: 'invalid_command' });
      expect(prepared.state).toEqual(before);
    }
    for (const kind of ['discard', 'lostZone', 'prizes', 'stadium'] as const) {
      const zone =
        kind === 'stadium' ? stadiumZoneId() : playerZoneId(blue, kind);
      const moved = executeCommand(
        prepared.state,
        {
          type: 'MoveCard',
          cardId: prepared.spare,
          expectedSourceZoneId: prepared.deck,
          destinationZoneId: zone,
        },
        prepared.context
      );
      if (!moved.accepted) throw new Error(moved.message);
      const unsupported = {
        ...order(prepared),
        cardId: prepared.spare,
        expectedSourceZoneId: zone,
        destinationZoneId: zone,
        destinationIndex: 0,
      };
      expect(
        executeCommand(
          moved.state,
          unsupported as GameCommand,
          prepared.context
        )
      ).toMatchObject({ accepted: false, code: 'invalid_command' });
      if (kind === 'discard' || kind === 'lostZone') {
        for (const arrangementOrderVersion of [1, 2, null]) {
          const combined = {
            ...unsupported,
            publicPileOrderVersion: 1,
            arrangementOrderVersion,
          };
          expect(
            executeCommand(
              moved.state,
              combined as unknown as GameCommand,
              prepared.context
            )
          ).toMatchObject({ accepted: false, code: 'invalid_command' });
          expect(() =>
            applyEventBatch(moved.state, {
              revision: moved.state.revision + 1,
              events: [
                {
                  ...combined,
                  type: 'CardMoved',
                  concealIdentity: false,
                } as unknown as DomainEvent,
              ],
            })
          ).toThrow();
        }
      }
    }
  });

  it('rejects forged event versions, concealment, combinations and sources without mutating input', () => {
    const prepared = fixture('hand');
    const event = {
      ...order(prepared),
      type: 'CardMoved',
      concealIdentity: false,
    };
    const invalid = [
      ...[0, 2, true, false, null, '1'].map((arrangementOrderVersion) => ({
        ...event,
        arrangementOrderVersion,
      })),
      ...[1, 2, null].map((publicPileOrderVersion) => ({
        ...event,
        publicPileOrderVersion,
      })),
      ...[undefined, null, -1, 0.5, NaN, Infinity].map((destinationIndex) => ({
        ...event,
        destinationIndex,
      })),
      { ...event, concealIdentity: true },
      { ...event, destinationZoneId: playerZoneId(blue, 'board') },
      {
        ...event,
        cardId: prepared.spare,
        expectedSourceZoneId: prepared.deck,
        destinationZoneId: prepared.deck,
      },
    ];
    const before = structuredClone(prepared.state);
    for (const forged of invalid) {
      expect(() =>
        applyEventBatch(prepared.state, {
          revision: prepared.state.revision + 1,
          events: [forged as unknown as DomainEvent],
        })
      ).toThrow();
      expect(prepared.state).toEqual(before);
    }
  });
});
