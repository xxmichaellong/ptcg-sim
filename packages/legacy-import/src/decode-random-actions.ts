import { MAX_DECK_CARDS } from '@ptcgsim/game-core';

import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

export interface LegacyV1RandomAction {
  readonly type: 'playRandomCardFaceDown';
  readonly recordIndex: number;
  readonly player: LegacyExportUser;
  readonly initiator: LegacyExportUser;
  readonly randomIndex: number;
}

export type LegacyV1RandomActionDecodeIssueCode =
  'invalid_parameter_count' | 'invalid_parameter_type' | 'invalid_random_index';

export interface LegacyV1RandomActionDecodeIssue {
  readonly code: LegacyV1RandomActionDecodeIssueCode;
  readonly recordIndex: number;
  readonly path: string;
  readonly message: string;
}

export type LegacyV1RandomActionDecodeResult =
  | { readonly ok: true; readonly actions: readonly LegacyV1RandomAction[] }
  | {
      readonly ok: false;
      readonly issues: readonly LegacyV1RandomActionDecodeIssue[];
    };

const failure = (
  code: LegacyV1RandomActionDecodeIssueCode,
  actionIndex: number,
  suffix: string,
  message: string
): LegacyV1RandomActionDecodeResult => ({
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

const isRandomAction = (
  action: LegacyActionRecord
): action is LegacyActionRecord & {
  readonly action: 'playRandomCardFaceDown';
} => action.action === 'playRandomCardFaceDown';

/**
 * Decodes the resolved random hand index stored by V1. Conversion supplies the
 * value once to the canonical random adapter instead of sampling a new card.
 */
export const decodeLegacyV1RandomActions = (
  parsed: ParsedLegacyExport
): LegacyV1RandomActionDecodeResult => {
  const decoded: LegacyV1RandomAction[] = [];
  for (
    let actionIndex = 0;
    actionIndex < parsed.actions.length;
    actionIndex += 1
  ) {
    const action = parsed.actions[actionIndex]!;
    if (!isRandomAction(action)) continue;

    if (action.parameters.length !== 2) {
      return failure(
        'invalid_parameter_count',
        actionIndex,
        '.parameters',
        'playRandomCardFaceDown requires [initiator, randomIndex]'
      );
    }

    const initiator = action.parameters[0];
    if (initiator !== 'self' && initiator !== 'opp') {
      return failure(
        'invalid_parameter_type',
        actionIndex,
        '.parameters[0]',
        'playRandomCardFaceDown initiator must use the exported self/opp perspective'
      );
    }

    const randomIndex = action.parameters[1];
    if (typeof randomIndex !== 'number') {
      return failure(
        'invalid_parameter_type',
        actionIndex,
        '.parameters[1]',
        'playRandomCardFaceDown random index must be a number'
      );
    }
    if (
      !Number.isSafeInteger(randomIndex) ||
      randomIndex < 0 ||
      randomIndex >= MAX_DECK_CARDS
    ) {
      return failure(
        'invalid_random_index',
        actionIndex,
        '.parameters[1]',
        `playRandomCardFaceDown random index must be an integer from 0 to ${MAX_DECK_CARDS - 1}`
      );
    }

    decoded.push({
      type: 'playRandomCardFaceDown',
      recordIndex: actionIndex + 1,
      player: action.user,
      initiator,
      randomIndex,
    });
  }
  return { ok: true, actions: decoded };
};
