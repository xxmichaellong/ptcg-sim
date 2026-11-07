import { describe, expect, it } from 'vitest';

import { applyEventBatch } from './apply-events.js';
import type { CommandContext, GameCommand } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
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

const blue = asPlayerId('pile-blue');
const red = asPlayerId('pile-red');

const fixture = (kind: 'discard' | 'lostZone' = 'discard') => {
  let next = 0;
  const context: CommandContext = {
    nextCardId: () => asCardInstanceId(`pile-card-${++next}`),
    nextStackId: () => asStackId(`pile-stack-${++next}`),
    nextInspectionId: () => asInspectionId(`pile-inspection-${++next}`),
    nextWorkAreaId: () => asWorkAreaId(`pile-work-${++next}`),
    shuffle: (cards) => [...cards],
    randomInt: () => 0,
  };
  let state = createEmptyMatch(asMatchId('pile-order'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red' },
  ]);
  const run = (command: GameCommand) => {
    const result = executeCommand(state, command, context);
    if (!result.accepted) throw new Error(result.message);
    state = result.state;
    return result;
  };
  for (const playerId of [blue, red])
    run({
      type: 'LoadDeck',
      playerId,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('pile-definition'),
            name: 'Pile card',
            category: 'Pokémon',
            imageUrl: '/pile',
          },
          count: 4,
        },
      ],
    });
  const pileId = playerZoneId(blue, kind);
  const [hidden, revealed, spare] =
    state.zones[playerZoneId(blue, 'deck')]!.cardIds;
  const foreign = state.zones[playerZoneId(red, 'deck')]!.cardIds[0]!;
  for (const [cardId, ownerId] of [
    [hidden!, blue],
    [revealed!, blue],
    [foreign, red],
  ] as const)
    run({
      type: 'MoveCard',
      cardId,
      expectedSourceZoneId: playerZoneId(ownerId, 'deck'),
      destinationZoneId: pileId,
    });
  run({ type: 'SetCardCategory', cardId: hidden!, category: 'Energy' });
  if (kind === 'discard')
    run({ type: 'SetCardAbilityUsed', cardId: hidden!, used: true });
  run({ type: 'SetCardFace', cardId: hidden!, face: 'down' });
  for (const playerId of [blue, red])
    run({ type: 'SetCoachingConsent', playerId, consent: true });
  run({
    type: 'BeginCardInspection',
    playerId: blue,
    viewerPlayerId: red,
    cardId: hidden!,
    expectedSourceId: pileId,
  });
  run({
    type: 'SetPublicReveal',
    actorPlayerId: blue,
    playerId: blue,
    cardId: revealed!,
    expectedSourceId: pileId,
    revealed: true,
  });
  return {
    state,
    context,
    pileId,
    hidden: hidden!,
    revealed: revealed!,
    foreign,
    spare: spare!,
  };
};

const order = (
  prepared: ReturnType<typeof fixture>,
  destinationIndex?: number
) => ({
  type: 'MoveCard' as const,
  cardId: prepared.hidden,
  expectedSourceZoneId: prepared.pileId,
  destinationZoneId: prepared.pileId,
  publicPileOrderVersion: 1 as const,
  ...(destinationIndex === undefined ? {} : { destinationIndex }),
});

const accepted = (
  prepared: ReturnType<typeof fixture>,
  command: GameCommand
) => {
  const result = executeCommand(prepared.state, command, prepared.context);
  if (!result.accepted) throw new Error(result.message);
  return result;
};

describe('native public-pile order', () => {
  it.each(['discard', 'lostZone'] as const)(
    'reorders %s without changing cards, ownership, reveals or grants',
    (kind) => {
      const prepared = fixture(kind);
      const before = structuredClone(prepared.state);
      const result = accepted(prepared, order(prepared));
      expect(result.batch.events).toEqual([
        {
          type: 'CardMoved',
          cardId: prepared.hidden,
          expectedSourceZoneId: prepared.pileId,
          destinationZoneId: prepared.pileId,
          destinationIndex: 3,
          concealIdentity: false,
          publicPileOrderVersion: 1,
        },
      ]);
      expect(result.state.zones[prepared.pileId]!.cardIds).toEqual([
        prepared.revealed,
        prepared.foreign,
        prepared.hidden,
      ]);
      expect(result.state).toEqual({
        ...before,
        revision: before.revision + 1,
        zones: {
          ...before.zones,
          [prepared.pileId]: {
            ...before.zones[prepared.pileId]!,
            cardIds: [prepared.revealed, prepared.foreign, prepared.hidden],
          },
        },
      });
      expect(prepared.state).toEqual(before);
      expect(applyEventBatch(prepared.state, result.batch)).toEqual(
        result.state
      );

      const bottom = accepted(
        { ...prepared, state: result.state },
        order(prepared, 0)
      );
      expect(bottom.state.cards).toEqual(before.cards);
      expect(bottom.state.visibility).toEqual(before.visibility);
      expect(bottom.state.zones[prepared.pileId]!.cardIds).toEqual([
        prepared.hidden,
        prepared.revealed,
        prepared.foreign,
      ]);
      const revealed = accepted(
        { ...prepared, state: bottom.state },
        { ...order(prepared), cardId: prepared.revealed }
      );
      expect(revealed.state.cards).toEqual(before.cards);
      expect(revealed.state.visibility).toEqual(before.visibility);
      expect(revealed.state.zones[prepared.pileId]!.cardIds).toEqual([
        prepared.hidden,
        prepared.foreign,
        prepared.revealed,
      ]);
    }
  );

  it('keeps unflagged commands and historical events on their original normalization path', () => {
    const prepared = fixture();
    const { publicPileOrderVersion: _version, ...legacyCommand } =
      order(prepared);
    const legacy = accepted(prepared, legacyCommand);
    expect(legacy.batch.events[0]).not.toHaveProperty('publicPileOrderVersion');
    expect(legacy.state.cards[prepared.hidden]).toMatchObject({
      face: 'up',
      currentCategory: 'Pokémon',
      abilityUsed: false,
    });
    expect(legacy.state.visibility.inspectionGrants).toEqual({});
    expect(
      applyEventBatch(prepared.state, JSON.parse(JSON.stringify(legacy.batch)))
    ).toEqual(legacy.state);

    const revealedMove = accepted(prepared, {
      ...legacyCommand,
      cardId: prepared.revealed,
      destinationIndex: 0,
    });
    expect(revealedMove.state.visibility.publicCardIds).not.toContain(
      prepared.revealed
    );
  });

  it('undoes the reorder to its exact prior order and metadata', () => {
    const prepared = fixture();
    const moved = accepted(prepared, order(prepared));
    const undone = accepted(
      { ...prepared, state: moved.state },
      {
        type: 'ApplySoloUndo',
        actorPlayerId: blue,
        targetPlayerId: blue,
        revertedCommandId: 'pile-order-command',
        revertedRevision: moved.state.revision,
        checkpoint: prepared.state,
      }
    );
    expect(undone.state).toEqual({
      ...prepared.state,
      revision: moved.state.revision + 1,
    });
    expect(applyEventBatch(moved.state, undone.batch)).toEqual(undone.state);
  });

  it.each([0, 2, true, false, null, '1'])(
    'rejects an unsupported internal mode %s atomically',
    (version) => {
      const prepared = fixture();
      const before = structuredClone(prepared.state);
      expect(
        executeCommand(
          prepared.state,
          {
            ...order(prepared),
            publicPileOrderVersion: version,
          } as unknown as GameCommand,
          prepared.context
        )
      ).toMatchObject({ accepted: false, code: 'invalid_command' });
      expect(prepared.state).toEqual(before);
    }
  );

  it('rejects the internal mode outside a same-zone public pile', () => {
    const prepared = fixture();
    for (const destinationZoneId of [
      playerZoneId(blue, 'hand'),
      playerZoneId(blue, 'lostZone'),
    ])
      expect(
        executeCommand(
          prepared.state,
          { ...order(prepared), destinationZoneId },
          prepared.context
        )
      ).toMatchObject({ accepted: false, code: 'invalid_command' });
    const deckId = playerZoneId(blue, 'deck');
    expect(
      executeCommand(
        prepared.state,
        {
          ...order(prepared),
          cardId: prepared.spare,
          expectedSourceZoneId: deckId,
          destinationZoneId: deckId,
        },
        prepared.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
  });

  it('refuses forged preservation events and retains the input on every failure', () => {
    const prepared = fixture();
    const event = {
      type: 'CardMoved',
      cardId: prepared.hidden,
      expectedSourceZoneId: prepared.pileId,
      destinationZoneId: prepared.pileId,
      destinationIndex: 0,
      concealIdentity: false,
      publicPileOrderVersion: 1,
    } as const;
    const before = structuredClone(prepared.state);
    const invalid = [
      ...[0, 2, true, false, null, '1'].map((publicPileOrderVersion) => ({
        ...event,
        publicPileOrderVersion,
      })),
      { ...event, destinationZoneId: playerZoneId(blue, 'lostZone') },
      { ...event, concealIdentity: true },
      {
        ...event,
        cardId: prepared.spare,
        expectedSourceZoneId: playerZoneId(blue, 'deck'),
        destinationZoneId: playerZoneId(blue, 'deck'),
        concealIdentity: true,
      },
    ];
    for (const forged of invalid)
      expect(() =>
        applyEventBatch(prepared.state, {
          revision: prepared.state.revision + 1,
          events: [forged as unknown as DomainEvent],
        })
      ).toThrow();
    expect(prepared.state).toEqual(before);
  });
});
