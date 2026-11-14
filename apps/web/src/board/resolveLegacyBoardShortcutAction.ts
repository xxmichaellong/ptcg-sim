import type {
  CoinFlipSeries,
  MatchViewState,
  PlayerId,
  ViewCardId,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import { targetSeatField } from './acting-seat.js';
import type { GroupAction } from './compile-group.js';

import {
  isLegacyBoardCategoryChoice,
  type LegacyBoardCategoryChoice,
} from './resolveLegacyBoardOverlayAction.js';
import { resolveCardAnnotationAction } from './resolveCardAnnotationAction.js';
import {
  isCardPlayMoveDestination,
  resolveCardPlayMoveAction,
  type CardPlayMoveDestination,
} from './resolveCardPlayMoveAction.js';
import {
  isCardZoneMoveDestination,
  resolveCardZoneMoveAction,
  type CardZoneMoveDestination,
} from './resolveCardZoneMoveAction.js';
import { resolveCardStadiumMoveAction } from './resolveCardStadiumMoveAction.js';
import {
  resolveAttachEvolveTargeting,
  type AttachEvolveTargetingRejectionReason,
  type BoardPlayTargetingState,
} from './resolveAttachEvolveTargeting.js';
import {
  isDeckRelativeAction,
  resolveDeckRelativeCardAction,
  type DeckRelativeAction,
} from './resolveDeckRelativeAction.js';
import { resolveCardInspectionAction } from './resolvePrivateInspectionAction.js';
import { resolvePublicCardVisibilityAction } from './resolvePublicVisibilityAction.js';
import { resolveLooseBoardAction } from './resolveLooseBoardAction.js';
import { resolveLifecycleAction } from './resolveLifecycleAction.js';
import { parseLegacyCountInput } from './resolveLegacyBoardCountAction.js';
import { resolveSoloUndoAction } from './resolveSoloUndoAction.js';
import {
  resolveConditionKeyAction,
  resolveDamageKeyAction,
  resolveStackStateAction,
} from './resolveStackStateAction.js';
import { resolveTableAction } from './resolveTableAction.js';

export type LegacyLooseBoardShortcutDestination =
  'discard' | 'hand' | 'shuffleIntoDeck';

export type LegacyOwnDeckInspectionEdge = 'top' | 'bottom';

export type LegacyOwnHandShortcutAction =
  | 'discardOwnHandAndDraw'
  | 'shuffleOwnHandAndDraw'
  | 'shuffleOwnHandToDeckBottomAndDraw';

export const isLegacyOwnHandShortcutAction = (
  value: unknown
): value is LegacyOwnHandShortcutAction =>
  value === 'discardOwnHandAndDraw' ||
  value === 'shuffleOwnHandAndDraw' ||
  value === 'shuffleOwnHandToDeckBottomAndDraw';

export interface LegacyBoardShortcutCountPrompt {
  readonly kind: 'shortcutCount';
  readonly action: LegacyOwnHandShortcutAction;
  readonly playerId: string;
  readonly zoneId: string;
  readonly initialValue: '0';
  readonly minimum: 0;
}

const isLegacyLooseBoardShortcutDestination = (
  value: unknown
): value is LegacyLooseBoardShortcutDestination =>
  value === 'discard' || value === 'hand' || value === 'shuffleIntoDeck';

/**
 * The most cards one draw or look takes: the number keys say 1-9, the
 * command palette any number (ADR-035), up to the room's own limit.
 */
const MAX_SHORTCUT_COUNT = 200;

export type LegacyBoardShortcutActionRequest =
  | {
      readonly action: 'resolveOwnLooseBoard';
      readonly destination: LegacyLooseBoardShortcutDestination;
    }
  | { readonly action: 'drawOwnDeck'; readonly count: number }
  | {
      readonly action: 'inspectOwnDeck';
      readonly count: number;
      readonly edge: LegacyOwnDeckInspectionEdge;
    }
  | { readonly action: 'shuffleOwnDeck' }
  | {
      readonly action: 'flipCoin';
      /**
       * The seat whose coin was pressed on the table (Solo plays both);
       * the acting seat when absent, as the key flips.
       */
      readonly playerId?: PlayerId;
      /** Several coins at once (the coin's menu, the palette); one if absent. */
      readonly series?: CoinFlipSeries;
    }
  | { readonly action: 'setupOwnPlayer' }
  | { readonly action: 'resetOwnPlayer' }
  | { readonly action: 'startOwnTurn' }
  | {
      readonly action: 'undoOwnLastMove';
      /**
       * Take back the viewer's own move rather than the bottom seat's. A
       * multiplayer player only ever undoes their own, flipped board or not.
       */
      readonly ownSeat?: boolean;
    }
  | {
      readonly action: 'rotateSelectedCard';
      readonly cardId: ViewCardId;
      /** Alt-R rotates only the selected card; R rotates its whole stack. */
      readonly single: boolean;
    }
  | {
      readonly action: LegacyOwnHandShortcutAction;
      /** Missing opens the source-compatible prompt; present submits it. */
      readonly value?: string;
    }
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
    }
  | {
      readonly action: 'moveCardRelativeToDeck';
      readonly cardId: ViewCardId;
      readonly deckAction: DeckRelativeAction;
    }
  | {
      readonly action: 'moveCardToZone';
      readonly cardId: ViewCardId;
      readonly destination: CardZoneMoveDestination;
    }
  | {
      readonly action: 'moveCardToPlay';
      readonly cardId: ViewCardId;
      readonly slot: CardPlayMoveDestination;
    }
  | {
      readonly action: 'beginAttachOrEvolve';
      readonly cardId: ViewCardId;
      /** Attached as an Energy whatever its kind (a Holon's Pokémon). */
      readonly asCategory?: 'Energy';
    }
  | {
      readonly action: 'moveCardToStadium';
      readonly cardId: ViewCardId;
      readonly placement?: 'add';
    }
  /** A key pressed with several selected: their one move or mark. */
  | { readonly action: 'groupAction'; readonly group: GroupAction }
  /** `q`/`e` with several selected: pick the Pokémon they all go on. */
  | { readonly action: 'beginGroupAttach' };

export type LegacyBoardShortcutActionRejectionReason =
  | 'not_player'
  | 'stale_card'
  | 'stale_player'
  | 'unsupported_target'
  | 'unsupported_source'
  | 'unsupported_zone'
  | 'no_deck'
  | 'empty_deck'
  | 'empty_board'
  | 'empty_zone'
  | 'invalid_value'
  | 'no_op'
  | AttachEvolveTargetingRejectionReason;

export type LegacyBoardShortcutActionResolution =
  | {
      readonly ok: true;
      readonly command: WireGameCommand;
      /** Matches the source's immediate selection cleanup for this gesture. */
      readonly dismissSelection: boolean;
    }
  | {
      readonly ok: true;
      readonly input: LegacyBoardShortcutCountPrompt;
      readonly dismissSelection: false;
    }
  | {
      readonly ok: true;
      readonly targeting: BoardPlayTargetingState;
      readonly dismissSelection: true;
    }
  | {
      readonly ok: false;
      readonly reason: LegacyBoardShortcutActionRejectionReason;
    };

type ExistingActionResolution =
  | ReturnType<typeof resolveStackStateAction>
  | ReturnType<typeof resolveCardAnnotationAction>
  | ReturnType<typeof resolveCardPlayMoveAction>
  | ReturnType<typeof resolveCardStadiumMoveAction>
  | ReturnType<typeof resolveCardZoneMoveAction>
  | ReturnType<typeof resolveDeckRelativeCardAction>
  | ReturnType<typeof resolveCardInspectionAction>
  | ReturnType<typeof resolvePublicCardVisibilityAction>
  | ReturnType<typeof resolveLooseBoardAction>
  | ReturnType<typeof resolveLifecycleAction>
  | ReturnType<typeof resolveSoloUndoAction>
  | ReturnType<typeof resolveTableAction>;

const retainResolution = (
  resolution: ExistingActionResolution,
  dismissSelection: boolean
): LegacyBoardShortcutActionResolution =>
  resolution.ok
    ? { ok: true, command: resolution.command, dismissSelection }
    : resolution;

/** Maps characterized shortcut requests onto existing stale-safe resolvers. */
export const resolveLegacyBoardShortcutAction = (
  view: MatchViewState,
  request: LegacyBoardShortcutActionRequest,
  actingPlayerId?: PlayerId
): LegacyBoardShortcutActionResolution => {
  // Unselected shortcuts act for v1's initiator, the seat at the bottom of
  // the board: the viewer, or the other seat once the board is flipped.
  const acting =
    view.viewer.kind === 'player'
      ? (actingPlayerId ?? view.viewer.playerId)
      : undefined;
  switch (request.action) {
    case 'rotateSelectedCard': {
      if (typeof request.single !== 'boolean') {
        return { ok: false, reason: 'invalid_value' };
      }
      return retainResolution(
        resolveCardAnnotationAction(view, request.cardId, {
          type: 'rotate',
          single: request.single,
        }),
        false
      );
    }
    case 'resolveOwnLooseBoard': {
      if (!isLegacyLooseBoardShortcutDestination(request.destination)) {
        return { ok: false, reason: 'invalid_value' };
      }
      if (view.viewer.kind !== 'player') {
        return { ok: false, reason: 'not_player' };
      }
      return retainResolution(
        resolveLooseBoardAction(view, acting!, request.destination),
        false
      );
    }
    case 'drawOwnDeck':
    case 'inspectOwnDeck':
    case 'shuffleOwnDeck': {
      if (
        request.action !== 'shuffleOwnDeck' &&
        (!Number.isSafeInteger(request.count) ||
          request.count < 1 ||
          request.count > MAX_SHORTCUT_COUNT)
      ) {
        return { ok: false, reason: 'invalid_value' };
      }
      if (
        request.action === 'inspectOwnDeck' &&
        request.edge !== 'top' &&
        request.edge !== 'bottom'
      ) {
        return { ok: false, reason: 'invalid_value' };
      }
      if (view.viewer.kind !== 'player' || acting === undefined) {
        return { ok: false, reason: 'not_player' };
      }
      const viewerId = acting;
      if (!view.players[viewerId]) {
        return { ok: false, reason: 'stale_player' };
      }
      const deck = Object.values(view.zones).find(
        (zone) => zone.ownerId === viewerId && zone.kind === 'deck'
      );
      if (!deck) return { ok: false, reason: 'no_deck' };
      if (deck.cards.length === 0) {
        return { ok: false, reason: 'empty_deck' };
      }
      if (request.action === 'shuffleOwnDeck') {
        return {
          ok: true,
          command: { type: 'ShuffleZone', zoneId: deck.id },
          dismissSelection: false,
        };
      }
      const count = Math.min(request.count, deck.cards.length);
      if (request.action === 'drawOwnDeck') {
        return {
          ok: true,
          command: {
            type: 'DrawCards',
            count,
            ...targetSeatField(view, viewerId),
          },
          dismissSelection: false,
        };
      }
      return {
        ok: true,
        command: {
          type: 'ExtractDeckCardsForInspection',
          ownerPlayerId: viewerId,
          count,
          edge: request.edge,
          visibility: 'private',
        },
        dismissSelection: false,
      };
    }
    case 'flipCoin': {
      const seat = request.playerId ?? acting;
      if (view.viewer.kind !== 'player' || seat === undefined) {
        return { ok: false, reason: 'not_player' };
      }
      if (!view.players[seat]) {
        return { ok: false, reason: 'stale_player' };
      }
      return {
        ok: true,
        command: {
          type: 'FlipCoin',
          ...targetSeatField(view, seat),
          ...(request.series ? { series: request.series } : {}),
        },
        dismissSelection: false,
      };
    }
    case 'setupOwnPlayer':
    case 'resetOwnPlayer': {
      if (view.viewer.kind !== 'player' || acting === undefined) {
        return { ok: false, reason: 'not_player' };
      }
      return retainResolution(
        resolveLifecycleAction(
          view,
          acting,
          request.action === 'setupOwnPlayer' ? 'setup' : 'reset'
        ),
        false
      );
    }
    case 'startOwnTurn': {
      if (view.viewer.kind !== 'player' || acting === undefined) {
        return { ok: false, reason: 'not_player' };
      }
      return retainResolution(
        resolveTableAction(view, acting, 'startTurn'),
        false
      );
    }
    case 'undoOwnLastMove': {
      if (view.viewer.kind !== 'player' || acting === undefined) {
        return { ok: false, reason: 'not_player' };
      }
      return retainResolution(
        resolveSoloUndoAction(
          view,
          request.ownSeat ? view.viewer.playerId : acting
        ),
        false
      );
    }
    case 'discardOwnHandAndDraw':
    case 'shuffleOwnHandAndDraw':
    case 'shuffleOwnHandToDeckBottomAndDraw': {
      if (view.viewer.kind !== 'player' || acting === undefined) {
        return { ok: false, reason: 'not_player' };
      }
      const viewerId = acting;
      if (!view.players[viewerId]) {
        return { ok: false, reason: 'stale_player' };
      }
      const hand = Object.values(view.zones).find(
        (zone) => zone.ownerId === viewerId && zone.kind === 'hand'
      );
      if (!hand) return { ok: false, reason: 'unsupported_target' };
      const deck = Object.values(view.zones).find(
        (zone) => zone.ownerId === viewerId && zone.kind === 'deck'
      );
      if (!deck) return { ok: false, reason: 'no_deck' };
      if (request.value === undefined) {
        return {
          ok: true,
          input: {
            kind: 'shortcutCount',
            action: request.action,
            playerId: viewerId,
            zoneId: hand.id,
            initialValue: '0',
            minimum: 0,
          },
          dismissSelection: false,
        };
      }
      const requested = parseLegacyCountInput(request.value, 0);
      if (requested === undefined) {
        return { ok: false, reason: 'invalid_value' };
      }
      const available =
        request.action === 'discardOwnHandAndDraw'
          ? deck.cards.length
          : deck.cards.length + hand.cards.length;
      const count = Math.min(requested, available, 200);
      return {
        ok: true,
        command: {
          type:
            request.action === 'discardOwnHandAndDraw'
              ? 'DiscardHandAndDraw'
              : request.action === 'shuffleOwnHandAndDraw'
                ? 'ShuffleHandIntoDeckAndDraw'
                : 'ShuffleHandToDeckBottomAndDraw',
          count,
          ...targetSeatField(view, viewerId),
        },
        dismissSelection: false,
      };
    }
    case 'adjustDamage': {
      const resolution = resolveDamageKeyAction(
        view,
        request.cardId,
        request.delta
      );
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
      const resolution = resolveConditionKeyAction(
        view,
        request.cardId,
        request.remove
      );
      // Taking it off lets the card go; putting one on keeps it selected.
      return retainResolution(
        resolution,
        resolution.ok &&
          resolution.command.type === 'SetSpecialCondition' &&
          resolution.command.condition === null
      );
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
    case 'moveCardRelativeToDeck':
      if (!isDeckRelativeAction(request.deckAction)) {
        return { ok: false, reason: 'invalid_value' };
      }
      return retainResolution(
        resolveDeckRelativeCardAction(
          view,
          request.cardId,
          request.deckAction,
          acting
        ),
        true
      );
    case 'moveCardToZone':
      if (!isCardZoneMoveDestination(request.destination)) {
        return { ok: false, reason: 'invalid_value' };
      }
      return retainResolution(
        resolveCardZoneMoveAction(
          view,
          request.cardId,
          request.destination,
          acting
        ),
        true
      );
    case 'moveCardToPlay':
      if (!isCardPlayMoveDestination(request.slot)) {
        return { ok: false, reason: 'invalid_value' };
      }
      return retainResolution(
        resolveCardPlayMoveAction(view, request.cardId, request.slot, acting),
        true
      );
    case 'beginAttachOrEvolve': {
      const resolution = resolveAttachEvolveTargeting(
        view,
        request.cardId,
        request.asCategory ? { asCategory: request.asCategory } : {}
      );
      return resolution.ok
        ? {
            ok: true,
            targeting: resolution.targeting,
            dismissSelection: true,
          }
        : resolution;
    }
    case 'moveCardToStadium':
      return retainResolution(
        resolveCardStadiumMoveAction(
          view,
          request.cardId,
          request.placement,
          acting
        ),
        true
      );
    // The controller compiles a group's keys (compileGroup); one card's
    // resolver has nothing to say about them.
    case 'groupAction':
    case 'beginGroupAttach':
      return { ok: false, reason: 'unsupported_source' };
  }
};

export interface LegacyBoardShortcutKey {
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
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

/** Converts the protected selected-card keys into a closed request. */
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
  if (matches(input, 'r', 'KeyR')) {
    return { action: 'rotateSelectedCard', cardId, single: altKey };
  }
  if (!altKey && matches(input, 'ArrowUp', 'ArrowUp')) {
    return {
      action: 'moveCardRelativeToDeck',
      cardId,
      deckAction: 'moveToTop',
    };
  }
  if (!altKey && matches(input, 'ArrowDown', 'ArrowDown')) {
    return {
      action: 'moveCardRelativeToDeck',
      cardId,
      deckAction: 'moveToBottom',
    };
  }
  if (!altKey && matches(input, 'ArrowRight', 'ArrowRight')) {
    return {
      action: 'moveCardRelativeToDeck',
      cardId,
      deckAction: 'swapWithTop',
    };
  }
  if (!altKey && matches(input, 's', 'KeyS')) {
    return {
      action: 'moveCardRelativeToDeck',
      cardId,
      deckAction: 'shuffleIntoDeck',
    };
  }
  if (!altKey && matches(input, 'h', 'KeyH')) {
    return { action: 'moveCardToZone', cardId, destination: 'hand' };
  }
  if (!altKey && matches(input, 'd', 'KeyD')) {
    return { action: 'moveCardToZone', cardId, destination: 'discard' };
  }
  if (!altKey && matches(input, 'l', 'KeyL')) {
    return { action: 'moveCardToZone', cardId, destination: 'lostZone' };
  }
  if (!altKey && matches(input, ' ', 'KeySpace')) {
    return { action: 'moveCardToZone', cardId, destination: 'board' };
  }
  if (!altKey && matches(input, 'a', 'KeyA')) {
    return { action: 'moveCardToPlay', cardId, slot: 'active' };
  }
  if (!altKey && matches(input, 'b', 'KeyB')) {
    return { action: 'moveCardToPlay', cardId, slot: 'bench' };
  }
  if (!altKey && matches(input, 'g', 'KeyG')) {
    return {
      action: 'moveCardToStadium',
      cardId,
      ...(input.shiftKey ? { placement: 'add' as const } : {}),
    };
  }
  if (!altKey && (matches(input, 'q', 'KeyQ') || matches(input, 'e', 'KeyE'))) {
    return { action: 'beginAttachOrEvolve', cardId };
  }
  if (!altKey && matches(input, 'p', 'KeyP')) {
    return { action: 'moveCardToZone', cardId, destination: 'prizes' };
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

/**
 * What a key means with several selected (ADR-042 §3): a move or mark for
 * all of them; `q`/`e`, a Pokémon for all of them to go on; or one card's
 * key (Read, switch with the top of the deck, look/cover, change type)
 * that asks for a single card. Null for a key that is no card's. Shift
 * means nothing here, as players keep it held after picking with it.
 */
export type LegacyBoardGroupShortcut =
  | { readonly kind: 'action'; readonly action: GroupAction }
  | { readonly kind: 'attach' }
  | { readonly kind: 'single' };

export const resolveLegacyBoardGroupShortcutKey = (
  input: LegacyBoardShortcutKey
): LegacyBoardGroupShortcut | null => {
  const altKey = hasAltModifier(input);
  const send = (to: Extract<GroupAction, { kind: 'send' }>['to']) =>
    ({ kind: 'action', action: { kind: 'send', to } }) as const;
  const digit = digitFor(input);
  if (digit !== null) {
    return {
      kind: 'action',
      action: { kind: 'damage', delta: digit * 10 * (altKey ? -1 : 1) },
    };
  }
  if (matches(input, '0', 'Digit0'))
    return { kind: 'action', action: { kind: 'clearDamage' } };
  if (matches(input, 'y', 'KeyY'))
    return { kind: 'action', action: { kind: 'condition', remove: altKey } };
  if (matches(input, 'z', 'KeyZ'))
    return { kind: 'action', action: { kind: 'reveal', revealed: altKey } };
  if (matches(input, 'r', 'KeyR'))
    return { kind: 'action', action: { kind: 'rotate', single: altKey } };
  if (altKey) {
    // Alt+E/T/P change one card's type.
    return matches(input, 'e', 'KeyE') ||
      matches(input, 't', 'KeyT') ||
      matches(input, 'p', 'KeyP')
      ? { kind: 'single' }
      : null;
  }
  if (matches(input, 'w', 'KeyW'))
    return { kind: 'action', action: { kind: 'ability' } };
  if (matches(input, 'ArrowUp', 'ArrowUp')) return send('deckTop');
  if (matches(input, 'ArrowDown', 'ArrowDown')) return send('deckBottom');
  if (matches(input, 's', 'KeyS')) return send('deckShuffled');
  if (matches(input, 'h', 'KeyH')) return send('hand');
  if (matches(input, 'd', 'KeyD')) return send('discard');
  if (matches(input, 'l', 'KeyL')) return send('lostZone');
  if (matches(input, 'p', 'KeyP')) return send('prizes');
  if (matches(input, ' ', 'KeySpace') || matches(input, ' ', 'Space'))
    return send('board');
  if (matches(input, 'a', 'KeyA'))
    return { kind: 'action', action: { kind: 'play', slot: 'active' } };
  if (matches(input, 'b', 'KeyB'))
    return { kind: 'action', action: { kind: 'play', slot: 'bench' } };
  if (matches(input, 'g', 'KeyG'))
    return { kind: 'action', action: { kind: 'stadium' } };
  if (matches(input, 'q', 'KeyQ') || matches(input, 'e', 'KeyE'))
    return { kind: 'attach' };
  if (
    matches(input, 'ArrowRight', 'ArrowRight') ||
    matches(input, 'c', 'KeyC') ||
    matches(input, 'v', 'KeyV')
  )
    return { kind: 'single' };
  return null;
};

/** Converts the characterized always-global keys into viewer-owned requests. */
export const resolveLegacyBoardGlobalShortcutKey = (
  input: LegacyBoardShortcutKey
): LegacyBoardShortcutActionRequest | null => {
  const altKey = hasAltModifier(input);
  if (!altKey && matches(input, 'f', 'KeyF')) {
    return { action: 'flipCoin' };
  }
  if (matches(input, 'Enter', 'Enter')) {
    return {
      action: 'resolveOwnLooseBoard',
      destination: altKey ? 'hand' : 'discard',
    };
  }
  if (matches(input, '/', 'Slash')) {
    return {
      action: 'resolveOwnLooseBoard',
      destination: 'shuffleIntoDeck',
    };
  }
  return null;
};

/** Converts keys that v1 accepts only while no card is selected. */
export const resolveLegacyBoardUnselectedShortcutKey = (
  input: LegacyBoardShortcutKey
): LegacyBoardShortcutActionRequest | null => {
  const altKey = hasAltModifier(input);
  const digit = digitFor(input);
  if (digit !== null) {
    // V1 executes both inspection branches for Alt+Control+digit. The second
    // mutation observes a deck already changed by the first and throws before
    // logging itself, so v2 rejects the ambiguous chord instead of reproducing
    // a non-atomic partial action.
    if (altKey && input.ctrlKey === true) return null;
    if (altKey) {
      return { action: 'inspectOwnDeck', count: digit, edge: 'top' };
    }
    if (input.ctrlKey === true) {
      return { action: 'inspectOwnDeck', count: digit, edge: 'bottom' };
    }
    return { action: 'drawOwnDeck', count: digit };
  }
  if (!altKey && matches(input, 's', 'KeyS')) {
    return { action: 'shuffleOwnDeck' };
  }
  if (altKey && matches(input, 'n', 'KeyN')) {
    return { action: 'setupOwnPlayer' };
  }
  if (altKey && matches(input, 'r', 'KeyR')) {
    return { action: 'resetOwnPlayer' };
  }
  if (altKey && matches(input, 't', 'KeyT')) {
    return { action: 'startOwnTurn' };
  }
  if (altKey && matches(input, 'd', 'KeyD')) {
    return { action: 'discardOwnHandAndDraw' };
  }
  if (altKey && matches(input, 's', 'KeyS')) {
    return { action: 'shuffleOwnHandAndDraw' };
  }
  if (altKey && matches(input, 'ArrowDown', 'ArrowDown')) {
    return { action: 'shuffleOwnHandToDeckBottomAndDraw' };
  }
  if (!altKey && matches(input, 'u', 'KeyU')) {
    return { action: 'undoOwnLastMove' };
  }
  return null;
};
