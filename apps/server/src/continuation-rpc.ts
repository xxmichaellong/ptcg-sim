import {
  parseContinuationCapability,
  type ContinuationRestoreResult,
} from './continuation-custody.js';
import { validContinuationRestoreOperationId } from './continuation-restore-format.js';

export interface ContinuationRestoreRpcInput {
  readonly capability: string;
  readonly operationId: string;
}

const exactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.every((key) => typeof key === 'string') &&
    JSON.stringify((keys as string[]).sort()) ===
      JSON.stringify([...expected].sort())
  );
};

export const readContinuationRestoreRpcInput = (
  value: unknown,
  expectedSaveId: string | undefined
): ContinuationRestoreRpcInput | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, ['capability', 'operationId'])
  ) {
    return undefined;
  }
  const capability = Reflect.get(value, 'capability');
  const operationId = Reflect.get(value, 'operationId');
  if (
    typeof capability !== 'string' ||
    typeof operationId !== 'string' ||
    !validContinuationRestoreOperationId(operationId)
  ) {
    return undefined;
  }
  const parsed = parseContinuationCapability(capability);
  if (!parsed || !expectedSaveId || parsed.saveId !== expectedSaveId) {
    return undefined;
  }
  return Object.freeze({ capability, operationId });
};

export type ContinuationRestoreRpcResult =
  ContinuationRestoreResult | undefined;
