import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type StackStateAction =
  | { readonly type: 'setDamage'; readonly damage: number | null }
  | { readonly type: 'adjustDamage'; readonly delta: number }
  | {
      readonly type: 'setSpecialCondition';
      readonly condition: string | null;
    }
  | { readonly type: 'cycleSpecialCondition' }
  | { readonly type: 'setAbilityUsed'; readonly used: boolean }
  | { readonly type: 'toggleAbilityUsed' }
  | { readonly type: 'rotateClockwise' };

export type StackStateActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_player'
        | 'stale_card'
        | 'unsupported_target'
        | 'invalid_value'
        | 'no_op';
    };

type ViewStack = MatchViewState['stacks'][string];

const locateStack = (
  view: MatchViewState,
  cardId: string
): { readonly stack: ViewStack | null; readonly cardExists: boolean } => {
  for (const stack of Object.values(view.stacks)) {
    if (stack.evolutionCards.some((card) => card.id === cardId)) {
      return { stack, cardExists: true };
    }
    if (stack.attachmentCards.some((card) => card.id === cardId)) {
      return { stack, cardExists: true };
    }
  }
  const inZone = Object.values(view.zones).some((zone) =>
    zone.cards.some((card) => card.id === cardId)
  );
  const inWorkArea = Object.values(view.workAreas).some((areas) =>
    Boolean(
      areas.inspection?.cards.some((card) => card.id === cardId) ||
      areas.attachmentResolution?.evolutionCards.some(
        (card) => card.id === cardId
      ) ||
      areas.attachmentResolution?.attachmentCards.some(
        (card) => card.id === cardId
      )
    )
  );
  return { stack: null, cardExists: inZone || inWorkArea };
};

const damageTarget = (
  stack: ViewStack,
  action: Extract<
    StackStateAction,
    { readonly type: 'setDamage' | 'adjustDamage' }
  >
): number | null | undefined => {
  const requested =
    action.type === 'setDamage'
      ? action.damage
      : (stack.damage ?? 0) + action.delta;
  if (requested === null || requested <= 0) return null;
  if (!Number.isSafeInteger(requested) || requested > 9_990) return undefined;
  return requested;
};

const conditionCycle = ['P', 'B', 'Pa', 'C', 'A'] as const;

const conditionTarget = (
  stack: ViewStack,
  action: Extract<
    StackStateAction,
    { readonly type: 'setSpecialCondition' | 'cycleSpecialCondition' }
  >
): string | null | undefined => {
  if (action.type === 'cycleSpecialCondition') {
    if (stack.specialCondition === null) return conditionCycle[0];
    const currentIndex = conditionCycle.findIndex(
      (condition) =>
        condition.toUpperCase() === stack.specialCondition?.toUpperCase()
    );
    return currentIndex < 0
      ? undefined
      : conditionCycle[(currentIndex + 1) % conditionCycle.length];
  }
  if (action.condition === null) return null;
  const normalized = action.condition.trim();
  if (normalized === '' || normalized === '0') return null;
  return normalized.length <= 16 ? normalized : undefined;
};

/** Maps the legacy in-play marker and group-rotation controls to target values. */
export const resolveStackStateAction = (
  view: MatchViewState,
  cardId: string,
  action: StackStateAction
): StackStateActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const located = locateStack(view, cardId);
  if (!located.stack) {
    return {
      ok: false,
      reason: located.cardExists ? 'unsupported_target' : 'stale_card',
    };
  }
  const stack = located.stack;
  switch (action.type) {
    case 'setDamage':
    case 'adjustDamage': {
      if (
        action.type === 'adjustDamage' &&
        (!Number.isSafeInteger(action.delta) || action.delta === 0)
      ) {
        return { ok: false, reason: 'invalid_value' };
      }
      const damage = damageTarget(stack, action);
      if (damage === undefined) return { ok: false, reason: 'invalid_value' };
      if (damage === stack.damage) return { ok: false, reason: 'no_op' };
      return {
        ok: true,
        command: { type: 'SetDamage', stackId: stack.id, damage },
      };
    }
    case 'setSpecialCondition':
    case 'cycleSpecialCondition': {
      if (stack.slot !== 'active') {
        return { ok: false, reason: 'unsupported_target' };
      }
      if (
        action.type === 'cycleSpecialCondition' &&
        stack.specialCondition !== null &&
        !conditionCycle.some(
          (condition) =>
            condition.toUpperCase() === stack.specialCondition?.toUpperCase()
        )
      ) {
        return { ok: false, reason: 'no_op' };
      }
      const condition = conditionTarget(stack, action);
      if (condition === undefined) {
        return { ok: false, reason: 'invalid_value' };
      }
      if (condition === stack.specialCondition) {
        return { ok: false, reason: 'no_op' };
      }
      return {
        ok: true,
        command: {
          type: 'SetSpecialCondition',
          stackId: stack.id,
          condition,
        },
      };
    }
    case 'setAbilityUsed': {
      if (action.used === stack.abilityUsed) {
        return { ok: false, reason: 'no_op' };
      }
      return {
        ok: true,
        command: {
          type: 'SetAbilityUsed',
          stackId: stack.id,
          used: action.used,
        },
      };
    }
    case 'toggleAbilityUsed':
      return {
        ok: true,
        command: {
          type: 'SetAbilityUsed',
          stackId: stack.id,
          used: !stack.abilityUsed,
        },
      };
    case 'rotateClockwise':
      return {
        ok: true,
        command: {
          type: 'RotateStack',
          stackId: stack.id,
          rotationQuarterTurns: ((stack.rotationQuarterTurns + 1) % 4) as
            0 | 1 | 2 | 3,
        },
      };
  }
};

export const submitStackStateAction = (
  view: MatchViewState,
  cardId: string,
  action: StackStateAction,
  submit: (command: WireGameCommand) => void
): StackStateActionResolution => {
  const resolution = resolveStackStateAction(view, cardId, action);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
