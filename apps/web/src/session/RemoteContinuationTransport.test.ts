import {
  parseContinuationCreationRequest,
  parseContinuationRestoreRequest,
  parseContinuationRevocationRequest,
} from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  createContinuationOperationId,
  createRemoteContinuation,
  RemoteContinuationTransportError,
  restoreRemoteContinuation,
  revokeRemoteContinuation,
} from './RemoteContinuationTransport.js';

const roomCode = 'ABCDEFGH2345';
const saveId = 'S'.repeat(22);
const operationId = 'O'.repeat(43);
const restoreOperationId = 'R'.repeat(43);
const capability = `ptcgsave.v1.${saveId}.${'C'.repeat(43)}`;
const resumeToken = 'resume-capability-kept-only-in-request-memory-0001';
const requesterSeatCapability =
  'restored-requester-seat-capability-private-0000001';
const opponentInvitation = 'restored-opponent-invitation-private-0000000001';
const now = 2_000_000_000_000;

const creationResponse = () => ({
  format: 'ptcgsim-continuation-creation-result-v1',
  saveId,
  operationId,
  capability,
  createdAt: now - 1_000,
  expiresAt: now + 30 * 24 * 60 * 60_000 - 1_000,
});

const restoreResponse = () => ({
  format: 'ptcgsim-continuation-restore-result-v1',
  saveId,
  operationId: restoreOperationId,
  completedAt: now - 1_000,
  targetRoomCode: 'BCDEFGHJ2345',
  requesterSeatCapability,
  opponentInvitation: {
    invitation: opponentInvitation,
    expiresAt: now + 60_000,
  },
});

const dependencies = (fetchImplementation: typeof fetch) => ({
  fetch: fetchImplementation,
  origin: 'https://play.example',
  now: () => now,
});

const expectCode = async (
  operation: Promise<unknown>,
  code: RemoteContinuationTransportError['code']
) => {
  await expect(operation).rejects.toMatchObject({ code });
};

describe('remote continuation HTTP transport', () => {
  it('generates a schema-valid 256-bit operation ID without padding', () => {
    const generated = createContinuationOperationId({
      getRandomValues: (bytes) => {
        bytes.forEach((_, index) => {
          bytes[index] = index;
        });
        return bytes;
      },
    });

    expect(generated).toBe('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
    expect(generated).toHaveLength(43);
    expect(
      parseContinuationCreationRequest({ resumeToken, operationId: generated })
        .ok
    ).toBe(true);
  });

  it('creates through the exact credential-safe request and validates its lifetime', async () => {
    const receivers: unknown[] = [];
    const fetchImplementation = vi.fn(function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(
        Response.json(creationResponse(), { status: 201 })
      );
    });

    const result = await createRemoteContinuation(
      { roomCode: roomCode.toLowerCase(), resumeToken, operationId },
      dependencies(fetchImplementation)
    );

    expect(result).toEqual(creationResponse());
    expect(Object.isFrozen(result)).toBe(true);
    expect(receivers).toEqual([undefined]);
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://play.example/v2/rooms/${roomCode}/continuations`
    );
    expect(String(url)).not.toContain(resumeToken);
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ resumeToken, operationId });
    expect(parseContinuationCreationRequest(body).ok).toBe(true);
  });

  it('rejects invalid creation input, status, correlation, encoding, size, and lifetime', async () => {
    const unusedFetch = vi.fn<typeof fetch>();
    await expectCode(
      createRemoteContinuation(
        { roomCode: 'bad', resumeToken, operationId },
        dependencies(unusedFetch)
      ),
      'invalid_input'
    );
    await expectCode(
      createRemoteContinuation(
        { roomCode, resumeToken: 'short', operationId },
        dependencies(unusedFetch)
      ),
      'invalid_input'
    );
    expect(unusedFetch).not.toHaveBeenCalled();

    const cases = [
      [Response.json({ error: 'denied' }, { status: 403 }), 'rejected'],
      [Response.json({ error: 'busy' }, { status: 429 }), 'rate_limited'],
      [Response.json({ error: 'broken' }, { status: 503 }), 'request_failed'],
      [
        Response.json(
          { ...creationResponse(), operationId: 'X'.repeat(43) },
          { status: 201 }
        ),
        'invalid_response',
      ],
      [
        new Response(JSON.stringify(creationResponse()), {
          status: 201,
          headers: { 'Content-Type': 'text/plain' },
        }),
        'invalid_response',
      ],
      [
        Response.json(
          { ...creationResponse(), padding: 'x'.repeat(4_096) },
          { status: 201 }
        ),
        'invalid_response',
      ],
      [
        Response.json(
          { ...creationResponse(), expiresAt: now },
          { status: 201 }
        ),
        'expired_response',
      ],
    ] as const;
    for (const [response, code] of cases) {
      await expectCode(
        createRemoteContinuation(
          { roomCode, resumeToken, operationId },
          dependencies(vi.fn(async () => response))
        ),
        code
      );
    }
  });

  it('restores through a locator-only URL and returns immutable correlated credentials', async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json(restoreResponse(), { status: 201 })
    );

    const result = await restoreRemoteContinuation(
      { capability, operationId: restoreOperationId },
      dependencies(fetchImplementation)
    );

    expect(result).toEqual(restoreResponse());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.opponentInvitation)).toBe(true);
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://play.example/v2/continuations/${saveId}/restore`
    );
    expect(String(url)).not.toContain(capability);
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ capability, operationId: restoreOperationId });
    expect(parseContinuationRestoreRequest(body).ok).toBe(true);
  });

  it('fails closed for invalid, unavailable, uncorrelated, expired, or duplicated restore credentials', async () => {
    const unusedFetch = vi.fn<typeof fetch>();
    await expectCode(
      restoreRemoteContinuation(
        { capability: 'bad', operationId: restoreOperationId },
        dependencies(unusedFetch)
      ),
      'invalid_input'
    );
    expect(unusedFetch).not.toHaveBeenCalled();

    const cases = [
      [Response.json({ error: 'gone' }, { status: 404 }), 'unavailable'],
      [Response.json({ error: 'busy' }, { status: 429 }), 'rate_limited'],
      [
        Response.json(
          { ...restoreResponse(), saveId: 'T'.repeat(22) },
          { status: 201 }
        ),
        'invalid_response',
      ],
      [
        Response.json(
          {
            ...restoreResponse(),
            opponentInvitation: {
              invitation: requesterSeatCapability,
              expiresAt: now + 60_000,
            },
          },
          { status: 201 }
        ),
        'invalid_response',
      ],
      [
        Response.json(
          {
            ...restoreResponse(),
            opponentInvitation: {
              invitation: opponentInvitation,
              expiresAt: now,
            },
          },
          { status: 201 }
        ),
        'expired_response',
      ],
    ] as const;
    for (const [response, code] of cases) {
      await expectCode(
        restoreRemoteContinuation(
          { capability, operationId: restoreOperationId },
          dependencies(vi.fn(async () => response))
        ),
        code
      );
    }
  });

  it('revokes with an exact same-origin DELETE and accepts only 204', async () => {
    const fetchImplementation = vi.fn(
      async () => new Response(null, { status: 204 })
    );
    await revokeRemoteContinuation(
      { capability },
      dependencies(fetchImplementation)
    );

    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(`https://play.example/v2/continuations/${saveId}`);
    expect(String(url)).not.toContain(capability);
    expect(init).toMatchObject({ method: 'DELETE', credentials: 'omit' });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ capability });
    expect(parseContinuationRevocationRequest(body).ok).toBe(true);

    await expectCode(
      revokeRemoteContinuation(
        { capability },
        dependencies(
          vi.fn(async () => Response.json({ error: 'busy' }, { status: 429 }))
        )
      ),
      'rate_limited'
    );
    await expectCode(
      revokeRemoteContinuation(
        { capability },
        dependencies(vi.fn(async () => new Response(null, { status: 200 })))
      ),
      'request_failed'
    );
  });

  it('normalizes bad origin, network, and clock failures without reflecting credentials', async () => {
    for (const operation of [
      createRemoteContinuation(
        { roomCode, resumeToken, operationId },
        {
          fetch: vi.fn<typeof fetch>(),
          origin: 'https://user:pass@example.test',
        }
      ),
      restoreRemoteContinuation(
        { capability, operationId: restoreOperationId },
        dependencies(
          vi.fn(async () => {
            throw new Error(capability);
          })
        )
      ),
      createRemoteContinuation(
        { roomCode, resumeToken, operationId },
        {
          ...dependencies(
            vi.fn(async () =>
              Response.json(creationResponse(), { status: 201 })
            )
          ),
          now: () => Number.NaN,
        }
      ),
      createRemoteContinuation(
        { roomCode, resumeToken, operationId },
        {
          ...dependencies(
            vi.fn(async () =>
              Response.json(creationResponse(), { status: 201 })
            )
          ),
          now: () => {
            throw new Error(resumeToken);
          },
        }
      ),
    ]) {
      let error: unknown;
      try {
        await operation;
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(RemoteContinuationTransportError);
      expect(String(error)).not.toContain(capability);
      expect(String(error)).not.toContain(resumeToken);
    }
  });
});
