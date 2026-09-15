import { describe, expect, it } from 'vitest';

import { applyEvent, applyEventBatch } from './apply-events.js';
import type { CommandContext, DeckEntry, GameCommand } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
import { executeCommand, type CommandExecution } from './execute-command.js';
import type { DomainEvent } from './events.js';
import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  type CardInstanceId,
  type StackId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import type { MatchState } from './model.js';
import { stableSerialize } from './stable-hash.js';

const p1 = asPlayerId('place-stack-player-one');
const p2 = asPlayerId('place-stack-player-two');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`place-stack-card-${++card}`),
    nextStackId: () => asStackId(`place-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`place-stack-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`place-stack-work-${++workArea}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const categories = [
  'Pokémon',
  'Pokémon',
  'Pokémon',
  'Pokémon',
  'Pokémon',
  'Energy',
  'Trainer',
  'Energy',
  'Pokémon',
] as const;

const entries: readonly DeckEntry[] = categories.map((category, index) => ({
  definition: {
    id: asCardDefinitionId(`place-stack-definition-${index}`),
    name: `Place stack ${category} ${index}`,
    category,
    imageUrl: `/place-stack-${index}.png`,
  },
  count: 1,
}));

const accepted = (
  state: MatchState,
  command: GameCommand,
  commandContext: CommandContext
): Extract<CommandExecution, { readonly accepted: true }> => {
  const result = executeCommand(state, command, commandContext);
  if (!result.accepted) throw new Error(result.message);
  return result;
};

interface Fixture {
  readonly context: CommandContext;
  readonly state: MatchState;
  readonly deckId: ReturnType<typeof playerZoneId>;
  readonly discardId: ReturnType<typeof playerZoneId>;
  readonly activeStackId: StackId;
  readonly benchStackId: StackId;
  readonly activeBaseId: CardInstanceId;
  readonly activeMiddleId: CardInstanceId;
  readonly activeTopId: CardInstanceId;
  readonly benchBaseId: CardInstanceId;
  readonly zoneEvolutionId: CardInstanceId;
  readonly activeEnergyId: CardInstanceId;
  readonly benchTrainerId: CardInstanceId;
  readonly zoneEnergyId: CardInstanceId;
  readonly inspectionPokemonId: CardInstanceId;
}

const fixture = (): Fixture => {
  const commandContext = context();
  const loaded = accepted(
    createEmptyMatch(asMatchId('place-stack-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]),
    { type: 'LoadDeck', playerId: p1, entries },
    commandContext
  );
  const deckId = playerZoneId(p1, 'deck');
  const discardId = playerZoneId(p1, 'discard');
  const [
    activeBaseId,
    activeMiddleId,
    activeTopId,
    benchBaseId,
    zoneEvolutionId,
    activeEnergyId,
    benchTrainerId,
    zoneEnergyId,
    inspectionPokemonId,
  ] = loaded.state.zones[deckId]!.cardIds;
  let state = loaded.state;
  const play = (
    cardId: CardInstanceId,
    slot: 'active' | 'bench',
    targetStackId?: StackId
  ): void => {
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot,
        ...(targetStackId ? { targetStackId } : {}),
      },
      commandContext
    ).state;
  };
  play(activeBaseId!, 'active');
  const activeStackId = state.boards[p1]!.activeStackId!;
  play(activeMiddleId!, 'active', activeStackId);
  play(activeTopId!, 'active', activeStackId);
  play(benchBaseId!, 'bench');
  const benchStackId = state.boards[p1]!.benchStackIds[0]!;
  play(activeEnergyId!, 'active', activeStackId);
  play(benchTrainerId!, 'bench', benchStackId);
  assertMatchInvariants(state);
  return {
    context: commandContext,
    state,
    deckId,
    discardId,
    activeStackId,
    benchStackId,
    activeBaseId: activeBaseId!,
    activeMiddleId: activeMiddleId!,
    activeTopId: activeTopId!,
    benchBaseId: benchBaseId!,
    zoneEvolutionId: zoneEvolutionId!,
    activeEnergyId: activeEnergyId!,
    benchTrainerId: benchTrainerId!,
    zoneEnergyId: zoneEnergyId!,
    inspectionPokemonId: inspectionPokemonId!,
  };
};

const place = (
  state: MatchState,
  input: Fixture,
  cardId: CardInstanceId,
  expectedSourceId: ReturnType<
    typeof playerZoneId | typeof asStackId | typeof asWorkAreaId
  >,
  targetStackId: StackId,
  expectedTargetTopCardId: CardInstanceId,
  mode: 'attachment' | 'evolution'
) =>
  accepted(
    state,
    {
      type: 'PlaceCardOnPlayStack',
      playerId: p1,
      cardId,
      expectedSourceId,
      targetStackId,
      expectedTargetTopCardId,
      mode,
    },
    input.context
  );

const expectApplyFailureWithoutMutation = (
  state: MatchState,
  event: DomainEvent,
  message: string
): void => {
  const before = stableSerialize(state);
  expect(() => applyEvent(state, event)).toThrow(message);
  expect(stableSerialize(state)).toBe(before);
};

describe('atomic card placement on an existing play stack', () => {
  it('evolves a zone Pokémon and resets top-owned stack presentation state', () => {
    const input = fixture();
    let marked = accepted(
      input.state,
      { type: 'SetDamage', stackId: input.activeStackId, damage: 80 },
      input.context
    ).state;
    marked = accepted(
      marked,
      {
        type: 'SetSpecialCondition',
        stackId: input.activeStackId,
        condition: 'P',
      },
      input.context
    ).state;
    marked = accepted(
      marked,
      { type: 'SetAbilityUsed', stackId: input.activeStackId, used: true },
      input.context
    ).state;
    marked = accepted(
      marked,
      {
        type: 'RotateStack',
        stackId: input.activeStackId,
        rotationQuarterTurns: 2,
      },
      input.context
    ).state;
    const result = place(
      marked,
      input,
      input.zoneEvolutionId,
      input.deckId,
      input.activeStackId,
      input.activeTopId,
      'evolution'
    );
    expect(result.batch.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId: p1,
        cardId: input.zoneEvolutionId,
        expectedSourceId: input.deckId,
        targetStackId: input.activeStackId,
        expectedTargetTopCardId: input.activeTopId,
        expectedTargetEvolutionCardIds: [
          input.activeBaseId,
          input.activeMiddleId,
          input.activeTopId,
        ],
        expectedTargetAttachmentCardIds: [input.activeEnergyId],
        mode: 'evolution',
        attachmentOrderVersion: 1,
        evolutionCardIds: [
          input.activeBaseId,
          input.activeMiddleId,
          input.activeTopId,
          input.zoneEvolutionId,
        ],
        attachmentCardIds: [input.activeEnergyId],
      },
    ]);
    expect(applyEventBatch(marked, result.batch)).toEqual(result.state);
    expect(result.state.stacks[input.activeStackId]).toMatchObject({
      evolutionCardIds: [
        input.activeBaseId,
        input.activeMiddleId,
        input.activeTopId,
        input.zoneEvolutionId,
      ],
      attachmentCardIds: [input.activeEnergyId],
      rotationQuarterTurns: 0,
      damage: 80,
      specialCondition: null,
      abilityUsed: false,
    });
    expect(result.state.cards[input.zoneEvolutionId]?.abilityUsed).toBe(false);
    expect(result.state.zones[input.deckId]?.cardIds).not.toContain(
      input.zoneEvolutionId
    );
    assertMatchInvariants(result.state);
  });

  it('attaches a zone Energy before an existing Trainer with V1 ordering', () => {
    const input = fixture();
    const result = place(
      input.state,
      input,
      input.zoneEnergyId,
      input.deckId,
      input.benchStackId,
      input.benchBaseId,
      'attachment'
    );
    expect(result.batch.events[0]).toMatchObject({
      type: 'CardPlacedOnPlayStack',
      mode: 'attachment',
      expectedTargetAttachmentCardIds: [input.benchTrainerId],
      attachmentCardIds: [input.zoneEnergyId, input.benchTrainerId],
    });
    expect(result.state.stacks[input.benchStackId]?.attachmentCardIds).toEqual([
      input.zoneEnergyId,
      input.benchTrainerId,
    ]);
    assertMatchInvariants(result.state);
  });

  it('reattaches across stacks and removes only the source attachment', () => {
    const input = fixture();
    const result = place(
      input.state,
      input,
      input.activeEnergyId,
      input.activeStackId,
      input.benchStackId,
      input.benchBaseId,
      'attachment'
    );
    expect(result.state.stacks[input.activeStackId]).toMatchObject({
      evolutionCardIds: [
        input.activeBaseId,
        input.activeMiddleId,
        input.activeTopId,
      ],
      attachmentCardIds: [],
    });
    expect(result.state.stacks[input.benchStackId]?.attachmentCardIds).toEqual([
      input.activeEnergyId,
      input.benchTrainerId,
    ]);
    assertMatchInvariants(result.state);
  });

  it('reclassifies a lower evolution as an attachment without staging its siblings', () => {
    const input = fixture();
    const result = place(
      input.state,
      input,
      input.activeMiddleId,
      input.activeStackId,
      input.benchStackId,
      input.benchBaseId,
      'attachment'
    );
    expect(result.state.stacks[input.activeStackId]).toMatchObject({
      evolutionCardIds: [input.activeBaseId, input.activeTopId],
      attachmentCardIds: [input.activeEnergyId],
    });
    expect(result.state.stacks[input.benchStackId]?.attachmentCardIds).toEqual([
      input.benchTrainerId,
      input.activeMiddleId,
    ]);
    expect(result.state.workAreas[p1]?.attachmentResolution).toBeNull();
    assertMatchInvariants(result.state);
  });

  it('permits same-stack removal and reinsertion without duplicating the card', () => {
    const input = fixture();
    const result = place(
      input.state,
      input,
      input.activeEnergyId,
      input.activeStackId,
      input.activeStackId,
      input.activeTopId,
      'attachment'
    );
    expect(result.state.stacks[input.activeStackId]).toEqual(
      input.state.stacks[input.activeStackId]
    );
    expect(result.state.revision).toBe(input.state.revision + 1);
    assertMatchInvariants(result.state);
  });

  it('places an inspected card and closes the empty inspection work area', () => {
    const input = fixture();
    const opened = accepted(
      input.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 1,
        edge: 'bottom',
      },
      input.context
    );
    const inspection = opened.state.workAreas[p1]!.inspection!;
    expect(inspection.cardIds).toEqual([input.inspectionPokemonId]);
    const result = place(
      opened.state,
      input,
      input.inspectionPokemonId,
      inspection.id,
      input.benchStackId,
      input.benchBaseId,
      'evolution'
    );
    expect(result.state.workAreas[p1]?.inspection).toBeNull();
    expect(result.state.visibility.inspectionGrants).toEqual({});
    expect(result.state.stacks[input.benchStackId]?.evolutionCardIds).toEqual([
      input.benchBaseId,
      input.inspectionPokemonId,
    ]);
    assertMatchInvariants(result.state);
  });

  it('places from either staged sequence and closes only an exhausted work area', () => {
    const input = fixture();
    const departed = accepted(
      input.state,
      {
        type: 'MoveCardFromStack',
        cardId: input.activeTopId,
        expectedStackId: input.activeStackId,
        destinationZoneId: input.discardId,
      },
      input.context
    );
    const staged = departed.state.workAreas[p1]!.attachmentResolution!;
    expect(staged.evolutionCardIds).toEqual([
      input.activeBaseId,
      input.activeMiddleId,
    ]);
    expect(staged.attachmentCardIds).toEqual([input.activeEnergyId]);

    const evolved = place(
      departed.state,
      input,
      input.activeMiddleId,
      staged.id,
      input.benchStackId,
      input.benchBaseId,
      'evolution'
    );
    expect(evolved.state.workAreas[p1]?.attachmentResolution).toMatchObject({
      evolutionCardIds: [input.activeBaseId],
      attachmentCardIds: [input.activeEnergyId],
    });
    const attached = place(
      evolved.state,
      input,
      input.activeEnergyId,
      staged.id,
      input.benchStackId,
      input.activeMiddleId,
      'attachment'
    );
    expect(attached.state.workAreas[p1]?.attachmentResolution).toMatchObject({
      evolutionCardIds: [input.activeBaseId],
      attachmentCardIds: [],
    });
    const final = place(
      attached.state,
      input,
      input.activeBaseId,
      staged.id,
      input.benchStackId,
      input.activeMiddleId,
      'evolution'
    );
    expect(final.state.workAreas[p1]?.attachmentResolution).toBeNull();
    expect(final.state.stacks[input.benchStackId]).toMatchObject({
      evolutionCardIds: [
        input.benchBaseId,
        input.activeMiddleId,
        input.activeBaseId,
      ],
      attachmentCardIds: [input.activeEnergyId, input.benchTrainerId],
    });
    assertMatchInvariants(final.state);
  });

  it('rejects top, stale source, stale target, cross-board, and forged mode', () => {
    const input = fixture();
    const base = {
      type: 'PlaceCardOnPlayStack',
      playerId: p1,
      cardId: input.zoneEvolutionId,
      expectedSourceId: input.deckId,
      targetStackId: input.benchStackId,
      expectedTargetTopCardId: input.benchBaseId,
      mode: 'evolution',
    } as const;
    expect(
      executeCommand(
        input.state,
        { ...base, expectedSourceId: input.discardId },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(
      executeCommand(
        input.state,
        { ...base, expectedTargetTopCardId: input.activeTopId },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(
      executeCommand(
        input.state,
        { ...base, mode: 'attachment' },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(
      executeCommand(
        input.state,
        {
          ...base,
          cardId: input.activeTopId,
          expectedSourceId: input.activeStackId,
          targetStackId: input.activeStackId,
          expectedTargetTopCardId: input.activeTopId,
          mode: 'attachment',
        },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    expect(
      executeCommand(input.state, { ...base, playerId: p2 }, input.context)
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
  });

  it('fails closed when replayed event preconditions or final order are forged', () => {
    const input = fixture();
    const result = place(
      input.state,
      input,
      input.zoneEnergyId,
      input.deckId,
      input.benchStackId,
      input.benchBaseId,
      'attachment'
    );
    const event = result.batch.events[0]!;
    expectApplyFailureWithoutMutation(
      input.state,
      {
        ...event,
        expectedTargetTopCardId: input.activeTopId,
      },
      'stale preconditions'
    );
    expectApplyFailureWithoutMutation(
      input.state,
      {
        ...event,
        attachmentCardIds: [input.benchTrainerId, input.zoneEnergyId],
      },
      'result is malformed'
    );
  });
});
