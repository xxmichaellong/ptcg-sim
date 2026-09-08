import { MAX_DECK_CARDS } from '@ptcgsim/game-core';

import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

export type LegacyV1AbilityMarkerZone =
  'active' | 'bench' | 'discard' | 'stadium';

export type LegacyV1MarkerAction =
  | {
      readonly type: 'VSTARGXFunction';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly marker: 'gx' | 'vstar';
    }
  | {
      readonly type: 'useAbility';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
      readonly zone: LegacyV1AbilityMarkerZone;
      readonly sourceIndex: number;
    }
  | {
      readonly type: 'removeAbilityCounter';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly zone: LegacyV1AbilityMarkerZone;
      readonly sourceIndex: number;
    };

export type LegacyV1MarkerActionDecodeIssueCode =
  | 'invalid_parameter_count'
  | 'invalid_parameter_type'
  | 'invalid_once_per_game_marker'
  | 'invalid_marker_zone'
  | 'invalid_card_index';

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
): action is LegacyActionRecord & {
  readonly action: 'VSTARGXFunction' | 'useAbility' | 'removeAbilityCounter';
} =>
  action.action === 'VSTARGXFunction' ||
  action.action === 'useAbility' ||
  action.action === 'removeAbilityCounter';

const abilityMarkerZones = new Set<string>([
  'active',
  'bench',
  'discard',
  'stadium',
]);

const isAbilityMarkerZone = (
  value: string
): value is LegacyV1AbilityMarkerZone => abilityMarkerZones.has(value);

/**
 * Decodes V1's independent GX/VSTAR button toggle and ability marker records
 * without applying them. Toggle records store no result boolean, so conversion
 * derives each explicit target from the preceding candidate state.
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
    switch (action.action) {
      case 'VSTARGXFunction': {
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
        break;
      }
      case 'useAbility':
      case 'removeAbilityCounter': {
        const expectedParameterCount = action.action === 'useAbility' ? 3 : 2;
        if (action.parameters.length !== expectedParameterCount) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            action.action === 'useAbility'
              ? 'useAbility requires [initiator, zone, index]'
              : 'removeAbilityCounter requires [zone, index]'
          );
        }

        const zoneParameter = action.action === 'useAbility' ? 1 : 0;
        if (action.action === 'useAbility') {
          const initiator = action.parameters[0];
          if (initiator !== 'self' && initiator !== 'opp') {
            return failure(
              'invalid_parameter_type',
              actionIndex,
              '.parameters[0]',
              'useAbility initiator must use the exported self/opp perspective'
            );
          }
        }

        const zone = action.parameters[zoneParameter];
        if (typeof zone !== 'string') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            `.parameters[${zoneParameter}]`,
            `${action.action} zone must be a string`
          );
        }
        if (!isAbilityMarkerZone(zone)) {
          return failure(
            'invalid_marker_zone',
            actionIndex,
            `.parameters[${zoneParameter}]`,
            `${action.action} must target active, bench, discard, or stadium`
          );
        }

        const indexParameter = zoneParameter + 1;
        const sourceIndex = action.parameters[indexParameter];
        if (typeof sourceIndex !== 'number') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            `.parameters[${indexParameter}]`,
            `${action.action} card index must be a number`
          );
        }
        if (
          !Number.isSafeInteger(sourceIndex) ||
          sourceIndex < 0 ||
          sourceIndex >= MAX_DECK_CARDS
        ) {
          return failure(
            'invalid_card_index',
            actionIndex,
            `.parameters[${indexParameter}]`,
            `${action.action} card index must be an integer from 0 to ${MAX_DECK_CARDS - 1}`
          );
        }

        decoded.push(
          action.action === 'useAbility'
            ? {
                type: 'useAbility',
                recordIndex: actionIndex + 1,
                player: action.user,
                initiator: action.parameters[0] as LegacyExportUser,
                zone,
                sourceIndex,
              }
            : {
                type: 'removeAbilityCounter',
                recordIndex: actionIndex + 1,
                player: action.user,
                zone,
                sourceIndex,
              }
        );
        break;
      }
    }
  }
  return { ok: true, actions: decoded };
};
