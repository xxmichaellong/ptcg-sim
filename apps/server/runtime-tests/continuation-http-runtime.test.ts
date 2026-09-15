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
    expect(creationResponses.slice(0, 30).map(({ status }) => status)).toEqual(
      Array.from({ length: 30 }, () => 403)
    );
    expect(creationResponses[30]?.status).toBe(429);

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
    expect(restoreResponses.slice(0, 30).map(({ status }) => status)).toEqual(
      Array.from({ length: 30 }, () => 404)
    );
    expect(restoreResponses[30]?.status).toBe(429);
  });
});
