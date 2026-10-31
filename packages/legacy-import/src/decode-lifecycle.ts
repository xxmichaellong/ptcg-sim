import type {
  LegacyActionRecord,
  LegacyDeckData,
  LegacyExportUser,
  LegacyJsonValue,
  ParsedLegacyExport,
} from './parse-export.js';

export const MAX_LEGACY_SETUP_CARDS = 200;

export type LegacyV1LifecycleAction =
  | {
      readonly type: 'loadDeckData';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly deck: LegacyDeckData;
    }
  | {
      readonly type: 'reset';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly clean: boolean;
      readonly build: boolean;
      readonly invalidMessage: boolean;
    }
  | {
      readonly type: 'setup';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly shuffleIndices: readonly number[];
    }
  | {
      readonly type: 'takeTurn';
      readonly recordIndex: number;
      readonly player: LegacyExportUser;
      readonly initiator: LegacyExportUser;
    };

export type LegacyV1LifecycleDecodeIssueCode =
  | 'unexpected_deck_bootstrap'
  | 'invalid_parameter_count'
  | 'invalid_parameter_type'
  | 'invalid_shuffle_permutation'
  | 'invalid_export_perspective';

export interface LegacyV1LifecycleDecodeIssue {
  readonly code: LegacyV1LifecycleDecodeIssueCode;
  readonly recordIndex: number;
  readonly path: string;
  readonly message: string;
}

export type LegacyV1LifecycleDecodeResult =
  | {
      readonly ok: true;
      readonly actions: readonly LegacyV1LifecycleAction[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly LegacyV1LifecycleDecodeIssue[];
    };

const failure = (
  code: LegacyV1LifecycleDecodeIssueCode,
  actionIndex: number,
  suffix: string,
  message: string
): LegacyV1LifecycleDecodeResult => ({
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

const isBooleanTuple = (
  values: readonly LegacyJsonValue[]
): values is readonly [boolean, boolean, boolean] =>
  values.length === 3 && values.every((value) => typeof value === 'boolean');

const decodeShuffle = (
  value: LegacyJsonValue | undefined
): readonly number[] | null => {
  if (
    !Array.isArray(value) ||
    value.length > MAX_LEGACY_SETUP_CARDS ||
    !value.every(
      (index) =>
        typeof index === 'number' &&
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < value.length
    ) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return value as number[];
};

const isLifecycleAction = (
  action: LegacyActionRecord
): action is LegacyActionRecord & {
  readonly action: 'loadDeckData' | 'reset' | 'setup' | 'takeTurn';
} =>
  action.action === 'loadDeckData' ||
  action.action === 'reset' ||
  action.action === 'setup' ||
  action.action === 'takeTurn';

/**
 * Decodes the first frozen positional action family without applying it. Other
 * allowlisted action families stay untouched for later versioned decoders.
 */
export const decodeLegacyV1LifecycleActions = (
  parsed: ParsedLegacyExport
): LegacyV1LifecycleDecodeResult => {
  const decoded: LegacyV1LifecycleAction[] = [];
  for (
    let actionIndex = 0;
    actionIndex < parsed.actions.length;
    actionIndex += 1
  ) {
    const action = parsed.actions[actionIndex]!;
    if (!isLifecycleAction(action)) continue;
    switch (action.action) {
      case 'loadDeckData': {
        if (actionIndex > 1) {
          return failure(
            'unexpected_deck_bootstrap',
            actionIndex,
            '.action',
            'loadDeckData is valid only in the two leading bootstrap records'
          );
        }
        decoded.push({
          type: 'loadDeckData',
          recordIndex: actionIndex + 1,
          player: action.user,
          deck: actionIndex === 0 ? parsed.selfDeck : parsed.opponentDeck,
        });
        break;
      }
      case 'reset': {
        if (!isBooleanTuple(action.parameters)) {
          return failure(
            action.parameters.length === 3
              ? 'invalid_parameter_type'
              : 'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'reset requires [clean, build, invalidMessage] booleans'
          );
        }
        const [clean, build, invalidMessage] = action.parameters;
        decoded.push({
          type: 'reset',
          recordIndex: actionIndex + 1,
          player: action.user,
          clean,
          build,
          invalidMessage,
        });
        break;
      }
      case 'setup': {
        if (action.parameters.length !== 1) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'setup requires one resolved shuffle permutation'
          );
        }
        const shuffleIndices = decodeShuffle(action.parameters[0]);
        if (!shuffleIndices) {
          return failure(
            'invalid_shuffle_permutation',
            actionIndex,
            '.parameters[0]',
            'setup requires a complete zero-based shuffle permutation'
          );
        }
        decoded.push({
          type: 'setup',
          recordIndex: actionIndex + 1,
          player: action.user,
          shuffleIndices,
        });
        break;
      }
      case 'takeTurn': {
        if (action.parameters.length !== 1) {
          return failure(
            'invalid_parameter_count',
            actionIndex,
            '.parameters',
            'takeTurn requires one exported initiator'
          );
        }
        const initiator = action.parameters[0];
        if (initiator !== 'self' && initiator !== 'opp') {
          return failure(
            'invalid_parameter_type',
            actionIndex,
            '.parameters[0]',
            'takeTurn initiator must use the exported self/opp perspective'
          );
        }
        if (initiator !== action.user) {
          return failure(
            'invalid_export_perspective',
            actionIndex,
            '.parameters[0]',
            'takeTurn initiator does not match the exported action owner'
          );
        }
        decoded.push({
          type: 'takeTurn',
          recordIndex: actionIndex + 1,
          player: action.user,
          initiator,
        });
        break;
      }
    }
  }
  return { ok: true, actions: decoded };
};
