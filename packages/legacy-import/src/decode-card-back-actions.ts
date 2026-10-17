import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/game-core';

import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

export interface LegacyV1CardBackAction {
  readonly type: 'changeCardBack';
  readonly recordIndex: number;
  readonly player: LegacyExportUser;
  readonly sourceUrl: string;
}

export type LegacyV1CardBackActionDecodeIssueCode =
  | 'invalid_parameter_count'
  | 'invalid_parameter_type'
  | 'invalid_card_back_url';

export interface LegacyV1CardBackActionDecodeIssue {
  readonly code: LegacyV1CardBackActionDecodeIssueCode;
  readonly recordIndex: number;
  readonly path: string;
  readonly message: string;
}

export type LegacyV1CardBackActionDecodeResult =
  | {
      readonly ok: true;
      readonly actions: readonly LegacyV1CardBackAction[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly LegacyV1CardBackActionDecodeIssue[];
    };

const isCardBackAction = (
  action: LegacyActionRecord
): action is LegacyActionRecord & { readonly action: 'changeCardBack' } =>
  action.action === 'changeCardBack';

const failure = (
  code: LegacyV1CardBackActionDecodeIssueCode,
  actionIndex: number,
  suffix: string,
  message: string
): LegacyV1CardBackActionDecodeResult => ({
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

/**
 * Validates and retains V1's saved custom-card-back URL for an ordered
 * canonical PlayerCardBackSet transition. The importer never fetches it.
 */
export const decodeLegacyV1CardBackActions = (
  parsed: ParsedLegacyExport
): LegacyV1CardBackActionDecodeResult => {
  const decoded: LegacyV1CardBackAction[] = [];
  for (
    let actionIndex = 0;
    actionIndex < parsed.actions.length;
    actionIndex += 1
  ) {
    const action = parsed.actions[actionIndex]!;
    if (!isCardBackAction(action)) continue;
    if (action.parameters.length !== 1) {
      return failure(
        'invalid_parameter_count',
        actionIndex,
        '.parameters',
        'changeCardBack requires one source URL'
      );
    }
    const sourceUrl = action.parameters[0];
    if (typeof sourceUrl !== 'string') {
      return failure(
        'invalid_parameter_type',
        actionIndex,
        '.parameters[0]',
        'changeCardBack source URL must be a string'
      );
    }
    if (sourceUrl.length === 0 || sourceUrl.length > MAX_IMAGE_URL_CODE_UNITS) {
      return failure(
        'invalid_card_back_url',
        actionIndex,
        '.parameters[0]',
        `changeCardBack source URL must contain 1 to ${MAX_IMAGE_URL_CODE_UNITS} code units`
      );
    }

    decoded.push({
      type: 'changeCardBack',
      recordIndex: actionIndex + 1,
      player: action.user,
      sourceUrl,
    });
  }
  return { ok: true, actions: decoded };
};
