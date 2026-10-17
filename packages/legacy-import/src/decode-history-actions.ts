import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

export interface LegacyV1HistoryAction {
  readonly type: 'undo';
  readonly recordIndex: number;
  readonly player: LegacyExportUser;
}

export type LegacyV1HistoryActionDecodeIssueCode =
  'invalid_parameter_count' | 'invalid_parameter_type';

export interface LegacyV1HistoryActionDecodeIssue {
  readonly code: LegacyV1HistoryActionDecodeIssueCode;
  readonly recordIndex: number;
  readonly path: string;
  readonly message: string;
}

export type LegacyV1HistoryActionDecodeResult =
  | { readonly ok: true; readonly actions: readonly LegacyV1HistoryAction[] }
  | {
      readonly ok: false;
      readonly issues: readonly LegacyV1HistoryActionDecodeIssue[];
    };

const isHistoryAction = (
  action: LegacyActionRecord
): action is LegacyActionRecord & { readonly action: 'undo' } =>
  action.action === 'undo';

/**
 * V1's local undo wrapper exports its original undefined history argument.
 * JSON serialization turns that single array entry into null. The mutable
 * replay list built inside undoAsync never escapes into a native save.
 */
export const decodeLegacyV1HistoryActions = (
  parsed: ParsedLegacyExport
): LegacyV1HistoryActionDecodeResult => {
  const decoded: LegacyV1HistoryAction[] = [];
  for (
    let actionIndex = 0;
    actionIndex < parsed.actions.length;
    actionIndex += 1
  ) {
    const action = parsed.actions[actionIndex]!;
    if (!isHistoryAction(action)) continue;

    if (action.parameters.length !== 1) {
      return {
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_count',
            recordIndex: actionIndex + 1,
            path: `$[${actionIndex + 1}].parameters`,
            message: 'undo requires one serialized history placeholder',
          },
        ],
      };
    }
    if (action.parameters[0] !== null) {
      return {
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_type',
            recordIndex: actionIndex + 1,
            path: `$[${actionIndex + 1}].parameters[0]`,
            message: 'undo history placeholder must be null',
          },
        ],
      };
    }

    decoded.push({
      type: 'undo',
      recordIndex: actionIndex + 1,
      player: action.user,
    });
  }
  return { ok: true, actions: decoded };
};
