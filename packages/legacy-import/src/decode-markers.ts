import { MAX_DECK_CARDS } from '@ptcgsim/game-core';

import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

export type LegacyV1AbilityMarkerZone =
  'active' | 'bench' | 'discard' | 'stadium';

export type LegacyV1DamageMarkerZone = 'active' | 'bench';

export type LegacyV1SpecialConditionMarkerZone = 'active';

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
    }
  | {
      readonly type: 'addDamageCounter';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly zone: LegacyV1DamageMarkerZone;
      readonly sourceIndex: number;
      readonly damage: number;
    }
  | {
      readonly type: 'updateDamageCounter';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly zone: LegacyV1DamageMarkerZone;
      readonly sourceIndex: number;
      readonly damage: number | null;
    }
  | {
      readonly type: 'removeDamageCounter';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly zone: LegacyV1DamageMarkerZone;
      readonly sourceIndex: number;
    }
  | {
      readonly type: 'addSpecialCondition';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly zone: LegacyV1SpecialConditionMarkerZone;
      readonly sourceIndex: number;
      readonly condition: string;
    }
  | {
      readonly type: 'updateSpecialCondition';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly zone: LegacyV1SpecialConditionMarkerZone;
      readonly sourceIndex: number;
      readonly condition: string | null;
    }
  | {
      readonly type: 'removeSpecialCondition';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly zone: LegacyV1SpecialConditionMarkerZone;
      readonly sourceIndex: number;
    };

export type LegacyV1MarkerActionDecodeIssueCode =
  | 'invalid_parameter_count'
  | 'invalid_parameter_type'
  | 'invalid_once_per_game_marker'
  | 'invalid_marker_zone'
  | 'invalid_card_index'
  | 'invalid_damage_value'
  | 'invalid_condition_value';

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
  readonly action:
    | 'VSTARGXFunction'
    | 'useAbility'
    | 'removeAbilityCounter'
    | 'addDamageCounter'
    | 'updateDamageCounter'
    | 'removeDamageCounter'
    | 'addSpecialCondition'
    | 'updateSpecialCondition'
    | 'removeSpecialCondition';
} =>
  action.action === 'VSTARGXFunction' ||
  action.action === 'useAbility' ||
  action.action === 'removeAbilityCounter' ||
  action.action === 'addDamageCounter' ||
  action.action === 'updateDamageCounter' ||
  action.action === 'removeDamageCounter' ||
  action.action === 'addSpecialCondition' ||
  action.action === 'updateSpecialCondition' ||
  action.action === 'removeSpecialCondition';

const abilityMarkerZones = new Set<string>([
  'active',
  'bench',
  'discard',
  'stadium',
]);

const isAbilityMarkerZone = (
  value: string
): value is LegacyV1AbilityMarkerZone => abilityMarkerZones.has(value);

const isDamageMarkerZone = (value: string): value is LegacyV1DamageMarkerZone =>
  value === 'active' || value === 'bench';

const parseDamageValue = (value: string): number | null | undefined => {
  const normalized = value.trim();
  if (normalized === '') return null;
  if (normalized.length > 16 || !/^-?\d+$/.test(normalized)) return undefined;
  const damage = Number(normalized);
  if (!Number.isSafeInteger(damage) || damage > 9_990) return undefined;
  return damage <= 0 ? null : damage;
};

const parseSpecialConditionValue = (
  value: string
): string | null | undefined => {
  const normalized = value.trim();
  if (normalized === '' || normalized === '0') return null;
  return normalized.length <= 16 ? normalized : undefined;
};

/**
 * Decodes V1's independent GX/VSTAR button toggle and card-marker records
 * without applying them. Toggle records store no result boolean, and repeated
 * marker records can be state no-ops, so conversion derives explicit targets
 * from the preceding candidate state.
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
      case 'addDamageCounter':
      case 'updateDamageCounter':
      case 'removeDamageCounter': {
        const hasDamageValue = action.action !== 'removeDamageCounter';
        const expectedParameterCount = hasDamageValue ? 3 : 2;
        if (action.parameters.length !== expectedParameterCount) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            hasDamageValue
              ? `${action.action} requires [zone, index, damage]`
              : 'removeDamageCounter requires [zone, index]'
          );
        }

        const zone = action.parameters[0];
        if (typeof zone !== 'string') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            `${action.action} zone must be a string`
          );
        }
        if (!isDamageMarkerZone(zone)) {
          return failure(
            'invalid_marker_zone',
            actionIndex,
            '.parameters[0]',
            `${action.action} must target active or bench`
          );
        }

        const sourceIndex = action.parameters[1];
        if (typeof sourceIndex !== 'number') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[1]',
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
            '.parameters[1]',
            `${action.action} card index must be an integer from 0 to ${MAX_DECK_CARDS - 1}`
          );
        }

        if (action.action === 'removeDamageCounter') {
          decoded.push({
            type: action.action,
            recordIndex: actionIndex + 1,
            player: action.user,
            zone,
            sourceIndex,
          });
          break;
        }

        const rawDamage = action.parameters[2];
        let damage: number | null | undefined;
        if (action.action === 'addDamageCounter' && rawDamage === null) {
          damage = 10;
        } else {
          if (typeof rawDamage !== 'string') {
            return failure(
              'invalid_parameter_type',
              actionIndex,
              '.parameters[2]',
              `${action.action} damage must be a string or the saved null default`
            );
          }
          damage = parseDamageValue(rawDamage);
        }
        if (damage === undefined) {
          return failure(
            'invalid_damage_value',
            actionIndex,
            '.parameters[2]',
            action.action === 'addDamageCounter'
              ? 'addDamageCounter damage must resolve to an integer from 1 to 9990'
              : 'updateDamageCounter damage must resolve to null or an integer from 1 to 9990'
          );
        }

        if (action.action === 'addDamageCounter') {
          if (damage === null) {
            return failure(
              'invalid_damage_value',
              actionIndex,
              '.parameters[2]',
              'addDamageCounter damage must resolve to an integer from 1 to 9990'
            );
          }
          decoded.push({
            type: action.action,
            recordIndex: actionIndex + 1,
            player: action.user,
            zone,
            sourceIndex,
            damage,
          });
        } else {
          decoded.push({
            type: action.action,
            recordIndex: actionIndex + 1,
            player: action.user,
            zone,
            sourceIndex,
            damage,
          });
        }
        break;
      }
      case 'addSpecialCondition':
      case 'updateSpecialCondition':
      case 'removeSpecialCondition': {
        const hasConditionValue = action.action === 'updateSpecialCondition';
        const expectedParameterCount = hasConditionValue ? 3 : 2;
        if (action.parameters.length !== expectedParameterCount) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            hasConditionValue
              ? 'updateSpecialCondition requires [zone, index, condition]'
              : `${action.action} requires [zone, index]`
          );
        }

        const zone = action.parameters[0];
        if (typeof zone !== 'string') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            `${action.action} zone must be a string`
          );
        }
        if (zone !== 'active') {
          return failure(
            'invalid_marker_zone',
            actionIndex,
            '.parameters[0]',
            `${action.action} must target active`
          );
        }

        const sourceIndex = action.parameters[1];
        if (typeof sourceIndex !== 'number') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[1]',
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
            '.parameters[1]',
            `${action.action} card index must be an integer from 0 to ${MAX_DECK_CARDS - 1}`
          );
        }

        if (action.action !== 'updateSpecialCondition') {
          decoded.push(
            action.action === 'addSpecialCondition'
              ? {
                  type: action.action,
                  recordIndex: actionIndex + 1,
                  player: action.user,
                  zone,
                  sourceIndex,
                  condition: 'P',
                }
              : {
                  type: action.action,
                  recordIndex: actionIndex + 1,
                  player: action.user,
                  zone,
                  sourceIndex,
                }
          );
          break;
        }

        const rawCondition = action.parameters[2];
        if (typeof rawCondition !== 'string') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[2]',
            'updateSpecialCondition condition must be a string'
          );
        }
        const condition = parseSpecialConditionValue(rawCondition);
        if (condition === undefined) {
          return failure(
            'invalid_condition_value',
            actionIndex,
            '.parameters[2]',
            'updateSpecialCondition condition must normalize to null or at most 16 characters'
          );
        }
        decoded.push({
          type: action.action,
          recordIndex: actionIndex + 1,
          player: action.user,
          zone,
          sourceIndex,
          condition,
        });
        break;
      }
    }
  }
  return { ok: true, actions: decoded };
};
