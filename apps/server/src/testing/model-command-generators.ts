import type { MatchViewState, ViewCard } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import {
  MODEL_COMMAND_REGISTRY,
  type GeneratedModelCommandType,
  type WireGameCommandType,
} from './model-command-registry.js';

export interface ModelRandom {
  readonly integer: (exclusiveMaximum: number) => number;
  readonly boolean: () => boolean;
  readonly pick: <Value>(values: readonly Value[]) => Value | undefined;
}

export interface ModelCommandGenerationContext {
  readonly view: MatchViewState;
  readonly random: ModelRandom;
  readonly seed: number;
}

type CommandOf<Type extends WireGameCommand['type']> = Extract<
  WireGameCommand,
  { readonly type: Type }
>;

type ModelCommandGenerator<Type extends WireGameCommandType> = (
  context: ModelCommandGenerationContext
) => CommandOf<Type> | undefined;

interface LocatedViewCard {
  readonly card: ViewCard;
  readonly sourceId: string;
  readonly sourceKind: 'zone' | 'stack' | 'inspection' | 'staged';
}

const actorId = (context: ModelCommandGenerationContext): string | undefined =>
  context.view.viewer.kind === 'player'
    ? context.view.viewer.playerId
    : undefined;

const actorZone = (
  context: ModelCommandGenerationContext,
  kind: MatchViewState['zones'][string]['kind']
) => {
  const playerId = actorId(context);
  return Object.values(context.view.zones).find(
    (zone) => zone.ownerId === playerId && zone.kind === kind
  );
};

const actorStacks = (context: ModelCommandGenerationContext) => {
  const playerId = actorId(context);
  return Object.values(context.view.stacks).filter(
    (stack) => stack.boardPlayerId === playerId
  );
};

const indexedDestination = (
  context: ModelCommandGenerationContext,
  length: number
): { readonly destinationIndex?: number } => {
  const index = context.random.pick([
    undefined,
    0,
    Math.floor(length / 2),
    length,
  ]);
  return index === undefined ? {} : { destinationIndex: index };
};

const countVariant = (
  context: ModelCommandGenerationContext,
  available: number,
  allowZero: boolean
): number =>
  context.random.pick([
    ...(allowZero ? [0] : []),
    1,
    Math.max(1, available),
    Math.min(200, available + 1),
  ])!;

const locatedCards = (
  context: ModelCommandGenerationContext
): readonly LocatedViewCard[] => {
  const playerId = actorId(context);
  if (!playerId) return [];
  const cards: LocatedViewCard[] = [];
  for (const zone of Object.values(context.view.zones)) {
    for (const card of zone.cards) {
      if (card.ownerId === playerId) {
        cards.push({ card, sourceId: zone.id, sourceKind: 'zone' });
      }
    }
  }
  for (const stack of Object.values(context.view.stacks)) {
    for (const card of [...stack.evolutionCards, ...stack.attachmentCards]) {
      if (card.ownerId === playerId) {
        cards.push({ card, sourceId: stack.id, sourceKind: 'stack' });
      }
    }
  }
  const areas = context.view.workAreas[playerId];
  if (areas?.inspection) {
    for (const card of areas.inspection.cards) {
      cards.push({
        card,
        sourceId: areas.inspection.id,
        sourceKind: 'inspection',
      });
    }
  }
  if (areas?.attachmentResolution) {
    for (const card of [
      ...areas.attachmentResolution.evolutionCards,
      ...areas.attachmentResolution.attachmentCards,
    ]) {
      cards.push({
        card,
        sourceId: areas.attachmentResolution.id,
        sourceKind: 'staged',
      });
    }
  }
  return cards;
};

const pickActorZoneCard = (
  context: ModelCommandGenerationContext,
  allowedKinds: readonly MatchViewState['zones'][string]['kind'][]
): LocatedViewCard | undefined => {
  const playerId = actorId(context);
  const choices: LocatedViewCard[] = [];
  for (const zone of Object.values(context.view.zones)) {
    if (zone.ownerId !== playerId || !allowedKinds.includes(zone.kind))
      continue;
    choices.push(
      ...zone.cards.map((card) => ({
        card,
        sourceId: zone.id,
        sourceKind: 'zone' as const,
      }))
    );
  }
  return context.random.pick(choices);
};

const nextQuarterTurn = (current: number): 0 | 1 | 2 | 3 =>
  ((current + 1) % 4) as 0 | 1 | 2 | 3;

const generatedDeck = (
  context: ModelCommandGenerationContext
): Extract<WireGameCommand, { type: 'LoadDeck' }>['entries'] => {
  const playerId = actorId(context) ?? 'player';
  return [
    {
      suffix: 'basic',
      name: 'Model Basic',
      category: 'Pokémon' as const,
      count: 8,
    },
    {
      suffix: 'stage',
      name: 'Model Stage',
      category: 'Pokémon' as const,
      count: 6,
    },
    {
      suffix: 'tool',
      name: 'Model Tool',
      category: 'Trainer' as const,
      count: 6,
    },
    {
      suffix: 'energy',
      name: 'Model Energy',
      category: 'Energy' as const,
      count: 6,
    },
  ].map(({ suffix, name, category, count }) => ({
    definition: {
      id: `model-${playerId}-${context.seed}-${suffix}`,
      name,
      category,
      imageUrl: `/model/${suffix}.png`,
    },
    count,
  }));
};

const cardWithSourceOutsideDeck = (
  context: ModelCommandGenerationContext
): LocatedViewCard | undefined => {
  const deckId = actorZone(context, 'deck')?.id;
  return context.random.pick(
    locatedCards(context).filter((located) => located.sourceId !== deckId)
  );
};

export const MODEL_COMMAND_GENERATORS = {
  LoadDeck: (context) => ({
    type: 'LoadDeck',
    targetPlayerId: actorId(context),
    entries: generatedDeck(context),
  }),
  ResetPlayer: (context) => ({
    type: 'ResetPlayer',
    targetPlayerId: actorId(context),
  }),
  SetupPlayer: (context) => ({
    type: 'SetupPlayer',
    targetPlayerId: actorId(context),
  }),
  MoveCard: (context) => {
    const playerId = actorId(context);
    const source = context.random.pick(
      locatedCards(context).filter(
        (candidate) =>
          candidate.sourceKind === 'zone' && candidate.card.kind === 'known'
      )
    );
    if (!source) return undefined;
    const destinations = Object.values(context.view.zones).filter(
      (zone) =>
        zone.id !== source.sourceId &&
        (zone.ownerId === playerId || zone.kind === 'stadium') &&
        zone.kind !== 'deck' &&
        zone.kind !== 'prizes' &&
        !(zone.kind === 'stadium' && zone.cards.length > 0)
    );
    const destination = context.random.pick(destinations);
    return destination
      ? {
          type: 'MoveCard',
          cardId: source.card.id,
          expectedSourceZoneId: source.sourceId,
          destinationZoneId: destination.id,
          ...indexedDestination(context, destination.cards.length),
        }
      : undefined;
  },
  MoveCardToPlay: (context) => {
    const source = pickActorZoneCard(context, [
      'hand',
      'discard',
      'board',
      'lostZone',
    ]);
    const playerId = actorId(context);
    if (!source || !playerId || source.card.kind !== 'known') return undefined;
    const board = context.view.boards[playerId];
    const stacks = actorStacks(context);
    const target = context.random.pick(stacks);
    if (source.card.category !== 'Pokémon' && target) {
      return {
        type: 'MoveCardToPlay',
        cardId: source.card.id,
        expectedSourceZoneId: source.sourceId,
        boardPlayerId: playerId,
        slot: target.slot,
        targetStackId: target.id,
      };
    }
    if (source.card.category !== 'Pokémon') return undefined;
    if (target && context.random.boolean()) {
      return {
        type: 'MoveCardToPlay',
        cardId: source.card.id,
        expectedSourceZoneId: source.sourceId,
        boardPlayerId: playerId,
        slot: target.slot,
        targetStackId: target.id,
      };
    }
    const benchIndex = board?.benchStackIds.length ?? 0;
    return {
      type: 'MoveCardToPlay',
      cardId: source.card.id,
      expectedSourceZoneId: source.sourceId,
      boardPlayerId: playerId,
      slot: board?.activeStackId ? 'bench' : 'active',
      ...(board?.activeStackId && context.random.boolean()
        ? { benchIndex: context.random.pick([0, benchIndex])! }
        : {}),
    };
  },
  MoveCardFromStack: (context) => {
    const stack = context.random.pick(actorStacks(context));
    const card = stack
      ? context.random.pick([
          ...stack.attachmentCards,
          ...stack.evolutionCards.slice(-1),
        ])
      : undefined;
    const destination = actorZone(context, 'discard');
    return stack && card && destination
      ? {
          type: 'MoveCardFromStack',
          cardId: card.id,
          expectedStackId: stack.id,
          destinationZoneId: destination.id,
          ...indexedDestination(context, destination.cards.length),
        }
      : undefined;
  },
  MovePlayStack: (context) => {
    const playerId = actorId(context);
    const board = playerId ? context.view.boards[playerId] : undefined;
    if (!board) return undefined;
    const stacks = [
      ...(board.activeStackId
        ? [context.view.stacks[board.activeStackId]]
        : []),
      ...board.benchStackIds.map((id) => context.view.stacks[id]),
    ].filter((stack): stack is NonNullable<typeof stack> => Boolean(stack));
    const stack = context.random.pick(stacks);
    if (!stack) return undefined;
    const destinationSlot = stack.slot === 'active' ? 'bench' : 'active';
    const targets = stacks.filter(
      (candidate) =>
        candidate.id !== stack.id && candidate.slot === destinationSlot
    );
    const target = context.random.boolean()
      ? context.random.pick(targets)
      : undefined;
    return {
      type: 'MovePlayStack',
      stackId: stack.id,
      expectedSourceSlot: stack.slot,
      expectedActiveStackId: board.activeStackId,
      expectedBenchStackIds: [...board.benchStackIds],
      destinationSlot,
      ...(target ? { targetStackId: target.id } : {}),
    };
  },
  MoveInspectedCard: () => undefined,
  MoveStagedCard: () => undefined,
  RestoreStagedStack: () => undefined,
  ResolveStagedCards: () => undefined,
  ResolveInspectionCards: () => undefined,
  MoveCardToDeckTop: (context) => {
    const source = cardWithSourceOutsideDeck(context);
    return source
      ? {
          type: 'MoveCardToDeckTop',
          cardId: source.card.id,
          expectedSourceId: source.sourceId,
        }
      : undefined;
  },
  MoveCardToDeckBottom: (context) => {
    const source = cardWithSourceOutsideDeck(context);
    return source
      ? {
          type: 'MoveCardToDeckBottom',
          cardId: source.card.id,
          expectedSourceId: source.sourceId,
        }
      : undefined;
  },
  ShuffleCardIntoDeck: (context) => {
    const source = cardWithSourceOutsideDeck(context);
    return source
      ? {
          type: 'ShuffleCardIntoDeck',
          cardId: source.card.id,
          expectedSourceId: source.sourceId,
        }
      : undefined;
  },
  SwapCardWithDeckTop: (context) => {
    const source = cardWithSourceOutsideDeck(context);
    const deck = actorZone(context, 'deck');
    return source && deck && deck.cards.length > 0
      ? {
          type: 'SwapCardWithDeckTop',
          cardId: source.card.id,
          expectedSourceId: source.sourceId,
        }
      : undefined;
  },
  MovePrizesToDeckBottom: (context) =>
    actorZone(context, 'prizes')?.cards.length
      ? { type: 'MovePrizesToDeckBottom' }
      : undefined,
  ShuffleZone: (context) => {
    const zone = context.random.pick(
      Object.values(context.view.zones).filter(
        (candidate) =>
          candidate.ownerId === actorId(context) && candidate.cards.length > 1
      )
    );
    return zone ? { type: 'ShuffleZone', zoneId: zone.id } : undefined;
  },
  DrawCards: (context) =>
    actorZone(context, 'deck')?.cards.length
      ? {
          type: 'DrawCards',
          count: countVariant(
            context,
            actorZone(context, 'deck')!.cards.length,
            false
          ),
        }
      : undefined,
  PlayRandomCardFaceDown: (context) =>
    actorZone(context, 'hand')?.cards.length && actorId(context)
      ? { type: 'PlayRandomCardFaceDown', targetPlayerId: actorId(context)! }
      : undefined,
  StartTurn: (context) =>
    actorId(context)
      ? { type: 'StartTurn', targetPlayerId: actorId(context)! }
      : undefined,
  DeclareAttack: (context) =>
    actorId(context)
      ? { type: 'DeclareAttack', targetPlayerId: actorId(context)! }
      : undefined,
  PassTurn: (context) =>
    actorId(context)
      ? { type: 'PassTurn', targetPlayerId: actorId(context)! }
      : undefined,
  MoveZoneContents: (context) => {
    const zones = ['hand', 'discard', 'lostZone']
      .map((kind) =>
        actorZone(context, kind as MatchViewState['zones'][string]['kind'])
      )
      .filter((zone): zone is NonNullable<typeof zone> => Boolean(zone));
    const source = context.random.pick(
      zones.filter((zone) => zone.cards.length > 0)
    );
    const destination = context.random.pick(
      zones.filter((zone) => zone.id !== source?.id)
    );
    return source && destination
      ? {
          type: 'MoveZoneContents',
          sourceZoneId: source.id,
          destinationZoneId: destination.id,
        }
      : undefined;
  },
  ResolveLooseBoardCards: (context) => {
    const playerId = actorId(context);
    const board = actorZone(context, 'board');
    return playerId && board && board.cards.length > 0
      ? {
          type: 'ResolveLooseBoardCards',
          targetPlayerId: playerId,
          expectedBoardCardIds: board.cards.map((card) => card.id),
          destination: context.random.pick([
            'discard',
            'lostZone',
            'hand',
            'shuffleIntoDeck',
          ] as const)!,
        }
      : undefined;
  },
  ShuffleZoneIntoDeck: (context) => {
    const source = context.random.pick(
      ['hand', 'discard', 'lostZone']
        .map((kind) =>
          actorZone(context, kind as MatchViewState['zones'][string]['kind'])
        )
        .filter((zone): zone is NonNullable<typeof zone> =>
          Boolean(zone && zone.cards.length > 0)
        )
    );
    return source
      ? { type: 'ShuffleZoneIntoDeck', sourceZoneId: source.id }
      : undefined;
  },
  ShuffleZoneToDeckBottom: (context) => {
    const source = context.random.pick(
      ['hand', 'discard', 'lostZone']
        .map((kind) =>
          actorZone(context, kind as MatchViewState['zones'][string]['kind'])
        )
        .filter((zone): zone is NonNullable<typeof zone> =>
          Boolean(zone && zone.cards.length > 0)
        )
    );
    return source
      ? { type: 'ShuffleZoneToDeckBottom', sourceZoneId: source.id }
      : undefined;
  },
  DiscardHandAndDraw: (context) => ({
    type: 'DiscardHandAndDraw',
    count: countVariant(
      context,
      actorZone(context, 'deck')?.cards.length ?? 0,
      true
    ),
  }),
  ShuffleHandIntoDeckAndDraw: (context) => ({
    type: 'ShuffleHandIntoDeckAndDraw',
    count: countVariant(
      context,
      actorZone(context, 'deck')?.cards.length ?? 0,
      true
    ),
  }),
  ShuffleHandToDeckBottomAndDraw: (context) => ({
    type: 'ShuffleHandToDeckBottomAndDraw',
    count: countVariant(
      context,
      actorZone(context, 'deck')?.cards.length ?? 0,
      true
    ),
  }),
  SetDamage: (context) => {
    const stack = context.random.pick(actorStacks(context));
    const damage = stack
      ? context.random.pick(
          [null, 0, 10, 9_990].filter((value) => value !== stack.damage)
        )
      : undefined;
    return stack
      ? {
          type: 'SetDamage',
          stackId: stack.id,
          damage: damage!,
        }
      : undefined;
  },
  SetSpecialCondition: (context) => {
    const playerId = actorId(context);
    const activeId = playerId
      ? context.view.boards[playerId]?.activeStackId
      : undefined;
    const stack = activeId ? context.view.stacks[activeId] : undefined;
    return stack
      ? {
          type: 'SetSpecialCondition',
          stackId: stack.id,
          condition: stack.specialCondition === null ? 'P' : null,
        }
      : undefined;
  },
  SetAbilityUsed: (context) => {
    const stack = context.random.pick(actorStacks(context));
    return stack
      ? { type: 'SetAbilityUsed', stackId: stack.id, used: !stack.abilityUsed }
      : undefined;
  },
  RotateStack: (context) => {
    const stack = context.random.pick(actorStacks(context));
    return stack
      ? {
          type: 'RotateStack',
          stackId: stack.id,
          rotationQuarterTurns: nextQuarterTurn(stack.rotationQuarterTurns),
        }
      : undefined;
  },
  SetCardOrientation: (context) => {
    const card = context.random.pick(
      actorStacks(context).flatMap((stack) => [
        ...stack.evolutionCards,
        ...stack.attachmentCards,
      ])
    );
    return card?.kind === 'known'
      ? {
          type: 'SetCardOrientation',
          cardId: card.id,
          orientationQuarterTurns: nextQuarterTurn(
            card.orientationQuarterTurns
          ),
        }
      : undefined;
  },
  SetCardAbilityUsed: (context) => {
    const cards = [
      ...actorStacks(context).flatMap((stack) => stack.attachmentCards),
      ...(actorZone(context, 'discard')?.cards ?? []),
    ].filter(
      (card): card is Extract<ViewCard, { kind: 'known' }> =>
        card.kind === 'known'
    );
    const card = context.random.pick(cards);
    return card
      ? { type: 'SetCardAbilityUsed', cardId: card.id, used: !card.abilityUsed }
      : undefined;
  },
  ChangeCardCategory: (context) => {
    const located = context.random.pick(
      locatedCards(context).filter((entry) => entry.card.kind === 'known')
    );
    if (!located || located.card.kind !== 'known') return undefined;
    const card = located.card;
    const categories = ['Pokémon', 'Trainer', 'Energy'] as const;
    const category = context.random.pick(
      categories.filter((candidate) => candidate !== card.category)
    );
    return category
      ? {
          type: 'ChangeCardCategory',
          cardId: located.card.id,
          expectedSourceId: located.sourceId,
          category,
        }
      : undefined;
  },
  SetCardFace: (context) => {
    const card = context.random.pick(
      locatedCards(context)
        .map((entry) => entry.card)
        .filter(
          (candidate): candidate is Extract<ViewCard, { kind: 'known' }> =>
            candidate.kind === 'known'
        )
    );
    return card
      ? {
          type: 'SetCardFace',
          cardId: card.id,
          face: card.face === 'up' ? 'down' : 'up',
        }
      : undefined;
  },
  SetPublicReveal: (context) => {
    const located = pickActorZoneCard(context, ['hand', 'prizes', 'board']);
    return located
      ? {
          type: 'SetPublicReveal',
          cardId: located.card.id,
          expectedSourceId: located.sourceId,
          revealed: !located.card.publiclyRevealed,
        }
      : undefined;
  },
  SetZonePublicReveal: (context) => {
    const playerId = actorId(context);
    const prizes = actorZone(context, 'prizes');
    return playerId && prizes && prizes.cards.length > 0
      ? {
          type: 'SetZonePublicReveal',
          targetPlayerId: playerId,
          zoneId: prizes.id,
          expectedCardIds: prizes.cards.map((card) => card.id),
          revealed: !prizes.cards.every((card) => card.publiclyRevealed),
        }
      : undefined;
  },
  BeginZoneInspection: (context) => {
    const playerId = actorId(context);
    const zone = context.random.pick(
      [actorZone(context, 'hand'), actorZone(context, 'prizes')].filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          Boolean(
            candidate &&
            candidate.cards.length > 0 &&
            candidate.cards.some((card) => card.kind === 'concealed') &&
            !context.view.privateInspections.some(
              (inspection) => inspection.sourceId === candidate.id
            )
          )
      )
    );
    return playerId && zone
      ? {
          type: 'BeginZoneInspection',
          targetPlayerId: playerId,
          zoneId: zone.id,
          expectedCardIds: zone.cards.map((card) => card.id),
        }
      : undefined;
  },
  BeginCardInspection: (context) => {
    const located = context.random.pick(
      [actorZone(context, 'prizes'), actorZone(context, 'deck')]
        .filter((zone): zone is NonNullable<typeof zone> => Boolean(zone))
        .flatMap((zone) =>
          zone.cards
            .filter(
              (card) =>
                card.kind === 'concealed' &&
                !context.view.privateInspections.some((inspection) =>
                  inspection.cardIds.includes(card.id)
                )
            )
            .map((card) => ({ card, sourceId: zone.id }))
        )
    );
    return located
      ? {
          type: 'BeginCardInspection',
          cardId: located.card.id,
          expectedSourceId: located.sourceId,
        }
      : undefined;
  },
  EndPrivateInspection: (context) => {
    const inspection = context.random.pick(context.view.privateInspections);
    return inspection
      ? { type: 'EndPrivateInspection', inspectionId: inspection.id }
      : undefined;
  },
  ExtractDeckCardsForInspection: (context) => {
    const playerId = actorId(context);
    const deck = actorZone(context, 'deck');
    const areas = playerId ? context.view.workAreas[playerId] : undefined;
    return playerId && deck && deck.cards.length > 0 && !areas?.inspection
      ? {
          type: 'ExtractDeckCardsForInspection',
          ownerPlayerId: playerId,
          count: countVariant(context, deck.cards.length, false),
          edge: context.random.boolean() ? 'top' : 'bottom',
          visibility: context.random.boolean() ? 'private' : 'public',
        }
      : undefined;
  },
  CloseInspection: () => undefined,
  SetOncePerGameMarker: (context) => {
    const playerId = actorId(context);
    if (!playerId) return undefined;
    const marker = context.random.boolean() ? 'gx' : 'vstar';
    const player = context.view.players[playerId];
    return player
      ? {
          type: 'SetOncePerGameMarker',
          targetPlayerId: playerId,
          marker,
          used:
            marker === 'gx'
              ? !player.oncePerGame.gxUsed
              : !player.oncePerGame.vstarUsed,
        }
      : undefined;
  },
  ApplySoloUndo: () => undefined,
  FlipCoin: () => ({ type: 'FlipCoin' }),
} satisfies {
  readonly [Type in WireGameCommandType]: ModelCommandGenerator<Type>;
};

export const GENERATED_MODEL_COMMAND_TYPES = Object.entries(
  MODEL_COMMAND_REGISTRY
).flatMap(([type, metadata]) =>
  metadata.coverage === 'generated' ? [type as GeneratedModelCommandType] : []
);
