import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

export interface LegacyV1TableAction {
  readonly type: 'attack' | 'pass';
  readonly recordIndex: number;
  readonly player: LegacyExportUser;
}

export type LegacyV1TableActionDecodeIssueCode = 'invalid_parameter_count';

export interface LegacyV1TableActionDecodeIssue {
  readonly code: LegacyV1TableActionDecodeIssueCode;
  readonly recordIndex: number;
  readonly path: string;
  readonly message: string;
}

export type LegacyV1TableActionDecodeResult =
  | {
      readonly ok: true;
      readonly actions: readonly LegacyV1TableAction[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly LegacyV1TableActionDecodeIssue[];
    };

const isTableAction = (
  action: LegacyActionRecord
): action is LegacyActionRecord & { readonly action: 'attack' | 'pass' } =>
  action.action === 'attack' || action.action === 'pass';

/**
 * Decodes V1's parameterless attack/pass timeline records without applying
 * them. Their board cleanup and marker-reset semantics remain one canonical
 * table command rather than being reconstructed from mutable helper calls.
 */
export const decodeLegacyV1TableActions = (
  parsed: ParsedLegacyExport
): LegacyV1TableActionDecodeResult => {
  const decoded: LegacyV1TableAction[] = [];
  for (
    let actionIndex = 0;
    actionIndex < parsed.actions.length;
    actionIndex += 1
  ) {
    const action = parsed.actions[actionIndex]!;
    if (!isTableAction(action)) continue;
    if (action.parameters.length !== 0) {
      return {
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_count',
            recordIndex: actionIndex + 1,
            path: `$[${actionIndex + 1}].parameters`,
            message: `${action.action} requires an empty parameter list`,
          },
        ],
      };
    }
    decoded.push({
      type: action.action,
      recordIndex: actionIndex + 1,
      player: action.user,
    });
  }
  return { ok: true, actions: decoded };
};
