import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import {
  isLegacyBoardCategoryChoice,
  type LegacyBoardCategoryChoice,
} from './resolveLegacyBoardOverlayAction.js';
import { resolveCardAnnotationAction } from './resolveCardAnnotationAction.js';
import { resolveCardInspectionAction } from './resolvePrivateInspectionAction.js';
import { resolvePublicCardVisibilityAction } from './resolvePublicVisibilityAction.js';
import { resolveStackStateAction } from './resolveStackStateAction.js';

export type LegacyBoardShortcutActionRequest =
  | {
      readonly action: 'adjustDamage';
      readonly cardId: ViewCardId;
      readonly delta: number;
    }
  | { readonly action: 'removeDamage'; readonly cardId: ViewCardId }
  | {
      readonly action: 'cycleSpecialCondition';
      readonly cardId: ViewCardId;
      readonly remove: boolean;
    }
  | { readonly action: 'toggleAbility'; readonly cardId: ViewCardId }
  | {
      readonly action: 'changeCardType';
      readonly cardId: ViewCardId;
      readonly category: LegacyBoardCategoryChoice;
    }
  | { readonly action: 'togglePrivateInspection'; readonly cardId: ViewCardId }
  | {
      readonly action: 'setPublicReveal';
      readonly cardId: ViewCardId;
      readonly revealed: boolean;
    };

export type LegacyBoardShortcutActionRejectionReason =
  | 'not_player'
  | 'stale_card'
  | 'stale_player'
  | 'unsupported_target'
  | 'unsupported_zone'
  | 'empty_zone'
  | 'invalid_value'
  | 'no_op';

export type LegacyBoardShortcutActionResolution =
  | {
      readonly ok: true;
      readonly command: WireGameCommand;
      /** Matches the source's immediate selection cleanup for this gesture. */
      readonly dismissSelection: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: LegacyBoardShortcutActionRejectionReason;
    };

type ExistingActionResolution =
  | ReturnType<typeof resolveStackStateAction>
  | ReturnType<typeof resolveCardAnnotationAction>
  | ReturnType<typeof resolveCardInspectionAction>
  | ReturnType<typeof resolvePublicCardVisibilityAction>;

const retainResolution = (
  resolution: ExistingActionResolution,
  dismissSelection: boolean
): LegacyBoardShortcutActionResolution =>
  resolution.ok
    ? { ok: true, command: resolution.command, dismissSelection }
    : resolution;

/** Maps the selected-card shortcut subset onto existing stale-safe resolvers. */
export const resolveLegacyBoardShortcutAction = (
  view: MatchViewState,
  request: LegacyBoardShortcutActionRequest
): LegacyBoardShortcutActionResolution => {
  switch (request.action) {
    case 'adjustDamage': {
      const resolution = resolveStackStateAction(view, request.cardId, {
        type: 'adjustDamage',
        delta: request.delta,
      });
      if (
        !resolution.ok &&
        resolution.reason === 'no_op' &&
        request.delta < 0
      ) {
        // V1 applies Alt subtraction only after a damage marker exists.
        return retainResolution(
          resolveStackStateAction(view, request.cardId, {
            type: 'setDamage',
            damage: -request.delta,
          }),
          false
        );
      }
      return retainResolution(
        resolution,
        resolution.ok &&
          resolution.command.type === 'SetDamage' &&
          resolution.command.damage === null
      );
    }
    case 'removeDamage':
      return retainResolution(
        resolveStackStateAction(view, request.cardId, {
          type: 'setDamage',
          damage: null,
        }),
        true
      );
    case 'cycleSpecialCondition': {
      if (!request.remove) {
        return retainResolution(
          resolveStackStateAction(view, request.cardId, {
            type: 'cycleSpecialCondition',
          }),
          false
        );
      }
      const removal = resolveStackStateAction(view, request.cardId, {
        type: 'setSpecialCondition',
        condition: null,
      });
      // V1's Alt-Y branch creates the default P marker when one is absent.
      return !removal.ok && removal.reason === 'no_op'
        ? retainResolution(
            resolveStackStateAction(view, request.cardId, {
              type: 'cycleSpecialCondition',
            }),
            false
          )
        : retainResolution(removal, true);
    }
    case 'toggleAbility':
      return retainResolution(
        resolveCardAnnotationAction(view, request.cardId, {
          type: 'toggleAbilityUsed',
        }),
        true
      );
    case 'changeCardType':
      if (!isLegacyBoardCategoryChoice(request.category)) {
        return { ok: false, reason: 'invalid_value' };
      }
      return retainResolution(
        resolveCardAnnotationAction(view, request.cardId, {
          type: 'changeCategory',
          category: request.category,
        }),
        true
      );
    case 'togglePrivateInspection': {
      const active = view.privateInspections.find((inspection) =>
        inspection.cardIds.includes(request.cardId)
      );
      // A per-card key must never close an unrelated multi-card zone grant.
      // Projection does not expose grant scope, but a multi-card grant is
      // unambiguously not safe to collapse through this shortcut.
      if (active && active.cardIds.length !== 1) {
        return { ok: false, reason: 'unsupported_target' };
      }
      return retainResolution(
        resolveCardInspectionAction(view, request.cardId, !active),
        false
      );
    }
    case 'setPublicReveal':
      if (typeof request.revealed !== 'boolean') {
        return { ok: false, reason: 'invalid_value' };
      }
      return retainResolution(
        resolvePublicCardVisibilityAction(
          view,
          request.cardId,
          request.revealed
        ),
        false
      );
  }
};

export interface LegacyBoardShortcutKey {
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly getModifierState?: (keyArg: string) => boolean;
}

const hasAltModifier = (input: LegacyBoardShortcutKey): boolean =>
  input.altKey || input.getModifierState?.('Alt') === true;

const digitFor = (input: LegacyBoardShortcutKey): number | null => {
  const value = /^[1-9]$/.test(input.key)
    ? input.key
    : /^Digit[1-9]$/.test(input.code)
      ? input.code.slice(-1)
      : null;
  return value === null ? null : Number(value);
};

const matches = (
  input: LegacyBoardShortcutKey,
  key: string,
  code: string
): boolean => input.key === key || input.code === code;

/** Converts only the protected marker/category/visibility keys into a request. */
export const resolveLegacyBoardShortcutKey = (
  input: LegacyBoardShortcutKey,
  cardId: ViewCardId
): LegacyBoardShortcutActionRequest | null => {
  const altKey = hasAltModifier(input);
  const digit = digitFor(input);
  if (digit !== null) {
    return {
      action: 'adjustDamage',
      cardId,
      delta: digit * 10 * (altKey ? -1 : 1),
    };
  }
  if (matches(input, '0', 'Digit0')) {
    return { action: 'removeDamage', cardId };
  }
  if (matches(input, 'y', 'KeyY')) {
    return {
      action: 'cycleSpecialCondition',
      cardId,
      remove: altKey,
    };
  }
  if (matches(input, 'w', 'KeyW')) {
    return { action: 'toggleAbility', cardId };
  }
  if (matches(input, 'c', 'KeyC')) {
    return { action: 'togglePrivateInspection', cardId };
  }
  if (matches(input, 'z', 'KeyZ')) {
    return { action: 'setPublicReveal', cardId, revealed: altKey };
  }
  if (!altKey) return null;
  if (matches(input, 'e', 'KeyE')) {
    return { action: 'changeCardType', cardId, category: 'Energy' };
  }
  if (matches(input, 't', 'KeyT')) {
    return { action: 'changeCardType', cardId, category: 'Trainer' };
  }
  if (matches(input, 'p', 'KeyP')) {
    return { action: 'changeCardType', cardId, category: 'Pokémon' };
  }
  return null;
};
