import { describe, expect, it } from 'vitest';

import {
  createContinuationCapability,
  parseContinuationCapability,
} from './continuation-custody.js';
import { readContinuationRestoreRpcInput } from './continuation-rpc.js';

describe('continuation internal RPC codec', () => {
  it('accepts only an exact capability-bound restore request', () => {
    const capability = createContinuationCapability().capability;
    const saveId = parseContinuationCapability(capability)!.saveId;
    const operationId = 'R'.repeat(43);

    expect(
      readContinuationRestoreRpcInput({ capability, operationId }, saveId)
    ).toEqual({ capability, operationId });
    expect(
      readContinuationRestoreRpcInput(
        { capability, operationId },
        'A'.repeat(22)
      )
    ).toBeUndefined();
    expect(
      readContinuationRestoreRpcInput({ capability, operationId }, undefined)
    ).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { capability: 'bad', operationId: 'R'.repeat(43) },
    { capability: createContinuationCapability().capability, operationId: 'x' },
    {
      capability: createContinuationCapability().capability,
      operationId: 'R'.repeat(43),
      extra: true,
    },
  ])('rejects malformed or extended request %#', (value) => {
    expect(
      readContinuationRestoreRpcInput(value, 'A'.repeat(22))
    ).toBeUndefined();
  });
});
