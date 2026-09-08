import { MAX_DECK_CARDS } from '@ptcgsim/game-core';

import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

const LEGACY_V1_CARD_SOURCE_ZONES = [
  'deck',
  'deckCover',
  'hand',
  'prizes',
  'discard',
  'discardCover',
  'lostZone',
  'lostZoneCover',
  'board',
  'stadium',
  'active',
  'bench',
  'attachedCards',
  'viewCards',
] as const;

export type LegacyV1CardSourceZone =
  (typeof LEGACY_V1_CARD_SOURCE_ZONES)[number];

const LEGACY_V1_LOOSE_DESTINATION_ZONES = [
  'deck',
  'hand',
  'prizes',
  'discard',
  'discardCover',
  'lostZone',
  'lostZoneCover',
  'board',
] as const;

export type LegacyV1LooseDestinationZone =
  (typeof LEGACY_V1_LOOSE_DESTINATION_ZONES)[number];

const LEGACY_V1_PLAY_DESTINATION_ZONES = ['active', 'bench'] as const;

type LegacyV1PlayDestinationZone =
  (typeof LEGACY_V1_PLAY_DESTINATION_ZONES)[number];

export type LegacyV1MovementAction =
  | {
      readonly type: 'draw';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly count: number;
    }
  | {
      readonly type: 'discardAndDraw';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly count: number;
    }
  | {
      readonly type: 'shuffleAndDraw';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly count: number;
      readonly shuffleIndices: readonly number[];
    }
  | {
      readonly type: 'shuffleBottomAndDraw';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly count: number;
      readonly shuffleIndices: readonly number[];
    }
  | {
      readonly type: 'viewDeck';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly count: number;
      readonly edge: 'top' | 'bottom';
      readonly expectedDeckCount: number;
      readonly targetIsOpponent: boolean;
    }
  | {
      readonly type: 'moveCardBundle';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: LegacyV1CardSourceZone;
      readonly sourceIndex: number;
      readonly destinationZone: 'deck';
      readonly targetIndex: false;
      readonly mode: 'bottom';
    }
  | {
      readonly type: 'moveCardBundle';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: LegacyV1CardSourceZone;
      readonly sourceIndex: number;
      readonly destinationZone: LegacyV1LooseDestinationZone;
      readonly targetIndex: false | null;
      readonly mode: 'move';
    }
  | {
      readonly type: 'moveCardBundle';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: LegacyV1CardSourceZone;
      readonly sourceIndex: number;
      readonly destinationZone: LegacyV1PlayDestinationZone;
      readonly targetIndex: false | null;
      readonly mode: 'move';
    }
  | {
      readonly type: 'moveCardBundle';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: LegacyV1CardSourceZone;
      readonly sourceIndex: number;
      readonly destinationZone: LegacyV1PlayDestinationZone;
      readonly targetIndex: number;
      readonly mode: 'move';
    }
  | {
      readonly type: 'moveCardBundle';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: LegacyV1CardSourceZone;
      readonly sourceIndex: number;
      readonly destinationZone: 'stadium';
      readonly targetIndex: false | null;
      readonly mode: 'move';
    }
  | {
      readonly type: 'leaveAll';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: 'attachedCards';
      readonly destinationSlot: LegacyV1PlayDestinationZone;
    }
  | {
      readonly type: 'discardAll' | 'lostZoneAll' | 'handAll';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: 'attachedCards' | 'viewCards';
    }
  | {
      readonly type: 'shuffleAll' | 'shuffleBottom';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: 'attachedCards' | 'viewCards';
      readonly shuffleIndices: readonly number[];
    }
  | {
      readonly type: 'shuffleZone';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly zone: 'prizes';
      readonly shuffleIndices: readonly number[];
      readonly message: true;
    }
  | {
      readonly type: 'moveToDeckTop';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: LegacyV1CardSourceZone;
      readonly sourceIndex: number;
    }
  | {
      readonly type: 'shuffleIntoDeck';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: LegacyV1CardSourceZone;
      readonly sourceIndex: number;
      readonly shuffleIndices: readonly number[];
    }
  | {
      readonly type: 'switchWithDeckTop';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: LegacyV1CardSourceZone;
      readonly sourceIndex: number;
    }
  | {
      readonly type: 'shufflePrizesToDeckBottom';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly shuffleIndices: readonly number[];
    };

export type LegacyV1MovementDecodeIssueCode =
  | 'invalid_parameter_count'
  | 'invalid_parameter_type'
  | 'invalid_draw_count'
  | 'invalid_discard_draw_count'
  | 'invalid_shuffle_draw_count'
  | 'invalid_shuffle_bottom_draw_count'
  | 'invalid_view_count'
  | 'invalid_recorded_deck_count'
  | 'invalid_view_target'
  | 'unsupported_move_card_bundle'
  | 'invalid_destination_zone'
  | 'invalid_target_index'
  | 'invalid_shuffle_zone'
  | 'invalid_shuffle_permutation'
  | 'invalid_shuffle_message'
  | 'invalid_source_zone'
  | 'invalid_card_index';

export interface LegacyV1MovementDecodeIssue {
  readonly code: LegacyV1MovementDecodeIssueCode;
  readonly recordIndex: number;
  readonly path: string;
  readonly message: string;
}

export type LegacyV1MovementDecodeResult =
  | {
      readonly ok: true;
      readonly actions: readonly LegacyV1MovementAction[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly LegacyV1MovementDecodeIssue[];
    };

const failure = (
  code: LegacyV1MovementDecodeIssueCode,
  actionIndex: number,
  suffix: string,
  message: string
): LegacyV1MovementDecodeResult => ({
  ok: false,
  issues: [
    {
      code,
      recordIndex: actionIndex + 1,
      path: `$[${actionIndex + 1}]${suffix}`,
      message,
    },
  ],
});

const isLooseDestinationZone = (
  value: string
): value is LegacyV1LooseDestinationZone =>
  (LEGACY_V1_LOOSE_DESTINATION_ZONES as readonly string[]).includes(value);

const isPlayDestinationZone = (
  value: string
): value is LegacyV1PlayDestinationZone =>
  (LEGACY_V1_PLAY_DESTINATION_ZONES as readonly string[]).includes(value);

const isMovementAction = (
  action: LegacyActionRecord
): action is LegacyActionRecord & {
  readonly action:
    | 'draw'
    | 'discardAndDraw'
    | 'shuffleAndDraw'
    | 'shuffleBottomAndDraw'
    | 'viewDeck'
    | 'moveCardBundle'
    | 'leaveAll'
    | 'discardAll'
    | 'lostZoneAll'
    | 'handAll'
    | 'shuffleAll'
    | 'shuffleBottom'
    | 'shuffleZone'
    | 'moveToDeckTop'
    | 'shuffleIntoDeck'
    | 'switchWithDeckTop'
    | 'shufflePrizesToDeckBottom';
} =>
  action.action === 'draw' ||
  action.action === 'discardAndDraw' ||
  action.action === 'shuffleAndDraw' ||
  action.action === 'shuffleBottomAndDraw' ||
  action.action === 'viewDeck' ||
  action.action === 'moveCardBundle' ||
  action.action === 'leaveAll' ||
  action.action === 'discardAll' ||
  action.action === 'lostZoneAll' ||
  action.action === 'handAll' ||
  action.action === 'shuffleAll' ||
  action.action === 'shuffleBottom' ||
  action.action === 'shuffleZone' ||
  action.action === 'moveToDeckTop' ||
  action.action === 'shuffleIntoDeck' ||
  action.action === 'switchWithDeckTop' ||
  action.action === 'shufflePrizesToDeckBottom';

const cardSourceZones = new Set<string>(LEGACY_V1_CARD_SOURCE_ZONES);

const isCardSourceZone = (value: string): value is LegacyV1CardSourceZone =>
  cardSourceZones.has(value);

const decodeShuffle = (value: unknown): readonly number[] | null => {
  if (
    !Array.isArray(value) ||
    value.length > MAX_DECK_CARDS ||
    !value.every(
      (index) =>
        typeof index === 'number' &&
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < value.length
    ) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return value as number[];
};

type LegacyV1CardSourceDecodeResult =
  | {
      readonly ok: true;
      readonly initiator: LegacyExportUser;
      readonly sourceZone: LegacyV1CardSourceZone;
      readonly sourceIndex: number;
    }
  | {
      readonly ok: false;
      readonly result: LegacyV1MovementDecodeResult;
    };

const decodeCardSource = (
  action: LegacyActionRecord,
  actionIndex: number,
  actionName:
    | 'moveCardBundle'
    | 'moveToDeckTop'
    | 'shuffleIntoDeck'
    | 'switchWithDeckTop',
  sourceIndexParameter = 2
): LegacyV1CardSourceDecodeResult => {
  const initiator = action.parameters[0];
  if (initiator !== 'self' && initiator !== 'opp') {
    return {
      ok: false,
      result: failure(
        'invalid_parameter_type',
        actionIndex,
        '.parameters[0]',
        `${actionName} initiator must use the exported self/opp perspective`
      ),
    };
  }

  const sourceZone = action.parameters[1];
  if (typeof sourceZone !== 'string') {
    return {
      ok: false,
      result: failure(
        'invalid_parameter_type',
        actionIndex,
        '.parameters[1]',
        `${actionName} source zone must be a string`
      ),
    };
  }
  if (!isCardSourceZone(sourceZone)) {
    return {
      ok: false,
      result: failure(
        'invalid_source_zone',
        actionIndex,
        '.parameters[1]',
        `${actionName} source zone is not a legacy card container`
      ),
    };
  }

  const sourceIndex = action.parameters[sourceIndexParameter];
  if (typeof sourceIndex !== 'number') {
    return {
      ok: false,
      result: failure(
        'invalid_parameter_type',
        actionIndex,
        `.parameters[${sourceIndexParameter}]`,
        `${actionName} source index must be a number`
      ),
    };
  }
  if (
    !Number.isSafeInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= MAX_DECK_CARDS ||
    (sourceZone === 'deckCover' && sourceIndex !== 0)
  ) {
    return {
      ok: false,
      result: failure(
        'invalid_card_index',
        actionIndex,
        `.parameters[${sourceIndexParameter}]`,
        `${actionName} source index must be an integer from 0 to ${MAX_DECK_CARDS - 1}, and deckCover always selects index 0`
      ),
    };
  }

  return { ok: true, initiator, sourceZone, sourceIndex };
};

/**
 * Decodes admitted movement tuples without applying them. This starts with the
 * source-bounded draw, discard-and-draw, shuffle-hand-and-draw,
 * shuffle-hand-to-deck-bottom-and-draw, and deck inspection; bottom-mode and
 * target-free loose-zone/stadium/new-play-stack card bundles; staged-stack leave-all,
 * staged discard/lost-zone/hand draining, and staged deck shuffles; direct
 * prize-shuffle; move-to-deck-top; shuffle-into-deck; switch-with-deck-top;
 * and shuffled-prizes-to-deck-bottom atoms. The remaining movement actions
 * stay untouched until their positional and state-dependent behavior is
 * frozen.
 */
export const decodeLegacyV1MovementActions = (
  parsed: ParsedLegacyExport
): LegacyV1MovementDecodeResult => {
  const decoded: LegacyV1MovementAction[] = [];
  for (
    let actionIndex = 0;
    actionIndex < parsed.actions.length;
    actionIndex += 1
  ) {
    const action = parsed.actions[actionIndex]!;
    if (!isMovementAction(action)) continue;

    switch (action.action) {
      case 'draw': {
        if (action.parameters.length !== 2) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'draw requires [initiator, count]'
          );
        }

        const initiator = action.parameters[0];
        if (initiator !== 'self' && initiator !== 'opp') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            'draw initiator must use the exported self/opp perspective'
          );
        }

        const count = action.parameters[1];
        if (typeof count !== 'number') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[1]',
            'draw count must be a number'
          );
        }
        if (
          !Number.isSafeInteger(count) ||
          count < 1 ||
          count > MAX_DECK_CARDS
        ) {
          return failure(
            'invalid_draw_count',
            actionIndex,
            '.parameters[1]',
            `draw count must be an integer from 1 to ${MAX_DECK_CARDS}`
          );
        }

        decoded.push({
          type: 'draw',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator,
          count,
        });
        break;
      }
      case 'discardAndDraw': {
        if (action.parameters.length !== 2) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'discardAndDraw requires [initiator, count]'
          );
        }

        const initiator = action.parameters[0];
        if (initiator !== 'self' && initiator !== 'opp') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            'discardAndDraw initiator must use the exported self/opp perspective'
          );
        }

        const count = action.parameters[1];
        if (typeof count !== 'number') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[1]',
            'discardAndDraw count must be a number'
          );
        }
        if (
          !Number.isSafeInteger(count) ||
          count < 0 ||
          count > MAX_DECK_CARDS
        ) {
          return failure(
            'invalid_discard_draw_count',
            actionIndex,
            '.parameters[1]',
            `discardAndDraw count must be an integer from 0 to ${MAX_DECK_CARDS}`
          );
        }

        decoded.push({
          type: 'discardAndDraw',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator,
          count,
        });
        break;
      }
      case 'shuffleAndDraw': {
        if (action.parameters.length !== 3) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'shuffleAndDraw requires [initiator, count, permutation]'
          );
        }

        const initiator = action.parameters[0];
        if (initiator !== 'self' && initiator !== 'opp') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            'shuffleAndDraw initiator must use the exported self/opp perspective'
          );
        }

        const count = action.parameters[1];
        if (typeof count !== 'number') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[1]',
            'shuffleAndDraw count must be a number'
          );
        }
        if (
          !Number.isSafeInteger(count) ||
          count < 0 ||
          count > MAX_DECK_CARDS
        ) {
          return failure(
            'invalid_shuffle_draw_count',
            actionIndex,
            '.parameters[1]',
            `shuffleAndDraw count must be an integer from 0 to ${MAX_DECK_CARDS}`
          );
        }

        const shuffleIndices = decodeShuffle(action.parameters[2]);
        if (!shuffleIndices) {
          return failure(
            'invalid_shuffle_permutation',
            actionIndex,
            '.parameters[2]',
            'shuffleAndDraw requires a complete zero-based shuffle permutation'
          );
        }
        if (count > shuffleIndices.length) {
          return failure(
            'invalid_shuffle_draw_count',
            actionIndex,
            '.parameters[1]',
            'shuffleAndDraw count cannot exceed its recorded shuffle permutation length'
          );
        }

        decoded.push({
          type: 'shuffleAndDraw',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator,
          count,
          shuffleIndices,
        });
        break;
      }
      case 'shuffleBottomAndDraw': {
        if (action.parameters.length !== 3) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'shuffleBottomAndDraw requires [initiator, count, handPermutation]'
          );
        }

        const initiator = action.parameters[0];
        if (initiator !== 'self' && initiator !== 'opp') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            'shuffleBottomAndDraw initiator must use the exported self/opp perspective'
          );
        }

        const count = action.parameters[1];
        if (typeof count !== 'number') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[1]',
            'shuffleBottomAndDraw count must be a number'
          );
        }
        if (
          !Number.isSafeInteger(count) ||
          count < 0 ||
          count > MAX_DECK_CARDS
        ) {
          return failure(
            'invalid_shuffle_bottom_draw_count',
            actionIndex,
            '.parameters[1]',
            `shuffleBottomAndDraw count must be an integer from 0 to ${MAX_DECK_CARDS}`
          );
        }

        const shuffleIndices = decodeShuffle(action.parameters[2]);
        if (!shuffleIndices) {
          return failure(
            'invalid_shuffle_permutation',
            actionIndex,
            '.parameters[2]',
            'shuffleBottomAndDraw requires a complete zero-based hand permutation'
          );
        }

        decoded.push({
          type: 'shuffleBottomAndDraw',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator,
          count,
          shuffleIndices,
        });
        break;
      }
      case 'viewDeck': {
        if (action.parameters.length !== 5) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'viewDeck requires [initiator, count, top, deckCount, targetIsOpponent]'
          );
        }

        const initiator = action.parameters[0];
        if (initiator !== 'self' && initiator !== 'opp') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            'viewDeck initiator must use the exported self/opp perspective'
          );
        }

        const count = action.parameters[1];
        if (typeof count !== 'number') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[1]',
            'viewDeck count must be a number'
          );
        }
        if (
          !Number.isSafeInteger(count) ||
          count < 0 ||
          count > MAX_DECK_CARDS
        ) {
          return failure(
            'invalid_view_count',
            actionIndex,
            '.parameters[1]',
            `viewDeck count must be an integer from 0 to ${MAX_DECK_CARDS}`
          );
        }

        const top = action.parameters[2];
        if (typeof top !== 'boolean') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[2]',
            'viewDeck top flag must be a boolean'
          );
        }

        const expectedDeckCount = action.parameters[3];
        if (typeof expectedDeckCount !== 'number') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[3]',
            'viewDeck recorded deck count must be a number'
          );
        }
        if (
          !Number.isSafeInteger(expectedDeckCount) ||
          expectedDeckCount < 0 ||
          expectedDeckCount > MAX_DECK_CARDS
        ) {
          return failure(
            'invalid_recorded_deck_count',
            actionIndex,
            '.parameters[3]',
            `viewDeck recorded deck count must be an integer from 0 to ${MAX_DECK_CARDS}`
          );
        }
        if (count > expectedDeckCount) {
          return failure(
            'invalid_view_count',
            actionIndex,
            '.parameters[1]',
            'viewDeck count cannot exceed its recorded deck count'
          );
        }

        const targetIsOpponent = action.parameters[4];
        if (typeof targetIsOpponent !== 'boolean') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[4]',
            'viewDeck target relationship must be a boolean'
          );
        }
        if (targetIsOpponent !== (action.user !== initiator)) {
          return failure(
            'invalid_view_target',
            actionIndex,
            '.parameters[4]',
            'viewDeck target relationship must match the exported target and initiator'
          );
        }

        decoded.push({
          type: 'viewDeck',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator,
          count,
          edge: top ? 'top' : 'bottom',
          expectedDeckCount,
          targetIsOpponent,
        });
        break;
      }
      case 'moveCardBundle': {
        if (action.parameters.length !== 6) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'moveCardBundle requires [initiator, sourceZone, destinationZone, sourceIndex, targetIndex, mode]'
          );
        }

        const mode = action.parameters[5];
        if (typeof mode !== 'string') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[5]',
            'moveCardBundle mode must be a string'
          );
        }
        if (mode !== 'bottom' && mode !== 'move') {
          return failure(
            'unsupported_move_card_bundle',
            actionIndex,
            '.parameters[5]',
            'Only source-authentic deck-bottom, loose-zone, stadium, new-play-stack, and targeted play-stack bundles are converted'
          );
        }

        const source = decodeCardSource(action, actionIndex, action.action, 3);
        if (!source.ok) return source.result;

        const destinationZone = action.parameters[2];
        if (typeof destinationZone !== 'string') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[2]',
            'moveCardBundle destination zone must be a string'
          );
        }
        if (mode === 'bottom') {
          if (destinationZone !== 'deck') {
            return failure(
              'invalid_destination_zone',
              actionIndex,
              '.parameters[2]',
              'A bottom-mode moveCardBundle must target deck'
            );
          }
          if (action.parameters[4] !== false) {
            return failure(
              'invalid_target_index',
              actionIndex,
              '.parameters[4]',
              'A bottom-mode moveCardBundle must not carry a target card index'
            );
          }

          decoded.push({
            type: 'moveCardBundle',
            recordIndex: actionIndex + 1,
            player: action.user,
            initiator: source.initiator,
            sourceZone: source.sourceZone,
            sourceIndex: source.sourceIndex,
            destinationZone: 'deck',
            targetIndex: false,
            mode: 'bottom',
          });
          break;
        }

        const targetIndex = action.parameters[4];
        if (typeof targetIndex === 'number') {
          if (
            !Number.isSafeInteger(targetIndex) ||
            targetIndex < 0 ||
            targetIndex >= MAX_DECK_CARDS
          ) {
            return failure(
              'invalid_target_index',
              actionIndex,
              '.parameters[4]',
              `A targeted moveCardBundle index must be an integer from 0 to ${MAX_DECK_CARDS - 1}`
            );
          }
          if (!isPlayDestinationZone(destinationZone)) {
            return failure(
              'invalid_destination_zone',
              actionIndex,
              '.parameters[2]',
              'A targeted moveCardBundle must target active or bench'
            );
          }

          decoded.push({
            type: 'moveCardBundle',
            recordIndex: actionIndex + 1,
            player: action.user,
            initiator: source.initiator,
            sourceZone: source.sourceZone,
            sourceIndex: source.sourceIndex,
            destinationZone,
            targetIndex,
            mode: 'move',
          });
          break;
        }

        if (targetIndex !== false && targetIndex !== null) {
          return failure(
            'invalid_target_index',
            actionIndex,
            '.parameters[4]',
            'A moveCardBundle target must be false, null, or a numeric active/bench card index'
          );
        }

        if (destinationZone === 'stadium') {
          decoded.push({
            type: 'moveCardBundle',
            recordIndex: actionIndex + 1,
            player: action.user,
            initiator: source.initiator,
            sourceZone: source.sourceZone,
            sourceIndex: source.sourceIndex,
            destinationZone,
            targetIndex,
            mode: 'move',
          });
          break;
        }

        if (isPlayDestinationZone(destinationZone)) {
          decoded.push({
            type: 'moveCardBundle',
            recordIndex: actionIndex + 1,
            player: action.user,
            initiator: source.initiator,
            sourceZone: source.sourceZone,
            sourceIndex: source.sourceIndex,
            destinationZone,
            targetIndex,
            mode: 'move',
          });
          break;
        }

        if (!isLooseDestinationZone(destinationZone)) {
          return failure(
            'invalid_destination_zone',
            actionIndex,
            '.parameters[2]',
            'A target-free moveCardBundle must target a supported zone'
          );
        }

        decoded.push({
          type: 'moveCardBundle',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator: source.initiator,
          sourceZone: source.sourceZone,
          sourceIndex: source.sourceIndex,
          destinationZone,
          targetIndex,
          mode: 'move',
        });
        break;
      }
      case 'leaveAll': {
        if (action.parameters.length !== 3) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'leaveAll requires [initiator, sourceZone, destinationSlot]'
          );
        }

        const initiator = action.parameters[0];
        if (initiator !== 'self' && initiator !== 'opp') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            'leaveAll initiator must use the exported self/opp perspective'
          );
        }
        if (action.parameters[1] !== 'attachedCards') {
          return failure(
            'invalid_source_zone',
            actionIndex,
            '.parameters[1]',
            'A directly exported leaveAll action must source attachedCards'
          );
        }
        const destinationSlot = action.parameters[2];
        if (
          typeof destinationSlot !== 'string' ||
          !isPlayDestinationZone(destinationSlot)
        ) {
          return failure(
            'invalid_destination_zone',
            actionIndex,
            '.parameters[2]',
            'A directly exported leaveAll action must target active or bench'
          );
        }

        decoded.push({
          type: 'leaveAll',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator,
          sourceZone: 'attachedCards',
          destinationSlot,
        });
        break;
      }
      case 'discardAll':
      case 'lostZoneAll':
      case 'handAll': {
        if (action.parameters.length !== 2) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            `${action.action} requires [initiator, sourceZone]`
          );
        }

        const initiator = action.parameters[0];
        if (initiator !== 'self' && initiator !== 'opp') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            `${action.action} initiator must use the exported self/opp perspective`
          );
        }
        const sourceZone = action.parameters[1];
        if (sourceZone !== 'attachedCards' && sourceZone !== 'viewCards') {
          return failure(
            'invalid_source_zone',
            actionIndex,
            '.parameters[1]',
            `The converted ${action.action} subset must source attachedCards or viewCards`
          );
        }

        decoded.push({
          type: action.action,
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator,
          sourceZone,
        });
        break;
      }
      case 'shuffleAll':
      case 'shuffleBottom': {
        if (action.parameters.length !== 3) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            `${action.action} requires [initiator, sourceZone, permutation]`
          );
        }

        const initiator = action.parameters[0];
        if (initiator !== 'self' && initiator !== 'opp') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            `${action.action} initiator must use the exported self/opp perspective`
          );
        }
        const sourceZone = action.parameters[1];
        if (sourceZone !== 'attachedCards' && sourceZone !== 'viewCards') {
          return failure(
            'invalid_source_zone',
            actionIndex,
            '.parameters[1]',
            `The converted ${action.action} subset must source attachedCards or viewCards`
          );
        }
        const shuffleIndices = decodeShuffle(action.parameters[2]);
        if (!shuffleIndices) {
          return failure(
            'invalid_shuffle_permutation',
            actionIndex,
            '.parameters[2]',
            `${action.action} requires a complete zero-based shuffle permutation`
          );
        }

        decoded.push({
          type: action.action,
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator,
          sourceZone,
          shuffleIndices,
        });
        break;
      }
      case 'shuffleZone': {
        if (action.parameters.length !== 4) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'shuffleZone requires [initiator, zone, indices, message]'
          );
        }

        const initiator = action.parameters[0];
        if (initiator !== 'self' && initiator !== 'opp') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            'shuffleZone initiator must use the exported self/opp perspective'
          );
        }
        if (action.parameters[1] !== 'prizes') {
          return failure(
            'invalid_shuffle_zone',
            actionIndex,
            '.parameters[1]',
            'A directly exported shuffleZone action must target prizes'
          );
        }
        const shuffleIndices = decodeShuffle(action.parameters[2]);
        if (!shuffleIndices) {
          return failure(
            'invalid_shuffle_permutation',
            actionIndex,
            '.parameters[2]',
            'shuffleZone requires a complete zero-based shuffle permutation'
          );
        }
        if (action.parameters[3] !== true) {
          return failure(
            'invalid_shuffle_message',
            actionIndex,
            '.parameters[3]',
            'A directly exported shuffleZone action must retain its message'
          );
        }

        decoded.push({
          type: 'shuffleZone',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator,
          zone: 'prizes',
          shuffleIndices,
          message: true,
        });
        break;
      }
      case 'moveToDeckTop': {
        if (action.parameters.length !== 3) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'moveToDeckTop requires [initiator, sourceZone, sourceIndex]'
          );
        }

        const source = decodeCardSource(action, actionIndex, action.action);
        if (!source.ok) return source.result;

        decoded.push({
          type: 'moveToDeckTop',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator: source.initiator,
          sourceZone: source.sourceZone,
          sourceIndex: source.sourceIndex,
        });
        break;
      }
      case 'shuffleIntoDeck': {
        if (action.parameters.length !== 4) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'shuffleIntoDeck requires [initiator, sourceZone, sourceIndex, indices]'
          );
        }

        const source = decodeCardSource(action, actionIndex, action.action);
        if (!source.ok) return source.result;
        const shuffleIndices = decodeShuffle(action.parameters[3]);
        if (!shuffleIndices) {
          return failure(
            'invalid_shuffle_permutation',
            actionIndex,
            '.parameters[3]',
            'shuffleIntoDeck requires a complete zero-based shuffle permutation'
          );
        }

        decoded.push({
          type: 'shuffleIntoDeck',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator: source.initiator,
          sourceZone: source.sourceZone,
          sourceIndex: source.sourceIndex,
          shuffleIndices,
        });
        break;
      }
      case 'switchWithDeckTop': {
        if (action.parameters.length !== 3) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'switchWithDeckTop requires [initiator, sourceZone, sourceIndex]'
          );
        }

        const source = decodeCardSource(action, actionIndex, action.action);
        if (!source.ok) return source.result;
        if (source.sourceZone === 'deck' || source.sourceZone === 'deckCover') {
          return failure(
            'invalid_source_zone',
            actionIndex,
            '.parameters[1]',
            'switchWithDeckTop is exported only for a source outside the deck'
          );
        }

        decoded.push({
          type: 'switchWithDeckTop',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator: source.initiator,
          sourceZone: source.sourceZone,
          sourceIndex: source.sourceIndex,
        });
        break;
      }
      case 'shufflePrizesToDeckBottom': {
        if (action.parameters.length !== 2) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'shufflePrizesToDeckBottom requires [initiator, indices]'
          );
        }

        const initiator = action.parameters[0];
        if (initiator !== 'self' && initiator !== 'opp') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            'shufflePrizesToDeckBottom initiator must use the exported self/opp perspective'
          );
        }
        const shuffleIndices = decodeShuffle(action.parameters[1]);
        if (!shuffleIndices || shuffleIndices.length === 0) {
          return failure(
            'invalid_shuffle_permutation',
            actionIndex,
            '.parameters[1]',
            'shufflePrizesToDeckBottom requires a non-empty complete zero-based shuffle permutation'
          );
        }

        decoded.push({
          type: 'shufflePrizesToDeckBottom',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator,
          shuffleIndices,
        });
        break;
      }
    }
  }

  return { ok: true, actions: decoded };
};
