import type { ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import { actingPlayerIdOf } from './acting-seat.js';
import type { BoardSessionControllerState } from './BoardSessionController.js';
import {
  isReplayLocalDisclosureAction,
  replayLocalDisclosureMode,
} from './replayLocalDisclosure.js';
import {
  resolveLegacyBoardOverlayAction,
  type LegacyBoardContextActionId,
} from './resolveLegacyBoardOverlayAction.js';

/**
 * Menu actions that go one way or the other by the table's state: v1 named
 * both ("Reveal/hide card"); the menu names the one they will take.
 */
export const TWO_WAY_CONTEXT_ACTIONS = [
  'revealCard',
  'revealPrizes',
  'togglePrizes',
  'toggleOpponentHand',
  'toggleAbility',
] as const satisfies readonly LegacyBoardContextActionId[];

export type TwoWayContextAction = (typeof TWO_WAY_CONTEXT_ACTIONS)[number];

export const isTwoWayContextAction = (
  action: LegacyBoardContextActionId
): action is TwoWayContextAction =>
  (TWO_WAY_CONTEXT_ACTIONS as readonly string[]).includes(action);

/** Which way a two-way action goes now. */
export type ContextActionOutcome =
  'reveal' | 'hide' | 'look' | 'cover' | 'markUsed' | 'markUnused';

/** What the table shows that the room does not decide. */
export interface ContextActionLocalState {
  /**
   * A live Solo table: whether the other seat's hand is hidden. There its
   * Look/Cover is the table's "Hide opponent's hand" switch
   * (RemoteSessionBoard), not a look the room grants.
   */
  readonly soloOpponentHandHidden?: boolean;
}

/** The way a command the resolver chose goes. */
export const outcomeOfCommand = (
  command: WireGameCommand
): ContextActionOutcome | null => {
  switch (command.type) {
    case 'SetPublicReveal':
    case 'SetZonePublicReveal':
      return command.revealed ? 'reveal' : 'hide';
    case 'BeginZoneInspection':
    case 'BeginCardInspection':
      return 'look';
    case 'EndPrivateInspection':
      return 'cover';
    case 'SetAbilityUsed':
    case 'SetCardAbilityUsed':
      return command.used ? 'markUsed' : 'markUnused';
    default:
      return null;
  }
};

const SHOWS: Readonly<Record<TwoWayContextAction, ContextActionOutcome>> = {
  revealCard: 'reveal',
  revealPrizes: 'reveal',
  togglePrizes: 'look',
  toggleOpponentHand: 'look',
  toggleAbility: 'markUsed',
};

const HIDES: Readonly<Record<TwoWayContextAction, ContextActionOutcome>> = {
  revealCard: 'hide',
  revealPrizes: 'hide',
  togglePrizes: 'cover',
  toggleOpponentHand: 'cover',
  toggleAbility: 'markUnused',
};

/**
 * What `action` on the card the menu was opened on will do now, read from
 * the very decision that carries it out: in a replay the local disclosure's
 * toggle, on a live Solo table the hand switch, otherwise the resolver the
 * controller runs, for the seat it acts for. Reveal and Hide prizes go by
 * that card too: all the Prizes take the opposite of its state. Null where
 * the action would do nothing (the menu leaves it out).
 */
export const contextActionOutcome = (
  state: BoardSessionControllerState,
  cardId: ViewCardId,
  action: TwoWayContextAction,
  local: ContextActionLocalState = {}
): ContextActionOutcome | null => {
  const view = state.view;
  if (!view) return null;
  if (
    state.source?.kind === 'replay' &&
    state.replayLocalDisplay &&
    isReplayLocalDisclosureAction(action)
  ) {
    const mode = replayLocalDisclosureMode(
      view,
      state.replayLocalDisplay,
      action,
      cardId
    );
    return mode === null
      ? null
      : mode === 'shown'
        ? SHOWS[action]
        : HIDES[action];
  }
  if (
    action === 'toggleOpponentHand' &&
    local.soloOpponentHandHidden !== undefined
  ) {
    return local.soloOpponentHandHidden ? 'look' : 'cover';
  }
  const resolution = resolveLegacyBoardOverlayAction(
    view,
    { kind: 'context', action, cardId },
    actingPlayerIdOf(view, state.scene?.bottomPlayerId)
  );
  if (!resolution.ok || !('command' in resolution) || !resolution.command) {
    return null;
  }
  return outcomeOfCommand(resolution.command);
};
