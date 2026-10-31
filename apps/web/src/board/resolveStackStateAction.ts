import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { specialConditionKind } from '@ptcgsim/renderer-contract';

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

/**
 * Where a condition stands in the cycle, whichever way it was written: v1's
 * letters or the words (a marker's controls, or typed). -1 for a note.
 */
const cycleIndex = (condition: string): number => {
  const kind = specialConditionKind(condition);
  return kind === null
    ? -1
    : conditionCycle.findIndex((code) => specialConditionKind(code) === kind);
};

const conditionTarget = (
  stack: ViewStack,
  action: Extract<
    StackStateAction,
    { readonly type: 'setSpecialCondition' | 'cycleSpecialCondition' }
  >
): string | null | undefined => {
  if (action.type === 'cycleSpecialCondition') {
    if (stack.specialCondition === null) return conditionCycle[0];
    const currentIndex = cycleIndex(stack.specialCondition);
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
        cycleIndex(stack.specialCondition) < 0
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

/**
 * A number key's damage (Alt takes it off): v1 applies Alt's subtraction
 * only once a damage counter is there, and puts that much on otherwise.
 */
export const resolveDamageKeyAction = (
  view: MatchViewState,
  cardId: string,
  delta: number
): StackStateActionResolution => {
  const resolution = resolveStackStateAction(view, cardId, {
    type: 'adjustDamage',
    delta,
  });
  return !resolution.ok && resolution.reason === 'no_op' && delta < 0
    ? resolveStackStateAction(view, cardId, {
        type: 'setDamage',
        damage: -delta,
      })
    : resolution;
};

/**
 * Y's next Special Condition, or Alt+Y's removal: with none to remove,
 * v1's Alt+Y puts the first one (Poisoned) on.
 */
export const resolveConditionKeyAction = (
  view: MatchViewState,
  cardId: string,
  remove: boolean
): StackStateActionResolution => {
  const cycle = () =>
    resolveStackStateAction(view, cardId, { type: 'cycleSpecialCondition' });
  if (!remove) return cycle();
  const removal = resolveStackStateAction(view, cardId, {
    type: 'setSpecialCondition',
    condition: null,
  });
  return !removal.ok && removal.reason === 'no_op' ? cycle() : removal;
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
