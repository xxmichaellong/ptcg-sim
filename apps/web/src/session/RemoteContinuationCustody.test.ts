import { describe, expect, it, vi } from 'vitest';

import {
  RemoteContinuationTransportError,
  type RemoteContinuationCreationInput,
  type RemoteContinuationRestoreInput,
  type RemoteContinuationRevocationInput,
} from './RemoteContinuationTransport.js';
import {
  RemoteContinuationCustody,
  RemoteContinuationCustodyError,
  type RemoteContinuationPort,
} from './RemoteContinuationCustody.js';

const roomCode = 'ABCDEFGH2345';
const saveId = 'S'.repeat(22);
const createOperationId = 'C'.repeat(43);
const restoreOperationId = 'R'.repeat(43);
const resumeToken = 'resume-custody-capability-private-000000000000001';
const capability = `ptcgsave.v1.${saveId}.${'B'.repeat(43)}`;
const requesterSeatCapability =
  'restored-requester-seat-capability-private-0000001';
const opponentInvitation = 'restored-opponent-invitation-private-0000000001';

const creation = () => ({
  format: 'ptcgsim-continuation-creation-result-v1' as const,
  saveId,
  operationId: createOperationId,
  capability,
  createdAt: 2_000_000_000_000,
  expiresAt: 2_000_086_400_000,
});

const restore = () => ({
  format: 'ptcgsim-continuation-restore-result-v1' as const,
  saveId,
  operationId: restoreOperationId,
  completedAt: 2_000_000_001_000,
  targetRoomCode: 'BCDEFGHJ2345',
  requesterSeatCapability,
  opponentInvitation: {
    invitation: opponentInvitation,
    expiresAt: 2_000_000_061_000,
  },
});

const port = (overrides: Partial<RemoteContinuationPort> = {}) => ({
  create: vi.fn(async () => creation()),
  restore: vi.fn(async () => restore()),
  revoke: vi.fn(async () => undefined),
  ...overrides,
});

const operationIds = () => {
  const values = [createOperationId, restoreOperationId];
  return vi.fn(() => values.shift() ?? 'X'.repeat(43));
};
const adoptedOperationId = () => restoreOperationId;

describe('remote continuation private custody', () => {
  it('retains one pending create while its owner is not ready', async () => {
    let ready = false;
    const adapter = port();
    const custody = new RemoteContinuationCustody({
      port: adapter,
      source: { roomCode, resumeToken },
      createOperationId: operationIds(),
      canCreate: () => ready,
    });

    await expect(custody.create()).rejects.toMatchObject({
      code: 'invalid_state',
    });
    expect(adapter.create).not.toHaveBeenCalled();
    expect(custody.getSnapshot()).toEqual({ phase: 'pending' });

    ready = true;
    await expect(custody.create()).resolves.toMatchObject({
      phase: 'available',
      saveId,
    });
    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: createOperationId, resumeToken })
    );
  });

  it('reuses one create operation across failure and exposes only safe metadata', async () => {
    const create = vi
      .fn<
        (
          input: RemoteContinuationCreationInput
        ) => Promise<ReturnType<typeof creation>>
      >()
      .mockRejectedValueOnce(
        new RemoteContinuationTransportError('request_failed')
      )
      .mockResolvedValueOnce(creation());
    const adapter = port({ create });
    const custody = new RemoteContinuationCustody({
      port: adapter,
      source: { roomCode: roomCode.toLowerCase(), resumeToken },
      createOperationId: operationIds(),
    });

    expect(custody.getSnapshot()).toEqual({ phase: 'pending' });
    expect(JSON.stringify(custody)).toBe('{}');
    await expect(custody.create()).rejects.toMatchObject({
      code: 'request_failed',
    });
    await expect(custody.create()).resolves.toEqual({
      phase: 'available',
      saveId,
      createdAt: creation().createdAt,
      expiresAt: creation().expiresAt,
    });
    await expect(custody.create()).resolves.toEqual(custody.getSnapshot());
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([input]) => input.operationId)).toEqual([
      createOperationId,
      createOperationId,
    ]);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      roomCode,
      resumeToken,
    });
    expect(JSON.stringify(custody.getSnapshot())).not.toContain(resumeToken);
    expect(JSON.stringify(custody.getSnapshot())).not.toContain(capability);
  });

  it('retries one created capability until its trusted handoff succeeds', async () => {
    const adapter = port();
    const custody = new RemoteContinuationCustody({
      port: adapter,
      source: { roomCode, resumeToken },
      createOperationId: operationIds(),
    });
    const install = vi
      .fn()
      .mockRejectedValueOnce(new Error(capability))
      .mockResolvedValueOnce(undefined);

    await expect(custody.handoffCreated(install)).rejects.toMatchObject({
      code: 'installation_failed',
    });
    expect(custody.getSnapshot()).toMatchObject({ phase: 'available', saveId });
    await expect(custody.handoffCreated(install)).resolves.toMatchObject({
      phase: 'available',
      saveId,
    });
    expect(adapter.create).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledTimes(2);
    expect(install.mock.calls[0]?.[0]).toEqual(creation());
    expect(Object.isFrozen(install.mock.calls[0]?.[0])).toBe(true);
    expect(JSON.stringify(custody)).not.toContain(capability);
  });

  it('serializes work, aborts disposal, and revokes a late create result best-effort', async () => {
    let finish: ((value: ReturnType<typeof creation>) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    const create = vi.fn(
      async (input: RemoteContinuationCreationInput) =>
        new Promise<ReturnType<typeof creation>>((resolve) => {
          requestSignal = input.signal;
          finish = resolve;
        })
    );
    const revoke = vi.fn(
      async (_input: RemoteContinuationRevocationInput) => undefined
    );
    const custody = new RemoteContinuationCustody({
      port: port({ create, revoke }),
      source: { roomCode, resumeToken },
      createOperationId: operationIds(),
    });
    const pending = custody.create();

    await expect(custody.create()).rejects.toMatchObject({
      code: 'operation_in_progress',
    });
    custody.dispose();
    expect(requestSignal?.aborted).toBe(true);
    finish?.(creation());
    await expect(pending).rejects.toMatchObject({ code: 'disposed' });
    expect(revoke).toHaveBeenCalledWith({ capability });
    expect(custody.getSnapshot()).toEqual({ phase: 'disposed' });
    expect(JSON.stringify(custody)).toBe('{}');
  });

  it('retries the same completed restore until an atomic installer succeeds', async () => {
    const restoreRequest = vi.fn(
      async (_input: RemoteContinuationRestoreInput) => restore()
    );
    const adapter = port({ restore: restoreRequest });
    const custody = new RemoteContinuationCustody({
      port: adapter,
      capability,
      createOperationId: adoptedOperationId,
    });
    const install = vi
      .fn()
      .mockRejectedValueOnce(new Error(requesterSeatCapability))
      .mockResolvedValueOnce(undefined);

    let firstError: unknown;
    try {
      await custody.restore(install);
    } catch (error) {
      firstError = error;
    }
    expect(firstError).toBeInstanceOf(RemoteContinuationCustodyError);
    expect(firstError).toMatchObject({ code: 'installation_failed' });
    expect(String(firstError)).not.toContain(requesterSeatCapability);
    expect(custody.getSnapshot()).toEqual({ phase: 'available', saveId });

    await expect(custody.restore(install)).resolves.toEqual({
      phase: 'restored',
      saveId,
      targetRoomCode: restore().targetRoomCode,
      completedAt: restore().completedAt,
      opponentInvitationExpiresAt: restore().opponentInvitation.expiresAt,
    });
    expect(restoreRequest).toHaveBeenCalledTimes(2);
    expect(
      restoreRequest.mock.calls.map(([input]) => input.operationId)
    ).toEqual([restoreOperationId, restoreOperationId]);
    expect(install).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(install.mock.calls[1]?.[0])).toBe(true);
    expect(Object.isFrozen(install.mock.calls[1]?.[0].opponentInvitation)).toBe(
      true
    );
    const serialized = JSON.stringify(custody.getSnapshot());
    expect(serialized).not.toContain(capability);
    expect(serialized).not.toContain(requesterSeatCapability);
    expect(serialized).not.toContain(opponentInvitation);
  });

  it('aborts a disposed restore before installation and removes its late receipt best-effort', async () => {
    let finish: ((value: ReturnType<typeof restore>) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    const restoreRequest = vi.fn(
      async (input: RemoteContinuationRestoreInput) =>
        new Promise<ReturnType<typeof restore>>((resolve) => {
          requestSignal = input.signal;
          finish = resolve;
        })
    );
    const revoke = vi.fn(
      async (_input: RemoteContinuationRevocationInput) => undefined
    );
    const custody = new RemoteContinuationCustody({
      port: port({ restore: restoreRequest, revoke }),
      capability,
      createOperationId: adoptedOperationId,
    });
    const install = vi.fn(async () => undefined);
    const pending = custody.restore(install);

    custody.dispose();
    expect(requestSignal?.aborted).toBe(true);
    finish?.(restore());
    await expect(pending).rejects.toMatchObject({ code: 'disposed' });
    expect(install).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith({ capability });
    expect(custody.getSnapshot()).toEqual({ phase: 'disposed' });
  });

  it('revokes available or completed custody and clears every local credential', async () => {
    for (const shouldRestore of [false, true]) {
      const adapter = port();
      const custody = new RemoteContinuationCustody({
        port: adapter,
        capability,
        createOperationId: adoptedOperationId,
      });
      if (shouldRestore) await custody.restore(async () => undefined);

      await expect(custody.revoke()).resolves.toEqual({ phase: 'revoked' });
      expect(adapter.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ capability })
      );
      expect(JSON.stringify(custody)).toBe('{}');
      await expect(custody.revoke()).rejects.toMatchObject({
        code: 'invalid_state',
      });
    }
  });

  it('rejects malformed construction, generated operations, and port results', async () => {
    for (const options of [
      { port: port() },
      { port: port(), source: { roomCode: 'bad', resumeToken } },
      { port: port(), capability: 'bad' },
      {
        port: port(),
        source: { roomCode, resumeToken },
        capability,
      },
    ]) {
      expect(() => new RemoteContinuationCustody(options)).toThrow(
        RemoteContinuationCustodyError
      );
    }

    const malformedCreate = new RemoteContinuationCustody({
      port: port({
        create: vi.fn(async () => ({
          ...creation(),
          operationId: 'X'.repeat(43),
        })),
      }),
      source: { roomCode, resumeToken },
      createOperationId: operationIds(),
    });
    await expect(malformedCreate.create()).rejects.toMatchObject({
      code: 'invalid_response',
    });

    const malformedOperation = new RemoteContinuationCustody({
      port: port(),
      capability,
      createOperationId: () => 'bad',
    });
    await expect(
      malformedOperation.restore(async () => undefined)
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('follows an owner abort and does not expose credentials in normalized errors', async () => {
    const owner = new AbortController();
    const custody = new RemoteContinuationCustody({
      port: port(),
      capability,
      signal: owner.signal,
      createOperationId: operationIds(),
    });
    owner.abort();

    expect(custody.getSnapshot()).toEqual({ phase: 'disposed' });
    await expect(custody.restore(async () => undefined)).rejects.toMatchObject({
      code: 'disposed',
    });
    expect(
      String(new RemoteContinuationCustodyError('disposed'))
    ).not.toContain(capability);

    const call = new AbortController();
    call.abort();
    const adapter = port();
    const available = new RemoteContinuationCustody({
      port: adapter,
      capability,
      createOperationId: adoptedOperationId,
    });
    await expect(
      available.restore(async () => undefined, call.signal)
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(adapter.restore).not.toHaveBeenCalled();
    expect(available.getSnapshot()).toEqual({ phase: 'available', saveId });

    const inFlightCall = new AbortController();
    const create = vi.fn(
      async (input: RemoteContinuationCreationInput) =>
        new Promise<ReturnType<typeof creation>>((_resolve, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => reject(new Error(resumeToken)),
            { once: true }
          );
        })
    );
    const pending = new RemoteContinuationCustody({
      port: port({ create }),
      source: { roomCode, resumeToken },
      createOperationId: operationIds(),
    });
    const request = pending.create(inFlightCall.signal);
    inFlightCall.abort();
    await expect(request).rejects.toMatchObject({ code: 'cancelled' });
    expect(pending.getSnapshot()).toEqual({ phase: 'pending' });
  });
});
