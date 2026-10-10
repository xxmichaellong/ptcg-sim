import { serializeContinuationHandoffText } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { RemoteContinuationPort } from './RemoteContinuationCustody.js';
import {
  RemoteRoomRestorationCustody,
  RemoteRoomRestorationError,
} from './RemoteRoomRestoration.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

const now = 2_000_000_000_000;
const saveId = 'S'.repeat(22);
const capability = `ptcgsave.v1.${saveId}.${'B'.repeat(43)}`;
const operationId = 'R'.repeat(43);
const targetRoomCode = 'BCDEFGHJ2345';
const requesterSeatCapability =
  'restored-requester-seat-capability-private-0000001';
const opponentInvitation = 'restored-opponent-invitation-private-0000000001';

const handoff = (expiresAt = now + 86_400_000) =>
  serializeContinuationHandoffText({
    format: 'ptcgsim-continuation-handoff-v1',
    saveId,
    capability,
    expiresAt,
  });

const response = () => ({
  format: 'ptcgsim-continuation-restore-result-v1' as const,
  saveId,
  operationId,
  completedAt: now + 1_000,
  targetRoomCode,
  requesterSeatCapability,
  opponentInvitation: {
    invitation: opponentInvitation,
    expiresAt: now + 61_000,
  },
});

const port = () => ({
  create: vi.fn(async (): Promise<never> => {
    throw new Error('not used');
  }),
  restore: vi.fn(async () => response()),
  revoke: vi.fn(async () => undefined),
});

const result = (label: string) => {
  const dispose = vi.fn();
  const runtime = {
    label,
    dispose,
    session: {
      getSnapshot: () => ({ phase: 'ready', role: 'player' }),
      subscribe: () => () => undefined,
    },
  } as unknown as RemoteRoomRuntime;
  return {
    value: {
      runtime,
      route: {
        kind: 'remote-room' as const,
        runtime,
        rendererKind: 'dom' as const,
      },
    },
    dispose,
  };
};

describe('remote room restoration custody', () => {
  it('installs the target and ordinary opponent invitation before returning it', async () => {
    const adapter = port();
    const target = result('restored');
    const bootstrap = vi.fn(async () => target.value);
    const deliverOpponentInvitation = vi.fn(async () => undefined);
    const restoration = new RemoteRoomRestorationCustody(handoff(), {
      port: adapter,
      createOperationId: () => operationId,
      now: () => now,
      bootstrap,
    });

    await expect(
      restoration.restore({
        buildId: 'test-build',
        displayName: 'Blue',
        rendererKind: 'dom',
        deliverOpponentInvitation,
      })
    ).resolves.toBe(target.value);
    expect(bootstrap).toHaveBeenCalledWith({
      buildId: 'test-build',
      roomCode: targetRoomCode,
      displayName: 'Blue',
      requestedRole: 'player',
      capability: requesterSeatCapability,
      rendererKind: 'dom',
      signal: expect.any(AbortSignal),
    });
    expect(deliverOpponentInvitation).toHaveBeenCalledWith(
      expect.stringContaining('PTCGSIM2-INVITE:')
    );
    expect(adapter.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ capability })
    );
    expect(target.dispose).not.toHaveBeenCalled();
    expect(JSON.stringify(restoration)).not.toContain(capability);
    expect(JSON.stringify(restoration)).not.toContain(opponentInvitation);
  });

  it('disposes a partial target and retries the exact completed operation', async () => {
    const adapter = port();
    const first = result('first');
    const second = result('second');
    const bootstrap = vi
      .fn()
      .mockResolvedValueOnce(first.value)
      .mockResolvedValueOnce(second.value);
    const deliverOpponentInvitation = vi
      .fn()
      .mockRejectedValueOnce(new Error(opponentInvitation))
      .mockResolvedValueOnce(undefined);
    const restoration = new RemoteRoomRestorationCustody(handoff(), {
      port: adapter,
      createOperationId: () => operationId,
      now: () => now,
      bootstrap,
    });

    await expect(
      restoration.restore({
        buildId: 'test-build',
        displayName: 'Blue',
        rendererKind: 'dom',
        deliverOpponentInvitation,
      })
    ).rejects.toMatchObject({ code: 'installation_failed' });
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(restoration.matchesHandoff(handoff())).toBe(true);

    await expect(
      restoration.restore({
        buildId: 'test-build',
        displayName: 'Blue',
        rendererKind: 'dom',
        deliverOpponentInvitation,
      })
    ).resolves.toBe(second.value);
    expect(
      adapter.restore.mock.calls.map(([input]) => input.operationId)
    ).toEqual([operationId, operationId]);
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it('does not deliver or replace until the restored player session is ready', async () => {
    const adapter = port();
    const listeners = new Set<() => void>();
    let state = { phase: 'connecting', role: undefined } as {
      phase: 'connecting' | 'ready';
      role: 'player' | undefined;
    };
    const dispose = vi.fn();
    const runtime = {
      dispose,
      session: {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    } as unknown as RemoteRoomRuntime;
    const target = {
      runtime,
      route: {
        kind: 'remote-room' as const,
        runtime,
        rendererKind: 'dom' as const,
      },
    };
    const deliverOpponentInvitation = vi.fn(async () => undefined);
    const restoration = new RemoteRoomRestorationCustody(handoff(), {
      port: adapter,
      createOperationId: () => operationId,
      now: () => now,
      bootstrap: vi.fn(async () => target),
    });
    const pending = restoration.restore({
      buildId: 'test-build',
      displayName: 'Blue',
      rendererKind: 'dom',
      deliverOpponentInvitation,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(deliverOpponentInvitation).not.toHaveBeenCalled();
    expect(listeners.size).toBe(1);

    state = { phase: 'ready', role: 'player' };
    for (const listener of listeners) listener();
    await expect(pending).resolves.toBe(target);
    expect(deliverOpponentInvitation).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('rejects malformed, expired, and implausibly future handoffs', () => {
    for (const text of [
      'not a save',
      handoff(now),
      handoff(now + 31 * 24 * 60 * 60_000),
    ]) {
      expect(
        () =>
          new RemoteRoomRestorationCustody(text, {
            port: port() as RemoteContinuationPort,
            createOperationId: () => operationId,
            now: () => now,
          })
      ).toThrow(RemoteRoomRestorationError);
    }
  });
});
