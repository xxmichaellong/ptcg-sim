import { MAX_DECK_CARDS } from '@ptcgsim/game-core';

import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

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
    };

export type LegacyV1MovementDecodeIssueCode =
  | 'invalid_parameter_count'
  | 'invalid_parameter_type'
  | 'invalid_draw_count'
  | 'invalid_shuffle_zone'
  | 'invalid_shuffle_permutation'
  | 'invalid_shuffle_message';

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
  readonly action: 'draw' | 'shuffleZone';
} => action.action === 'draw' || action.action === 'shuffleZone';

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

/**
 * Decodes admitted movement tuples without applying them. This starts with the
 * source-bounded draw and direct prize-shuffle atoms; the remaining movement
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
    }
  }

  return { ok: true, actions: decoded };
};
