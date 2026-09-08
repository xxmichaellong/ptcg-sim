import { MAX_DECK_CARDS } from '@ptcgsim/game-core';

import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

export type LegacyV1MovementAction = {
  readonly type: 'draw';
  readonly recordIndex: number;
  readonly player: LegacyExportUser;
  readonly initiator: LegacyExportUser;
  readonly count: number;
};

export type LegacyV1MovementDecodeIssueCode =
  'invalid_parameter_count' | 'invalid_parameter_type' | 'invalid_draw_count';

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

const isDrawAction = (
  action: LegacyActionRecord
): action is LegacyActionRecord & { readonly action: 'draw' } =>
  action.action === 'draw';

/**
 * Decodes admitted movement tuples without applying them. This starts with the
 * source-bounded draw atom; the remaining movement actions stay untouched
 * until their positional and state-dependent behavior is frozen separately.
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
    if (!isDrawAction(action)) continue;

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
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_DECK_CARDS) {
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
  }

  return { ok: true, actions: decoded };
};
