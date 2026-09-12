import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export const LEGACY_BOARD_COUNT_ACTION_IDS = [
  'discardHand',
  'shuffleHandToDeck',
  'shuffleHandToDeckBottom',
  'drawCards',
  'viewDeckTop',
  'viewDeckBottom',
] as const;

export type LegacyBoardCountActionId =
  (typeof LEGACY_BOARD_COUNT_ACTION_IDS)[number];

export interface LegacyBoardCountPrompt {
  readonly kind: 'count';
  readonly action: LegacyBoardCountActionId;
  readonly cardId: ViewCardId;
  readonly zoneId: string;
  readonly message: string;
  readonly initialValue: '0' | '1';
  readonly minimum: 0 | 1;
  readonly invalidMessage: string;
}

export type LegacyBoardCountActionResolution =
  | { readonly ok: true; readonly input: LegacyBoardCountPrompt }
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason:
        'not_player' | 'stale_card' | 'unsupported_target' | 'invalid_value';
    };

const DRAW_PROMPT = 'Draw how many cards?';
const VIEW_PROMPT = 'How many cards do you want to look at?';
const INVALID_DRAW = 'Please enter a valid number for the draw amount.';
const INVALID_VIEW = 'Please enter a valid number for the view amount.';
const MAX_WIRE_COUNT = 200;

export const isLegacyBoardCountActionId = (
  value: string
): value is LegacyBoardCountActionId =>
  (LEGACY_BOARD_COUNT_ACTION_IDS as readonly string[]).includes(value);

export const parseLegacyCountInput = (
  value: string,
  minimum: 0 | 1
): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || !/^\d+$/u.test(normalized)) return undefined;
  const count = Number(normalized);
  return Number.isSafeInteger(count) && count >= minimum ? count : undefined;
};

const promptFor = (
  action: LegacyBoardCountActionId,
  cardId: ViewCardId,
  zoneId: string
): LegacyBoardCountPrompt => {
  const handAction =
    action === 'discardHand' ||
    action === 'shuffleHandToDeck' ||
    action === 'shuffleHandToDeckBottom';
  const viewAction = action === 'viewDeckTop' || action === 'viewDeckBottom';
  return {
    kind: 'count',
    action,
    cardId,
    zoneId,
    message: viewAction ? VIEW_PROMPT : DRAW_PROMPT,
    initialValue: handAction ? '0' : '1',
    minimum: handAction ? 0 : 1,
    invalidMessage: viewAction ? INVALID_VIEW : INVALID_DRAW,
  };
};

/**
 * Resolves the six legacy count prompts without trusting a stale DOM target.
 * The submitted count is clamped to current recipient-safe capacity and the
 * protocol ceiling; authority still performs its own live-state validation.
 */
export const resolveLegacyBoardCountAction = (
  view: MatchViewState,
  action: LegacyBoardCountActionId,
  cardId: ViewCardId,
  value?: string
): LegacyBoardCountActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const viewerId = view.viewer.playerId;
  const zone = Object.values(view.zones).find((candidate) =>
    candidate.cards.some((card) => card.id === cardId)
  );
  if (!zone) return { ok: false, reason: 'stale_card' };

  const handAction =
    action === 'discardHand' ||
    action === 'shuffleHandToDeck' ||
    action === 'shuffleHandToDeckBottom';
  if (handAction && (zone.kind !== 'hand' || zone.ownerId !== viewerId)) {
    return { ok: false, reason: 'unsupported_target' };
  }
  if (
    !handAction &&
    (zone.kind !== 'deck' ||
      zone.ownerId === null ||
      (action === 'drawCards' && zone.ownerId !== viewerId))
  ) {
    return { ok: false, reason: 'unsupported_target' };
  }

  const prompt = promptFor(action, cardId, zone.id);
  if (value === undefined) return { ok: true, input: prompt };
  const requested = parseLegacyCountInput(value, prompt.minimum);
  if (requested === undefined) return { ok: false, reason: 'invalid_value' };

  if (handAction) {
    const deck = Object.values(view.zones).find(
      (candidate) => candidate.kind === 'deck' && candidate.ownerId === viewerId
    );
    if (!deck) return { ok: false, reason: 'unsupported_target' };
    const available =
      action === 'discardHand'
        ? deck.cards.length
        : deck.cards.length + zone.cards.length;
    const count = Math.min(requested, available, MAX_WIRE_COUNT);
    return {
      ok: true,
      command: {
        type:
          action === 'discardHand'
            ? 'DiscardHandAndDraw'
            : action === 'shuffleHandToDeck'
              ? 'ShuffleHandIntoDeckAndDraw'
              : 'ShuffleHandToDeckBottomAndDraw',
        count,
      },
    };
  }

  const count = Math.min(requested, zone.cards.length, MAX_WIRE_COUNT);
  if (action === 'drawCards') {
    return { ok: true, command: { type: 'DrawCards', count } };
  }
  return {
    ok: true,
    command: {
      type: 'ExtractDeckCardsForInspection',
      ownerPlayerId: zone.ownerId!,
      count,
      edge: action === 'viewDeckTop' ? 'top' : 'bottom',
      visibility: zone.ownerId === viewerId ? 'private' : 'public',
    },
  };
};
