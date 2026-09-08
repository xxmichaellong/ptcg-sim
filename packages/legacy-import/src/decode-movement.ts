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

export type LegacyV1MovementAction =
  | {
      readonly type: 'draw';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly count: number;
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
    };

export type LegacyV1MovementDecodeIssueCode =
  | 'invalid_parameter_count'
  | 'invalid_parameter_type'
  | 'invalid_draw_count'
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

const isMovementAction = (
  action: LegacyActionRecord
): action is LegacyActionRecord & {
  readonly action:
    | 'draw'
    | 'shuffleZone'
    | 'moveToDeckTop'
    | 'shuffleIntoDeck'
    | 'switchWithDeckTop';
} =>
  action.action === 'draw' ||
  action.action === 'shuffleZone' ||
  action.action === 'moveToDeckTop' ||
  action.action === 'shuffleIntoDeck' ||
  action.action === 'switchWithDeckTop';

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
  actionName: 'moveToDeckTop' | 'shuffleIntoDeck' | 'switchWithDeckTop'
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

  const sourceIndex = action.parameters[2];
  if (typeof sourceIndex !== 'number') {
    return {
      ok: false,
      result: failure(
        'invalid_parameter_type',
        actionIndex,
        '.parameters[2]',
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
        '.parameters[2]',
        `${actionName} source index must be an integer from 0 to ${MAX_DECK_CARDS - 1}, and deckCover always selects index 0`
      ),
    };
  }

  return { ok: true, initiator, sourceZone, sourceIndex };
};

/**
 * Decodes admitted movement tuples without applying them. This starts with the
 * source-bounded draw, direct prize-shuffle, move-to-deck-top,
 * shuffle-into-deck, and switch-with-deck-top atoms; the remaining movement
 * actions stay untouched until their positional and state-dependent behavior
 * is frozen separately.
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
    }
  }

  return { ok: true, actions: decoded };
};
