// @vitest-environment happy-dom

import {
  serializeRoomInvitationHandoffText,
  serializeRoomInvitationLinkFragment,
} from '@ptcgsim/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RemoteRoomHeldInvitation } from './RemoteRoomHeldInvitation.js';
import { RemoteRoomInvitationJoinCustody } from './RemoteRoomInvitationHandoff.js';
import {
  browserInvitationDelivery,
  invitationLink,
} from './invitation-share.js';

const handoff = {
  roomCode: 'ABCDEFGH2345',
  invitation: 'secret-bearer-never-rendered-0123456789',
  requestedRole: 'player' as const,
  expiresAt: 9_999_999_999_999,
};
const fragment = serializeRoomInvitationLinkFragment(handoff);

afterEach(() => {
  history.replaceState(null, '', '/');
  vi.resetModules();
});

describe('invitation link capture', () => {
  // First: every import of the capture listens for the rest of the file,
  // and an earlier one would take the link before this one could.
  it('takes a link opened while the page is up, and says so', async () => {
    const capture = await import('./invitation-link-capture.js');
    const listener = vi.fn();
    const stop = capture.onInvitationLink(listener);
    history.replaceState(null, '', `/#${fragment}`);
    globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(listener).toHaveBeenCalledOnce();
    expect(location.hash).toBe('');
    expect(capture.takeInvitationLink()).toBe(`#${fragment}`);
    stop();
  });
  it('takes the fragment off the address before the app reads it, for the lobby once', async () => {
    history.replaceState(null, '', `/play?ref=chat#${fragment}`);
    const capture = await import('./invitation-link-capture.js');
    // Gone from the address bar (and the history entry) at once; the rest of
    // the address stays.
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/play');
    expect(location.search).toBe('?ref=chat');
    expect(location.href).not.toContain('invite=');
    expect(capture.takeInvitationLink()).toBe(`#${fragment}`);
    // Once: a remount, a second owner, a reload of the lobby find nothing.
    expect(capture.takeInvitationLink()).toBeUndefined();
  });

  it('leaves any other address alone', async () => {
    history.replaceState(null, '', '/?tutorial=damage#settings');
    const capture = await import('./invitation-link-capture.js');
    expect(location.hash).toBe('#settings');
    expect(location.search).toBe('?tutorial=damage');
    expect(capture.takeInvitationLink()).toBeUndefined();
  });
});

describe('invitation delivery', () => {
  const clipboard = () => {
    const texts: string[] = [];
    return {
      texts,
      writer: {
        writeText: vi.fn(async (text: Promise<string>) => {
          texts.push(await text);
        }),
      },
    };
  };

  it('shares on a touch screen, and puts the sheet away as the player did', async () => {
    const share = vi.fn(async () => undefined);
    const copy = clipboard();
    const deliver = browserInvitationDelivery({
      preferShare: true,
      share,
      clipboard: copy.writer,
    })!;
    await expect(deliver(Promise.resolve('https://x/#invite=a'))).resolves.toBe(
      'shared'
    );
    expect(share).toHaveBeenCalledWith({ url: 'https://x/#invite=a' });
    share.mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), { name: 'AbortError' })
    );
    await expect(deliver(Promise.resolve('https://x/#invite=b'))).resolves.toBe(
      'cancelled'
    );
    expect(copy.texts).toEqual([]);
  });

  it('copies where the browser refuses the sheet, and with a mouse', async () => {
    const copy = clipboard();
    const refused = browserInvitationDelivery({
      preferShare: true,
      share: vi.fn(async () => {
        throw Object.assign(new Error('no gesture'), {
          name: 'NotAllowedError',
        });
      }),
      clipboard: copy.writer,
    })!;
    await expect(refused(Promise.resolve('https://x/#invite=c'))).resolves.toBe(
      'copied'
    );
    const mouse = browserInvitationDelivery({
      preferShare: false,
      share: vi.fn(),
      clipboard: copy.writer,
    })!;
    // Handed the link still being minted: the write starts inside the press.
    let resolveLink!: (link: string) => void;
    const pending = mouse(new Promise((resolve) => (resolveLink = resolve)));
    expect(copy.writer.writeText).toHaveBeenCalledTimes(2);
    resolveLink('https://x/#invite=d');
    await expect(pending).resolves.toBe('copied');
    expect(copy.texts).toEqual(['https://x/#invite=c', 'https://x/#invite=d']);
  });

  it('builds the link on the page’s own address, dropping any fragment', () => {
    expect(invitationLink('https://ptcgsim.example/play#old', handoff)).toBe(
      `https://ptcgsim.example/play#${fragment}`
    );
  });
});

describe('a resumed game’s held invitation', () => {
  it('holds only an invitation to play, and passes it on as a link when asked', async () => {
    const held = new RemoteRoomHeldInvitation('https://ptcgsim.example/');
    expect(held.held).toBe(false);
    expect(() =>
      held.hold(
        serializeRoomInvitationHandoffText({
          ...handoff,
          requestedRole: 'spectator',
        })
      )
    ).toThrow();
    expect(() => held.hold('not an invitation')).toThrow();
    held.hold(serializeRoomInvitationHandoffText(handoff));
    expect(held.held).toBe(true);
    expect(JSON.stringify(held)).not.toContain(handoff.invitation);
    const links: string[] = [];
    await expect(
      held.invite(async (link) => {
        links.push(await link);
        return 'copied';
      })
    ).resolves.toMatchObject({ requestedRole: 'player', outcome: 'copied' });
    expect(links).toEqual([`https://ptcgsim.example/#${fragment}`]);
    await expect(held.invite(undefined)).rejects.toMatchObject({
      code: 'clipboard_unavailable',
    });
    held.dispose();
    expect(held.held).toBe(false);
  });
});

describe('a guest’s invitation custody', () => {
  it('takes an invitation as its envelope, its link or the link’s fragment', () => {
    const custody = new RemoteRoomInvitationJoinCustody();
    for (const text of [
      serializeRoomInvitationHandoffText(handoff),
      `https://ptcgsim.example/#${fragment}\n`,
      `#${fragment}`,
    ]) {
      expect(custody.acceptText(text)).toEqual({
        roomCode: handoff.roomCode,
        requestedRole: 'player',
        expiresAt: handoff.expiresAt,
      });
    }
    // Something else drops whatever was held before reporting.
    expect(() => custody.acceptText('ABCDEFGH2345')).toThrow();
    custody.dispose();
  });
});
