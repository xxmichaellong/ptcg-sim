import { MAX_DECK_CARDS } from '@ptcgsim/game-core';

import type {
  LegacyActionRecord,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

export type LegacyV1RotationZone = 'active' | 'bench' | 'stadium';

export type LegacyV1CardAnnotationZone =
  | LegacyV1RotationZone
  | 'deck'
  | 'hand'
  | 'prizes'
  | 'discard'
  | 'lostZone'
  | 'board'
  | 'attachedCards'
  | 'viewCards';

export type LegacyV1CardCategory = 'Pokémon' | 'Trainer' | 'Energy';

export interface LegacyV1RotateCardAction {
  readonly type: 'rotateCard';
  readonly recordIndex: number;
  readonly player: LegacyExportUser;
  readonly zone: LegacyV1RotationZone;
  readonly sourceIndex: number;
  readonly single: boolean;
}

export interface LegacyV1ChangeTypeAction {
  readonly type: 'changeType';
  readonly recordIndex: number;
  readonly player: LegacyExportUser;
  readonly initiator: LegacyExportUser;
  readonly zone: LegacyV1CardAnnotationZone;
  readonly sourceIndex: number;
  readonly category: LegacyV1CardCategory;
}

export type LegacyV1CardAnnotationAction =
  LegacyV1RotateCardAction | LegacyV1ChangeTypeAction;

export type LegacyV1CardAnnotationDecodeIssueCode =
  | 'invalid_parameter_count'
  | 'invalid_parameter_type'
  | 'invalid_annotation_zone'
  | 'invalid_rotation_zone'
  | 'invalid_card_index'
  | 'invalid_rotation_mode'
  | 'invalid_card_category';

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
): action is LegacyActionRecord & {
  readonly action: 'rotateCard' | 'changeType';
} => action.action === 'rotateCard' || action.action === 'changeType';

const isRotationZone = (value: string): value is LegacyV1RotationZone =>
  value === 'active' || value === 'bench' || value === 'stadium';

const annotationZones = new Set<string>([
  'deck',
  'hand',
  'prizes',
  'discard',
  'lostZone',
  'board',
  'active',
  'bench',
  'attachedCards',
  'viewCards',
  'stadium',
]);

const isCardAnnotationZone = (
  value: string
): value is LegacyV1CardAnnotationZone => annotationZones.has(value);

const isCardCategory = (value: string): value is LegacyV1CardCategory =>
  value === 'Pokémon' || value === 'Trainer' || value === 'Energy';

/**
 * Decodes V1's exported card-annotation gestures without applying DOM
 * mutations. Rotation exposes group mode in play and stadium plus single/BREAK
 * mode in play. Category changes accept only containers reachable from a real
 * selected card, deliberately excluding the zone-cover aliases.
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

    if (action.action === 'changeType') {
      if (action.parameters.length !== 4) {
        return failure(
          'invalid_parameter_count',
          actionIndex,
          '.parameters',
          'changeType requires [initiator, zone, index, category]'
        );
      }

      const initiator = action.parameters[0];
      if (initiator !== 'self' && initiator !== 'opp') {
        return failure(
          'invalid_parameter_type',
          actionIndex,
          '.parameters[0]',
          'changeType initiator must use the exported self/opp perspective'
        );
      }

      const zone = action.parameters[1];
      if (typeof zone !== 'string') {
        return failure(
          'invalid_parameter_type',
          actionIndex,
          '.parameters[1]',
          'changeType zone must be a string'
        );
      }
      if (!isCardAnnotationZone(zone)) {
        return failure(
          'invalid_annotation_zone',
          actionIndex,
          '.parameters[1]',
          'changeType must target a source-selectable card container'
        );
      }

      const sourceIndex = action.parameters[2];
      if (typeof sourceIndex !== 'number') {
        return failure(
          'invalid_parameter_type',
          actionIndex,
          '.parameters[2]',
          'changeType card index must be a number'
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
          '.parameters[2]',
          `changeType card index must be an integer from 0 to ${MAX_DECK_CARDS - 1}`
        );
      }

      const category = action.parameters[3];
      if (typeof category !== 'string') {
        return failure(
          'invalid_parameter_type',
          actionIndex,
          '.parameters[3]',
          'changeType category must be a string'
        );
      }
      if (!isCardCategory(category)) {
        return failure(
          'invalid_card_category',
          actionIndex,
          '.parameters[3]',
          'changeType category must be Pokémon, Trainer, or Energy'
        );
      }

      decoded.push({
        type: 'changeType',
        recordIndex: actionIndex + 1,
        player: action.user,
        initiator,
        zone,
        sourceIndex,
        category,
      });
      continue;
    }

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
