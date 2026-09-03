import type {
  RoomAuthoritySnapshot,
  RoomInvitationIssueResult,
} from '@ptcgsim/room-authority';
import { describe, expect, it, vi } from 'vitest';

import {
  handleRoomInvitationRequest,
  MAX_ROOM_INVITATION_REQUEST_BYTES,
  type RoomInvitationIssuer,
} from './room-invitation-http.js';

const capability = 'player-two-master-never-reflected-000000000001';
const invitation = 'one-time-room-invitation-returned-00000000001';
const snapshot = {} as RoomAuthoritySnapshot;

const request = (
  body: string,
  headers: Record<string, string> = {},
  url = 'https://play.example/v2/rooms/ABCDEFGH2345/invitations'
): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      Origin: 'https://play.example',
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });

const acceptedIssuer = (): RoomInvitationIssuer =>
  vi.fn(async (): Promise<RoomInvitationIssueResult> => ({
    accepted: true,
    committed: true,
    snapshot,
    invitation,
    requestedRole: 'player',
    expiresAt: 910_000,
  }));

describe('room invitation HTTP boundary', () => {
  it('mints a bounded no-store invitation from a same-origin JSON body', async () => {
    const issue = acceptedIssuer();
    const response = await handleRoomInvitationRequest(
      request(JSON.stringify({ capability, requestedRole: 'player' })),
      issue
    );

    expect(response.status).toBe(201);
    expect(issue).toHaveBeenCalledWith({
      capability,
      requestedRole: 'player',
    });
    expect(await response.json()).toEqual({
      invitation,
      requestedRole: 'player',
      expiresAt: 910_000,
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('rejects cross-origin, non-JSON, extra-field, malformed, queried, and oversized requests before issuing', async () => {
    const issue = acceptedIssuer();
    const responses = await Promise.all([
      handleRoomInvitationRequest(
        request('{}', { Origin: 'https://attacker.example' }),
        issue
      ),
      handleRoomInvitationRequest(
        request('{}', { 'Content-Type': 'text/plain' }),
        issue
      ),
      handleRoomInvitationRequest(
        request(
          JSON.stringify({
            capability,
            requestedRole: 'player',
            displayName: 'not-accepted-here',
          })
        ),
        issue
      ),
      handleRoomInvitationRequest(request('{'), issue),
      handleRoomInvitationRequest(
        request(
          JSON.stringify({ capability, requestedRole: 'player' }),
          {},
          'https://play.example/v2/rooms/ABCDEFGH2345/invitations?secret=forbidden'
        ),
        issue
      ),
      handleRoomInvitationRequest(
        request(
          JSON.stringify({
            padding: 'x'.repeat(MAX_ROOM_INVITATION_REQUEST_BYTES),
          })
        ),
        issue
      ),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([
      403, 415, 400, 400, 400, 413,
    ]);
    expect(issue).not.toHaveBeenCalled();
  });

  it('maps capacity and occupied-seat outcomes without reflecting credentials', async () => {
    for (const [code, status] of [
      ['invitation_capacity', 429],
      ['seat_unavailable', 409],
    ] as const) {
      const response = await handleRoomInvitationRequest(
        request(JSON.stringify({ capability, requestedRole: 'player' })),
        async () => ({ accepted: false, code, snapshot })
      );
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain(capability);
    }
  });

  it('redacts invalid capabilities and internal failures', async () => {
    const rejected = await handleRoomInvitationRequest(
      request(JSON.stringify({ capability, requestedRole: 'player' })),
      async () => ({ accepted: false, code: 'invalid_capability', snapshot })
    );
    const failed = await handleRoomInvitationRequest(
      request(JSON.stringify({ capability, requestedRole: 'player' })),
      async () => {
        throw new Error(capability);
      }
    );

    expect(rejected.status).toBe(403);
    expect(await rejected.text()).toBe('{"error":"invitation_rejected"}');
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe('{"error":"internal_retryable"}');
  });

  it('returns a bounded retry hint when the room budget is exhausted', async () => {
    const response = await handleRoomInvitationRequest(
      request(JSON.stringify({ capability, requestedRole: 'player' })),
      async () => ({
        accepted: false,
        code: 'rate_limited',
        retryAfterSeconds: 29,
        snapshot,
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('29');
    expect(await response.json()).toEqual({ error: 'rate_limited' });
  });
});
