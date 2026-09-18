import { serializeRoomInvitationHandoffText } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  RemoteRoomInvitationHandoffError,
  RemoteRoomInvitationJoinCustody,
} from './RemoteRoomInvitationHandoff.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

const invitation = 'invite_browser-handoff-secret-000000000000000001';
const admissionTicket = 'socket_browser-handoff-ticket-0000000000000001';
const resumeToken = 'resume_browser-handoff-token-000000000000000001';
const handoff = {
  roomCode: 'ABCDEFGH2345',
  invitation,
  requestedRole: 'player' as const,
  expiresAt: 910_000,
};
const handoffText = serializeRoomInvitationHandoffText(handoff);
const joinInput = {
  buildId: 'client-build',
  displayName: '  Red  ',
  rendererKind: 'dom' as const,
};

const acceptedResponse = () =>
  Response.json(
    { admissionTicket, resumeToken, expiresAt: 40_000 },
    { status: 201 }
  );

const paste = (custody: RemoteRoomInvitationJoinCustody, text: string) =>
  custody.acceptPaste({
    clipboardData: { getData: () => text },
    preventDefault: vi.fn(),
  });

describe('remote room foreground invitation handoff', () => {
  it('intercepts paste, exposes only safe metadata, and clears custody after bootstrap', async () => {
    const preventDefault = vi.fn();
    const clipboardData = { getData: vi.fn(() => handoffText) };
    const custody = new RemoteRoomInvitationJoinCustody(() => 10_000);

    expect(custody.acceptPaste({ clipboardData, preventDefault })).toEqual({
      roomCode: 'ABCDEFGH2345',
      requestedRole: 'player',
      expiresAt: 910_000,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(clipboardData.getData).toHaveBeenCalledWith('text/plain');
    expect(JSON.stringify(custody)).toBe('{}');
    expect(JSON.stringify(custody)).not.toContain(invitation);

    const fetchImplementation = vi.fn(async () => acceptedResponse());
    const runtime = { dispose: vi.fn() } as unknown as RemoteRoomRuntime;
    const result = await custody.bootstrap(joinInput, {
      fetch: fetchImplementation,
      origin: 'https://play.example',
      now: () => 10_000,
      createRuntime: () => runtime,
    });

    expect(result.runtime).toBe(runtime);
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://play.example/v2/rooms/ABCDEFGH2345/admission-tickets'
    );
    expect(String(url)).not.toContain(invitation);
    expect(JSON.parse(String(init?.body))).toEqual({
      capability: invitation,
      displayName: 'Red',
      requestedRole: 'player',
    });
    await expect(custody.bootstrap(joinInput)).rejects.toMatchObject({
      code: 'missing_invitation',
    });
  });

  it('fails closed for plain room codes, malformed, oversized, and expired clipboard text', () => {
    const custody = new RemoteRoomInvitationJoinCustody(() => 10_000);
    for (const text of [
      'ABCDEFGH2345',
      'PTCGSIM2-INVITE:{',
      'x'.repeat(1_025),
      serializeRoomInvitationHandoffText({ ...handoff, expiresAt: 10_000 }),
    ]) {
      expect(() => paste(custody, text)).toThrow(
        RemoteRoomInvitationHandoffError
      );
    }
    expect(() =>
      custody.acceptPaste({
        clipboardData: {
          getData: () => {
            throw new Error(invitation);
          },
        },
        preventDefault: vi.fn(),
      })
    ).toThrow(RemoteRoomInvitationHandoffError);
    expect(JSON.stringify(custody)).toBe('{}');
  });

  it('disarms an older claim before rejecting a malformed replacement paste', async () => {
    const custody = new RemoteRoomInvitationJoinCustody(() => 10_000);
    paste(custody, handoffText);

    expect(() => paste(custody, 'not-an-invitation')).toThrow(
      RemoteRoomInvitationHandoffError
    );
    await expect(custody.bootstrap(joinInput)).rejects.toMatchObject({
      code: 'missing_invitation',
    });
  });

  it('retains private custody after a failed exchange so a bounded retry can rotate its ticket', async () => {
    const custody = new RemoteRoomInvitationJoinCustody(() => 10_000);
    paste(custody, handoffText);
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: 'busy' }, { status: 503 }))
      .mockResolvedValueOnce(acceptedResponse());
    const runtime = { dispose: vi.fn() } as unknown as RemoteRoomRuntime;
    const dependencies = {
      fetch: fetchImplementation,
      origin: 'https://play.example',
      now: () => 10_000,
      createRuntime: () => runtime,
    };

    await expect(
      custody.bootstrap(joinInput, dependencies)
    ).rejects.toMatchObject({ code: 'exchange_failed' });
    await expect(
      custody.bootstrap(joinInput, dependencies)
    ).resolves.toMatchObject({ runtime });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('serializes join attempts and rejects mutation or reuse after disposal', async () => {
    let finish: ((response: Response) => void) | undefined;
    let requestSignal: AbortSignal | null | undefined;
    const fetchImplementation = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((resolve) => {
          requestSignal = init?.signal;
          finish = resolve;
        })
    );
    const runtime = { dispose: vi.fn() } as unknown as RemoteRoomRuntime;
    const custody = new RemoteRoomInvitationJoinCustody(() => 10_000);
    paste(custody, handoffText);
    const pending = custody.bootstrap(joinInput, {
      fetch: fetchImplementation,
      origin: 'https://play.example',
      now: () => 10_000,
      createRuntime: () => runtime,
    });

    await expect(custody.bootstrap(joinInput)).rejects.toMatchObject({
      code: 'join_in_progress',
    });
    custody.dispose();
    expect(requestSignal?.aborted).toBe(true);
    finish?.(acceptedResponse());
    await expect(pending).rejects.toMatchObject({ code: 'disposed' });
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(() => paste(custody, handoffText)).toThrow(
      RemoteRoomInvitationHandoffError
    );
  });
});
