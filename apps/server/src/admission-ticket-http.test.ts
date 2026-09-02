import type {
  AdmissionTicketIssueResult,
  RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { describe, expect, it, vi } from 'vitest';

import {
  handleAdmissionTicketRequest,
  MAX_ADMISSION_REQUEST_BYTES,
  type AdmissionTicketIssuer,
} from './admission-ticket-http.js';

const capability = 'seat-capability-never-reflected-000000000001';
const admissionTicket = 'socket-ticket-returned-once-00000000000001';
const snapshot = {} as RoomAuthoritySnapshot;

const request = (
  body: string,
  headers: Record<string, string> = {},
  url = 'https://play.example/v2/rooms/ABCDEFGH2345/admission-tickets'
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

const acceptedIssuer = (): AdmissionTicketIssuer =>
  vi.fn(async (): Promise<AdmissionTicketIssueResult> => ({
    accepted: true,
    committed: true,
    snapshot,
    admissionTicket,
    expiresAt: 40_000,
  }));

describe('admission ticket HTTP boundary', () => {
  it('accepts a bounded same-origin JSON body and returns a no-store ticket', async () => {
    const issue = acceptedIssuer();
    const response = await handleAdmissionTicketRequest(
      request(
        JSON.stringify({
          capability,
          displayName: 'Blue',
          requestedRole: 'player',
        })
      ),
      issue
    );

    expect(response.status).toBe(201);
    expect(issue).toHaveBeenCalledWith({
      capability,
      displayName: 'Blue',
      requestedRole: 'player',
    });
    expect(await response.json()).toEqual({
      admissionTicket,
      expiresAt: 40_000,
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('rejects cross-origin, non-JSON, malformed, and oversized requests before issuing', async () => {
    const issue = acceptedIssuer();
    const crossOrigin = await handleAdmissionTicketRequest(
      request('{}', { Origin: 'https://attacker.example' }),
      issue
    );
    const wrongType = await handleAdmissionTicketRequest(
      request('{}', { 'Content-Type': 'text/plain' }),
      issue
    );
    const malformed = await handleAdmissionTicketRequest(request('{'), issue);
    const encoded = await handleAdmissionTicketRequest(
      request('{}', { 'Content-Encoding': 'gzip' }),
      issue
    );
    const query = await handleAdmissionTicketRequest(
      request(
        '{}',
        {},
        'https://play.example/v2/rooms/ABCDEFGH2345/admission-tickets?capability=forbidden'
      ),
      issue
    );
    const oversized = await handleAdmissionTicketRequest(
      request(
        JSON.stringify({ padding: 'x'.repeat(MAX_ADMISSION_REQUEST_BYTES) })
      ),
      issue
    );

    expect(crossOrigin.status).toBe(403);
    expect(wrongType.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(encoded.status).toBe(415);
    expect(query.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(issue).not.toHaveBeenCalled();
  });

  it('does not reflect rejected capabilities or internal errors', async () => {
    const rejected = await handleAdmissionTicketRequest(
      request(
        JSON.stringify({
          capability,
          displayName: 'Blue',
          requestedRole: 'player',
        })
      ),
      async () => ({
        accepted: false,
        code: 'invalid_capability',
        snapshot,
      })
    );
    const failed = await handleAdmissionTicketRequest(
      request(
        JSON.stringify({
          capability,
          displayName: 'Blue',
          requestedRole: 'player',
        })
      ),
      async () => {
        throw new Error(capability);
      }
    );

    expect(rejected.status).toBe(403);
    expect(await rejected.text()).toBe('{"error":"admission_rejected"}');
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe('{"error":"internal_retryable"}');
  });
});
