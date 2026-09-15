import {
  asCardInstanceId,
  asInspectionId,
  asStackId,
  asWorkAreaId,
  type CommandContext,
} from '@ptcgsim/game-core';

export type LegacyV1ResolvedOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'shuffle'; readonly indices: readonly number[] }
  | { readonly kind: 'randomInt'; readonly value: number };

export type LegacyV1ImportContextErrorCode =
  | 'invalid_record_index'
  | 'action_context_finished'
  | 'missing_resolved_outcome'
  | 'unexpected_resolved_outcome'
  | 'resolved_outcome_reused'
  | 'resolved_outcome_not_consumed'
  | 'invalid_resolved_shuffle'
  | 'invalid_resolved_random_int';

export class LegacyV1ImportContextError extends Error {
  readonly code: LegacyV1ImportContextErrorCode;
  readonly recordIndex: number;

  constructor(
    code: LegacyV1ImportContextErrorCode,
    recordIndex: number,
    message: string
  ) {
    super(message);
    this.name = 'LegacyV1ImportContextError';
    this.code = code;
    this.recordIndex = recordIndex;
  }
}

export interface LegacyV1ActionCommandContext {
  readonly commandContext: CommandContext;
  readonly finish: () => void;
}

export interface LegacyV1ImportContext {
  readonly forAction: (
    recordIndex: number,
    outcome?: LegacyV1ResolvedOutcome
  ) => LegacyV1ActionCommandContext;
}

const ordinal = (value: number): string => String(value).padStart(6, '0');

/**
 * Creates one identity registry for an entire import attempt. A fresh registry
 * makes a retry byte-deterministic, while sharing it across all actions keeps
 * IDs unique when game-core copy indices restart for the opponent deck.
 */
export const createLegacyV1ImportContext = (): LegacyV1ImportContext => {
  let nextCard = 0;
  let nextStack = 0;
  let nextInspection = 0;
  let nextWorkArea = 0;

  return {
    forAction: (recordIndex, suppliedOutcome = { kind: 'none' }) => {
      if (!Number.isSafeInteger(recordIndex) || recordIndex <= 0) {
        throw new LegacyV1ImportContextError(
          'invalid_record_index',
          recordIndex,
          'Legacy import action record indices must be positive safe integers'
        );
      }

      const outcome: LegacyV1ResolvedOutcome =
        suppliedOutcome.kind === 'shuffle'
          ? { kind: 'shuffle', indices: [...suppliedOutcome.indices] }
          : suppliedOutcome.kind === 'randomInt'
            ? { kind: 'randomInt', value: suppliedOutcome.value }
            : { kind: 'none' };
      let outcomeConsumed = false;
      let finished = false;

      const fail = (
        code: LegacyV1ImportContextErrorCode,
        message: string
      ): never => {
        finished = true;
        throw new LegacyV1ImportContextError(code, recordIndex, message);
      };

      const requireOpen = (): void => {
        if (finished) {
          throw new LegacyV1ImportContextError(
            'action_context_finished',
            recordIndex,
            'Legacy import action context is already finished'
          );
        }
      };

      const consume = (
        expected: Exclude<LegacyV1ResolvedOutcome['kind'], 'none'>
      ): LegacyV1ResolvedOutcome => {
        requireOpen();
        if (outcomeConsumed) {
          return fail(
            'resolved_outcome_reused',
            'A resolved legacy outcome can be consumed only once'
          );
        }
        if (outcome.kind === 'none') {
          return fail(
            'missing_resolved_outcome',
            'Legacy import cannot invent a missing random outcome'
          );
        }
        if (outcome.kind !== expected) {
          return fail(
            'unexpected_resolved_outcome',
            'Legacy resolved outcome does not match the requested operation'
          );
        }
        outcomeConsumed = true;
        return outcome;
      };

      const commandContext: CommandContext = {
        nextCardId: () => {
          requireOpen();
          return asCardInstanceId(`legacy:v1:card:${ordinal(nextCard++)}`);
        },
        nextStackId: () => {
          requireOpen();
          return asStackId(`legacy:v1:stack:${ordinal(nextStack++)}`);
        },
        nextInspectionId: () => {
          requireOpen();
          return asInspectionId(
            `legacy:v1:inspection:${ordinal(nextInspection++)}`
          );
        },
        nextWorkAreaId: () => {
          requireOpen();
          return asWorkAreaId(`legacy:v1:work-area:${ordinal(nextWorkArea++)}`);
        },
        shuffle: <Value>(values: readonly Value[]): readonly Value[] => {
          const resolved = consume('shuffle');
          if (resolved.kind !== 'shuffle') {
            return fail(
              'unexpected_resolved_outcome',
              'Legacy shuffle outcome is unavailable'
            );
          }
          const { indices } = resolved;
          if (
            indices.length !== values.length ||
            indices.some(
              (index) =>
                !Number.isSafeInteger(index) ||
                index < 0 ||
                index >= values.length
            ) ||
            new Set(indices).size !== indices.length
          ) {
            return fail(
              'invalid_resolved_shuffle',
              'Legacy shuffle outcome is not a complete permutation for this action'
            );
          }
          return indices.map((index) => values[index]!);
        },
        randomInt: (exclusiveMaximum) => {
          const resolved = consume('randomInt');
          if (resolved.kind !== 'randomInt') {
            return fail(
              'unexpected_resolved_outcome',
              'Legacy integer outcome is unavailable'
            );
          }
          if (
            !Number.isSafeInteger(exclusiveMaximum) ||
            exclusiveMaximum <= 0 ||
            !Number.isSafeInteger(resolved.value) ||
            resolved.value < 0 ||
            resolved.value >= exclusiveMaximum
          ) {
            return fail(
              'invalid_resolved_random_int',
              'Legacy integer outcome is outside the requested range'
            );
          }
          return resolved.value;
        },
      };

      return {
        commandContext,
        finish: () => {
          requireOpen();
          finished = true;
          if (outcome.kind !== 'none' && !outcomeConsumed) {
            throw new LegacyV1ImportContextError(
              'resolved_outcome_not_consumed',
              recordIndex,
              'Legacy action did not consume its recorded random outcome'
            );
          }
        },
      };
    },
  };
};
