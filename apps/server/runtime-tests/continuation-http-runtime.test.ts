import { env, exports } from 'cloudflare:workers';
import {
  parseContinuationCreationResponse,
  parseContinuationRestoreResponse,
  parseRoomAdmissionTicketResponse,
} from '@ptcgsim/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RUNTIME_ORIGIN,
  connect,
  createRoom,
  helloFrame,
  issuePlayerTicket,
  nextServerMessage,
} from './runtime-harness.js';

const openSockets = new Set<WebSocket>();

const postJson = (
  path: string,
  body: Record<string, unknown>,
  address: string
): Promise<Response> =>
  exports.default.fetch(
    new Request(`${RUNTIME_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': address,
        'Content-Type': 'application/json',
        Origin: RUNTIME_ORIGIN,
      },
      body: JSON.stringify(body),
    })
  );

const deleteJson = (
  path: string,
  body: Record<string, unknown>,
  address: string
): Promise<Response> =>
  exports.default.fetch(
    new Request(`${RUNTIME_ORIGIN}${path}`, {
      method: 'DELETE',
      headers: {
        'CF-Connecting-IP': address,
        'Content-Type': 'application/json',
        Origin: RUNTIME_ORIGIN,
      },
      body: JSON.stringify(body),
    })
  );

const exchangePlayerCapability = async (
  roomCode: string,
  capability: string,
  displayName: string
) => {
  const response = await postJson(
    `/v2/rooms/${roomCode}/admission-tickets`,
    { capability, displayName, requestedRole: 'player' },
    '198.51.100.90'
  );
  const parsed = parseRoomAdmissionTicketResponse(await response.json());
  expect(response.status).toBe(201);
  expect(parsed.ok).toBe(true);
  return parsed;
};

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const socket of openSockets) socket.close(1000, 'Test complete');
  openSockets.clear();
});

describe('activated continuation HTTP runtime', () => {
  it('creates, exactly retries, restores, and hands off both rotated player credentials', async () => {
    const source = await createRoom();
    const ticket = await issuePlayerTicket(source, 'one', 'Blue');
    const socket = await connect(source);
    openSockets.add(socket);
    const welcomePromise = nextServerMessage(socket);
    socket.send(helloFrame(source, ticket, 'Blue'));
    const welcome = await welcomePromise;
    expect(welcome.type).toBe('Welcome');

    const createOperationId = 'H'.repeat(43);
    const createInput = {
      resumeToken: ticket.resumeToken,
      operationId: createOperationId,
    };
    const createdResponse = await postJson(
      `/v2/rooms/${source.roomCode}/continuations`,
      createInput,
      '198.51.100.41'
    );
    const createdBody: unknown = await createdResponse.json();
    const created = parseContinuationCreationResponse(createdBody);
    expect(createdResponse.status).toBe(201);
    expect(createdResponse.headers.get('Cache-Control')).toContain('no-store');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('expected continuation creation');
    expect(created.value.operationId).toBe(createOperationId);
    expect(created.value.capability).not.toContain(ticket.resumeToken);

    const createRetry = await postJson(
      `/v2/rooms/${source.roomCode}/continuations`,
      createInput,
      '198.51.100.41'
    );
    expect(createRetry.status).toBe(201);
    expect(await createRetry.json()).toEqual(created.value);

    const revocableCreate = await postJson(
      `/v2/rooms/${source.roomCode}/continuations`,
      { ...createInput, operationId: 'L'.repeat(43) },
      '198.51.100.45'
    );
    const revocable = parseContinuationCreationResponse(
      await revocableCreate.json()
    );
    expect(revocableCreate.status).toBe(201);
    expect(revocable.ok).toBe(true);
    if (!revocable.ok) throw new Error('expected revocable continuation');
    const revoked = await deleteJson(
      `/v2/continuations/${revocable.value.saveId}`,
      { capability: revocable.value.capability },
      '198.51.100.46'
    );
    const revokedRetry = await deleteJson(
      `/v2/continuations/${revocable.value.saveId}`,
      { capability: revocable.value.capability },
      '198.51.100.46'
    );
    expect(revoked.status).toBe(204);
    expect(revokedRetry.status).toBe(204);
    expect(revoked.headers.get('Cache-Control')).toContain('no-store');
    const revokedRestore = await postJson(
      `/v2/continuations/${revocable.value.saveId}/restore`,
      {
        capability: revocable.value.capability,
        operationId: 'M'.repeat(43),
      },
      '198.51.100.47'
    );
    expect(revokedRestore.status).toBe(404);
    expect(await revokedRestore.json()).toEqual({
      error: 'continuation_unavailable',
    });

    const wrongBearer = await postJson(
      `/v2/rooms/${source.roomCode}/continuations`,
      {
        resumeToken: 'wrong-resume-capability-never-reflected-00000001',
        operationId: 'I'.repeat(43),
      },
      '198.51.100.42'
    );
    expect(wrongBearer.status).toBe(403);
    expect(await wrongBearer.json()).toEqual({
      error: 'continuation_rejected',
    });

    const restoreOperationId = 'J'.repeat(43);
    const restoreInput = {
      capability: created.value.capability,
      operationId: restoreOperationId,
    };
    const restoredResponse = await postJson(
      `/v2/continuations/${created.value.saveId}/restore`,
      restoreInput,
      '198.51.100.43'
    );
    const restoredBody: unknown = await restoredResponse.json();
    const restored = parseContinuationRestoreResponse(restoredBody);
    expect(restoredResponse.status).toBe(201);
    expect(restoredResponse.headers.get('Cache-Control')).toContain('no-store');
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error('expected continuation restore');
    expect(restored.value.operationId).toBe(restoreOperationId);
    expect(restored.value.targetRoomCode).not.toBe(source.roomCode);
    expect(JSON.stringify(restored.value)).not.toContain(ticket.resumeToken);
    expect(
      env.PTCG_ROOM.getByName(restored.value.targetRoomCode)
    ).toBeDefined();

    const restoreRetry = await postJson(
      `/v2/continuations/${created.value.saveId}/restore`,
      restoreInput,
      '198.51.100.43'
    );
    expect(restoreRetry.status).toBe(201);
    expect(await restoreRetry.json()).toEqual(restored.value);

    const requesterTicket = await exchangePlayerCapability(
      restored.value.targetRoomCode,
      restored.value.requesterSeatCapability,
      'Blue restored'
    );
    const opponentTicket = await exchangePlayerCapability(
      restored.value.targetRoomCode,
      restored.value.opponentInvitation.invitation,
      'Red restored'
    );
    expect(requesterTicket.ok && opponentTicket.ok).toBe(true);

    const completedRevocation = await deleteJson(
      `/v2/continuations/${created.value.saveId}`,
      { capability: created.value.capability },
      '198.51.100.48'
    );
    expect(completedRevocation.status).toBe(204);
    expect(completedRevocation.headers.get('Cache-Control')).toContain(
      'no-store'
    );

    const deletedRetry = await postJson(
      `/v2/continuations/${created.value.saveId}/restore`,
      restoreInput,
      '198.51.100.43'
    );
    expect(deletedRetry.status).toBe(404);
    expect(await deletedRetry.json()).toEqual({
      error: 'continuation_unavailable',
    });

    const secondOperation = await postJson(
      `/v2/continuations/${created.value.saveId}/restore`,
      { ...restoreInput, operationId: 'K'.repeat(43) },
      '198.51.100.44'
    );
    expect(secondOperation.status).toBe(404);
    expect(await secondOperation.json()).toEqual({
      error: 'continuation_unavailable',
    });
  });

  it('lets anyone with the code back into a game its second player restored, to play the free first seat or to watch (ADR-047)', async () => {
    const source = await createRoom();
    const welcomes: { readonly playerId?: string }[] = [];
    const red = await issuePlayerTicket(source, 'two', 'Red');
    const blue = await issuePlayerTicket(source, 'one', 'Blue');
    for (const [ticket, name] of [
      [blue, 'Blue'],
      [red, 'Red'],
    ] as const) {
      const socket = await connect(source);
      openSockets.add(socket);
      const welcome = nextServerMessage(socket);
      socket.send(helloFrame(source, ticket, name));
      const message = (await welcome) as {
        readonly type: string;
        readonly playerId?: string;
      };
      expect(message.type).toBe('Welcome');
      welcomes.push(message);
    }
    // The second player saves the game and restores it.
    const createdResponse = await postJson(
      `/v2/rooms/${source.roomCode}/continuations`,
      { resumeToken: red.resumeToken, operationId: 'N'.repeat(43) },
      '198.51.100.61'
    );
    const created = parseContinuationCreationResponse(
      await createdResponse.json()
    );
    if (!created.ok) throw new Error('expected continuation creation');
    const restoredResponse = await postJson(
      `/v2/continuations/${created.value.saveId}/restore`,
      { capability: created.value.capability, operationId: 'O'.repeat(43) },
      '198.51.100.62'
    );
    const restored = parseContinuationRestoreResponse(
      await restoredResponse.json()
    );
    if (!restored.ok) throw new Error('expected continuation restore');
    const target = { ...source, roomCode: restored.value.targetRoomCode };
    const restorer = await exchangePlayerCapability(
      target.roomCode,
      restored.value.requesterSeatCapability,
      'Red restored'
    );
    if (!restorer.ok) throw new Error('expected the restorer admitted');
    const socket = await connect(target);
    openSockets.add(socket);
    const welcome = nextServerMessage(socket);
    socket.send(helloFrame(target, restorer.value, 'Red restored'));
    const restorerWelcome = (await welcome) as {
      readonly type: string;
      readonly playerId?: string;
    };
    expect(restorerWelcome).toMatchObject({
      type: 'Welcome',
      playerId: welcomes[1]!.playerId,
    });

    // Its restorer is the room's host: the code is theirs to change.
    const codeResponse = await postJson(
      `/v2/rooms/${target.roomCode}/code`,
      { resumeToken: restorer.value.resumeToken },
      '198.51.100.63'
    );
    expect(codeResponse.status).toBe(200);
    const room = (await codeResponse.json()) as {
      readonly code: string;
      readonly canChange: boolean;
    };
    expect(room.canChange).toBe(true);

    // The code takes the free first seat, and lets someone watch.
    const join = (requestedRole: string, address: string) =>
      postJson(
        '/v2/join',
        { code: room.code, requestedRole, displayName: 'Blue again' },
        address
      );
    const seated = await join('player', '198.51.100.64');
    expect(seated.status).toBe(201);
    const seatedBody = (await seated.json()) as {
      readonly admissionTicket: string;
      readonly resumeToken: string;
    };
    const guest = await connect(target);
    openSockets.add(guest);
    const guestWelcome = nextServerMessage(guest);
    guest.send(
      helloFrame(
        target,
        { ...seatedBody, expiresAt: 0 },
        'Blue again'
      )
    );
    expect(await guestWelcome).toMatchObject({
      type: 'Welcome',
      playerId: welcomes[0]!.playerId,
    });
    const watching = await join('spectator', '198.51.100.65');
    expect(watching.status).toBe(201);
    expect(await watching.json()).toMatchObject({
      roomCode: target.roomCode,
      requestedRole: 'spectator',
    });
  });

  it('enforces independent real edge budgets before source and save work', async () => {
    const creationResponses = await Promise.all(
      Array.from({ length: 31 }, (_, index) =>
        postJson(
          '/v2/rooms/BCDEFGHJ2345/continuations',
          {
            resumeToken: 'syntactically-valid-resume-capability-0000000001',
            operationId: String.fromCharCode(65 + (index % 26)).repeat(43),
          },
          '198.51.100.70'
        )
      )
    );
    expect(
      creationResponses.filter(({ status }) => status === 403)
    ).toHaveLength(30);
    expect(
      creationResponses.filter(({ status }) => status === 429)
    ).toHaveLength(1);

    const saveId = 'A'.repeat(22);
    const restoreResponses = await Promise.all(
      Array.from({ length: 31 }, (_, index) =>
        postJson(
          `/v2/continuations/${saveId}/restore`,
          {
            capability: `ptcgsave.v1.${saveId}.${String.fromCharCode(
              65 + (index % 26)
            ).repeat(43)}`,
            operationId: 'R'.repeat(43),
          },
          '198.51.100.71'
        )
      )
    );
    expect(
      restoreResponses.filter(({ status }) => status === 404)
    ).toHaveLength(30);
    expect(
      restoreResponses.filter(({ status }) => status === 429)
    ).toHaveLength(1);

    const revocationResponses = await Promise.all(
      Array.from({ length: 31 }, (_, index) =>
        deleteJson(
          `/v2/continuations/${saveId}`,
          {
            capability: `ptcgsave.v1.${String.fromCharCode(
              65 + (index % 26)
            ).repeat(22)}.${'V'.repeat(43)}`,
          },
          '198.51.100.72'
        )
      )
    );
    expect(
      revocationResponses.filter(({ status }) => status === 204)
    ).toHaveLength(30);
    expect(
      revocationResponses.filter(({ status }) => status === 429)
    ).toHaveLength(1);
  });
});
