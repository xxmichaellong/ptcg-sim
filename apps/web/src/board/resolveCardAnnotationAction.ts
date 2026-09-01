import type {
  MatchViewState,
  QuarterTurns,
  ViewCard,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type CardAnnotationAction =
  | { readonly type: 'rotate'; readonly single: boolean }
  | {
      readonly type: 'changeCategory';
      readonly category: 'Pokémon' | 'Trainer' | 'Energy';
    }
  | { readonly type: 'setAbilityUsed'; readonly used: boolean }
  | { readonly type: 'toggleAbilityUsed' };

export type CardAnnotationActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason:
        'not_player' | 'stale_card' | 'unsupported_target' | 'no_op';
    };

type LocatedCard = {
  readonly card: ViewCard;
  readonly sourceId: string;
  readonly kind:
    'zone' | 'stackEvolution' | 'stackAttachment' | 'inspection' | 'staged';
  readonly zoneKind?: MatchViewState['zones'][string]['kind'];
  readonly stack?: MatchViewState['stacks'][string];
  readonly isLowerEvolution: boolean;
  readonly sourceIndex: number;
  readonly sourceCount: number;
};

const locateCard = (
  view: MatchViewState,
  cardId: string
): LocatedCard | null => {
  for (const zone of Object.values(view.zones)) {
    const index = zone.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) {
      return {
        card: zone.cards[index]!,
        sourceId: zone.id,
        kind: 'zone',
        zoneKind: zone.kind,
        isLowerEvolution: false,
        sourceIndex: index,
        sourceCount: zone.cards.length,
      };
    }
  }
  for (const stack of Object.values(view.stacks)) {
    const evolutionIndex = stack.evolutionCards.findIndex(
      (card) => card.id === cardId
    );
    if (evolutionIndex >= 0) {
      return {
        card: stack.evolutionCards[evolutionIndex]!,
        sourceId: stack.id,
        kind: 'stackEvolution',
        stack,
        isLowerEvolution: evolutionIndex < stack.evolutionCards.length - 1,
        sourceIndex: evolutionIndex,
        sourceCount: stack.evolutionCards.length,
      };
    }
    const attachmentIndex = stack.attachmentCards.findIndex(
      (card) => card.id === cardId
    );
    if (attachmentIndex >= 0) {
      return {
        card: stack.attachmentCards[attachmentIndex]!,
        sourceId: stack.id,
        kind: 'stackAttachment',
        stack,
        isLowerEvolution: false,
        sourceIndex: attachmentIndex,
        sourceCount: stack.attachmentCards.length,
      };
    }
  }
  for (const areas of Object.values(view.workAreas)) {
    const inspectionIndex =
      areas.inspection?.cards.findIndex((card) => card.id === cardId) ?? -1;
    if (inspectionIndex >= 0 && areas.inspection) {
      return {
        card: areas.inspection.cards[inspectionIndex]!,
        sourceId: areas.inspection.id,
        kind: 'inspection',
        isLowerEvolution: false,
        sourceIndex: inspectionIndex,
        sourceCount: areas.inspection.cards.length,
      };
    }
    const resolution = areas.attachmentResolution;
    const evolutionIndex =
      resolution?.evolutionCards.findIndex((card) => card.id === cardId) ?? -1;
    if (evolutionIndex >= 0 && resolution) {
      return {
        card: resolution.evolutionCards[evolutionIndex]!,
        sourceId: resolution.id,
        kind: 'staged',
        isLowerEvolution: false,
        sourceIndex: evolutionIndex,
        sourceCount:
          resolution.evolutionCards.length + resolution.attachmentCards.length,
      };
    }
    const attachmentIndex =
      resolution?.attachmentCards.findIndex((card) => card.id === cardId) ?? -1;
    if (attachmentIndex >= 0 && resolution) {
      return {
        card: resolution.attachmentCards[attachmentIndex]!,
        sourceId: resolution.id,
        kind: 'staged',
        isLowerEvolution: false,
        sourceIndex: resolution.evolutionCards.length + attachmentIndex,
        sourceCount:
          resolution.evolutionCards.length + resolution.attachmentCards.length,
      };
    }
  }
  return null;
};

const nextQuarterTurn = (current: QuarterTurns): QuarterTurns =>
  ((current + 1) % 4) as QuarterTurns;

/** Maps the legacy card annotation shortcuts to canonical target-value intents. */
export const resolveCardAnnotationAction = (
  view: MatchViewState,
  cardId: string,
  action: CardAnnotationAction
): CardAnnotationActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const located = locateCard(view, cardId);
  if (!located) return { ok: false, reason: 'stale_card' };

  if (action.type === 'changeCategory') {
    if (located.isLowerEvolution) {
      return { ok: false, reason: 'unsupported_target' };
    }
    if (
      located.kind === 'zone' &&
      located.zoneKind === 'board' &&
      located.sourceIndex === located.sourceCount - 1 &&
      located.card.kind === 'known' &&
      located.card.category === action.category &&
      located.card.orientationQuarterTurns === 0 &&
      !located.card.abilityUsed
    ) {
      return { ok: false, reason: 'no_op' };
    }
    return {
      ok: true,
      command: {
        type: 'ChangeCardCategory',
        cardId,
        expectedSourceId: located.sourceId,
        category: action.category,
      },
    };
  }

  if (action.type === 'rotate') {
    if (located.stack && !action.single) {
      return {
        ok: true,
        command: {
          type: 'RotateStack',
          stackId: located.stack.id,
          rotationQuarterTurns: nextQuarterTurn(
            located.stack.rotationQuarterTurns
          ),
        },
      };
    }
    if (
      located.card.kind !== 'known' ||
      (!action.single && located.zoneKind !== 'stadium') ||
      (action.single && !located.stack)
    ) {
      return { ok: false, reason: 'unsupported_target' };
    }
    return {
      ok: true,
      command: {
        type: 'SetCardOrientation',
        cardId,
        orientationQuarterTurns: action.single
          ? located.card.orientationQuarterTurns === 1
            ? 0
            : 1
          : nextQuarterTurn(located.card.orientationQuarterTurns),
      },
    };
  }

  const requestedUsed =
    action.type === 'toggleAbilityUsed' ? undefined : action.used;
  if (located.kind === 'stackEvolution' && located.stack) {
    const used = requestedUsed ?? !located.stack.abilityUsed;
    if (used === located.stack.abilityUsed) {
      return { ok: false, reason: 'no_op' };
    }
    return {
      ok: true,
      command: { type: 'SetAbilityUsed', stackId: located.stack.id, used },
    };
  }
  const supportsCardMarker =
    located.kind === 'stackAttachment' ||
    (located.kind === 'zone' &&
      (located.zoneKind === 'discard' || located.zoneKind === 'stadium'));
  if (!supportsCardMarker || located.card.kind !== 'known') {
    return { ok: false, reason: 'unsupported_target' };
  }
  const used = requestedUsed ?? !located.card.abilityUsed;
  if (used === located.card.abilityUsed) {
    return { ok: false, reason: 'no_op' };
  }
  return {
    ok: true,
    command: { type: 'SetCardAbilityUsed', cardId, used },
  };
};

export const submitCardAnnotationAction = (
  view: MatchViewState,
  cardId: string,
  action: CardAnnotationAction,
  submit: (command: WireGameCommand) => void
): CardAnnotationActionResolution => {
  const resolution = resolveCardAnnotationAction(view, cardId, action);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
