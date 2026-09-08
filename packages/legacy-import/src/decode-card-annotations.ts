import { MAX_DECK_CARDS } from '@ptcgsim/game-core';

import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

export type LegacyV1RotationZone = 'active' | 'bench' | 'stadium';

export interface LegacyV1RotateCardAction {
  readonly type: 'rotateCard';
  readonly recordIndex: number;
  readonly player: LegacyExportUser;
  readonly zone: LegacyV1RotationZone;
  readonly sourceIndex: number;
  readonly single: boolean;
}

export type LegacyV1CardAnnotationAction = LegacyV1RotateCardAction;

export type LegacyV1CardAnnotationDecodeIssueCode =
  | 'invalid_parameter_count'
  | 'invalid_parameter_type'
  | 'invalid_rotation_zone'
  | 'invalid_card_index'
  | 'invalid_rotation_mode';

export interface LegacyV1CardAnnotationDecodeIssue {
  readonly code: LegacyV1CardAnnotationDecodeIssueCode;
  readonly recordIndex: number;
  readonly path: string;
  readonly message: string;
}

export type LegacyV1CardAnnotationDecodeResult =
  | {
      readonly ok: true;
      readonly actions: readonly LegacyV1CardAnnotationAction[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly LegacyV1CardAnnotationDecodeIssue[];
    };

const failure = (
  code: LegacyV1CardAnnotationDecodeIssueCode,
  actionIndex: number,
  suffix: string,
  message: string
): LegacyV1CardAnnotationDecodeResult => ({
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

const isCardAnnotationAction = (
  action: LegacyActionRecord
): action is LegacyActionRecord & { readonly action: 'rotateCard' } =>
  action.action === 'rotateCard';

const isRotationZone = (value: string): value is LegacyV1RotationZone =>
  value === 'active' || value === 'bench' || value === 'stadium';

/**
 * Decodes V1's exported rotation gesture without applying its DOM mutations.
 * The shipped keyboard path exposes group rotation in play and card rotation
 * in stadium, while its single/BREAK form is reachable only in play.
 */
export const decodeLegacyV1CardAnnotationActions = (
  parsed: ParsedLegacyExport
): LegacyV1CardAnnotationDecodeResult => {
  const decoded: LegacyV1CardAnnotationAction[] = [];
  for (
    let actionIndex = 0;
    actionIndex < parsed.actions.length;
    actionIndex += 1
  ) {
    const action = parsed.actions[actionIndex]!;
    if (!isCardAnnotationAction(action)) continue;

    if (action.parameters.length !== 3) {
      return failure(
        'invalid_parameter_count',
        actionIndex,
        '.parameters',
        'rotateCard requires [zone, index, single]'
      );
    }

    const zone = action.parameters[0];
    if (typeof zone !== 'string') {
      return failure(
        'invalid_parameter_type',
        actionIndex,
        '.parameters[0]',
        'rotateCard zone must be a string'
      );
    }
    if (!isRotationZone(zone)) {
      return failure(
        'invalid_rotation_zone',
        actionIndex,
        '.parameters[0]',
        'rotateCard must target active, bench, or stadium'
      );
    }

    const sourceIndex = action.parameters[1];
    if (typeof sourceIndex !== 'number') {
      return failure(
        'invalid_parameter_type',
        actionIndex,
        '.parameters[1]',
        'rotateCard card index must be a number'
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
        `rotateCard card index must be an integer from 0 to ${MAX_DECK_CARDS - 1}`
      );
    }

    const single = action.parameters[2];
    if (typeof single !== 'boolean') {
      return failure(
        'invalid_parameter_type',
        actionIndex,
        '.parameters[2]',
        'rotateCard single mode must be a boolean'
      );
    }
    if (zone === 'stadium' && single) {
      return failure(
        'invalid_rotation_mode',
        actionIndex,
        '.parameters[2]',
        'rotateCard single mode is only source-accessible in active or bench'
      );
    }

    decoded.push({
      type: 'rotateCard',
      recordIndex: actionIndex + 1,
      player: action.user,
      zone,
      sourceIndex,
      single,
    });
  }

  return { ok: true, actions: decoded };
};
