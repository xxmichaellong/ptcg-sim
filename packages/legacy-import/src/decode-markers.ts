import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

export interface LegacyV1MarkerAction {
  readonly type: 'VSTARGXFunction';
  readonly recordIndex: number;
  readonly player: LegacyExportUser;
  readonly marker: 'gx' | 'vstar';
}

export type LegacyV1MarkerActionDecodeIssueCode =
  | 'invalid_parameter_count'
  | 'invalid_parameter_type'
  | 'invalid_once_per_game_marker';

export interface LegacyV1MarkerActionDecodeIssue {
  readonly code: LegacyV1MarkerActionDecodeIssueCode;
  readonly recordIndex: number;
  readonly path: string;
  readonly message: string;
}

export type LegacyV1MarkerActionDecodeResult =
  | {
      readonly ok: true;
      readonly actions: readonly LegacyV1MarkerAction[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly LegacyV1MarkerActionDecodeIssue[];
    };

const failure = (
  code: LegacyV1MarkerActionDecodeIssueCode,
  actionIndex: number,
  suffix: string,
  message: string
): LegacyV1MarkerActionDecodeResult => ({
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

const isMarkerAction = (
  action: LegacyActionRecord
): action is LegacyActionRecord & { readonly action: 'VSTARGXFunction' } =>
  action.action === 'VSTARGXFunction';

/**
 * Decodes V1's independent GX/VSTAR button toggle without applying it. The
 * source stores the marker kind but not the resulting boolean, so conversion
 * derives that explicit target from the preceding candidate state.
 */
export const decodeLegacyV1MarkerActions = (
  parsed: ParsedLegacyExport
): LegacyV1MarkerActionDecodeResult => {
  const decoded: LegacyV1MarkerAction[] = [];
  for (
    let actionIndex = 0;
    actionIndex < parsed.actions.length;
    actionIndex += 1
  ) {
    const action = parsed.actions[actionIndex]!;
    if (!isMarkerAction(action)) continue;
    if (action.parameters.length !== 1) {
      return failure(
        'invalid_parameter_count',
        actionIndex,
        '.parameters',
        'VSTARGXFunction requires [marker]'
      );
    }

    const marker = action.parameters[0];
    if (typeof marker !== 'string') {
      return failure(
        'invalid_parameter_type',
        actionIndex,
        '.parameters[0]',
        'VSTARGXFunction marker must be a string'
      );
    }
    if (marker !== 'GX' && marker !== 'VSTAR') {
      return failure(
        'invalid_once_per_game_marker',
        actionIndex,
        '.parameters[0]',
        'VSTARGXFunction marker must be GX or VSTAR'
      );
    }

    decoded.push({
      type: 'VSTARGXFunction',
      recordIndex: actionIndex + 1,
      player: action.user,
      marker: marker === 'GX' ? 'gx' : 'vstar',
    });
  }
  return { ok: true, actions: decoded };
};
