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

  const lapsed = () =>
    Object.assign(new Error('no gesture'), { name: 'NotAllowedError' });

  it('asks for another press where minting outlasted the first, and shares or copies from it', async () => {
    const copy = clipboard();
    const share = vi.fn(async () => {
      throw lapsed();
    });
    // The notice's button, pressed by the test when it says so.
    let press: (() => Promise<string>) | undefined;
    const anotherPress = vi.fn(
      (pass: () => Promise<'shared' | 'copied' | 'cancelled'>) =>
        new Promise<'shared' | 'copied' | 'cancelled'>((resolve) => {
          press = () => pass().then((outcome) => (resolve(outcome), outcome));
        })
    );
    const touch = browserInvitationDelivery({
      preferShare: true,
      share,
      clipboard: copy.writer,
      anotherPress,
    })!;
    const pending = touch(Promise.resolve('https://x/#invite=c'));
    await vi.waitFor(() => expect(anotherPress).toHaveBeenCalledOnce());
    expect(anotherPress.mock.calls[0]?.[1]).toBe('share');
    // No copy tried outside a press: it would be refused as well.
    expect(copy.writer.writeText).not.toHaveBeenCalled();
    // The new press shares: here the sheet works this time.
    share.mockImplementationOnce(async () => undefined);
    await press!();
    await expect(pending).resolves.toBe('shared');
    expect(share).toHaveBeenLastCalledWith({ url: 'https://x/#invite=c' });

    // A sheet that still won't open copies from that press instead.
    const again = touch(Promise.resolve('https://x/#invite=e'));
    await vi.waitFor(() => expect(anotherPress).toHaveBeenCalledTimes(2));
    await press!();
    await expect(again).resolves.toBe('copied');
    expect(copy.texts).toEqual(['https://x/#invite=e']);

    // A mouse's copy refused the same way asks the same.
    const mouseCopy = clipboard();
    mouseCopy.writer.writeText.mockRejectedValueOnce(lapsed());
    const mouse = browserInvitationDelivery({
      preferShare: false,
      clipboard: mouseCopy.writer,
      anotherPress,
    })!;
    const copied = mouse(Promise.resolve('https://x/#invite=f'));
    await vi.waitFor(() => expect(anotherPress).toHaveBeenCalledTimes(3));
    expect(anotherPress.mock.calls[2]?.[1]).toBe('copy');
    await press!();
    await expect(copied).resolves.toBe('copied');
    expect(mouseCopy.texts).toEqual(['https://x/#invite=f']);
  });

  it('copies where the browser refuses the sheet outright, and with a mouse', async () => {
    const copy = clipboard();
    const refused = browserInvitationDelivery({
      preferShare: true,
      share: vi.fn(async () => {
        throw Object.assign(new Error('blocked'), { name: 'TypeError' });
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

  it('passes on nothing once its invitation is past its time, timed on this device, and says why', async () => {
    // This device's clock runs twenty minutes past the server's: the
    // invitation's own expiry is behind it already, yet it has a minute
    // left of the lifetime the server gave it.
    let now = handoff.expiresAt + 20 * 60_000;
    const held = new RemoteRoomHeldInvitation(
      'https://ptcgsim.example/',
      () => now
    );
    held.hold(serializeRoomInvitationHandoffText(handoff), 60_000);
    const deliver = vi.fn(async (link: Promise<string>) => {
      await link;
      return 'copied' as const;
    });
    now += 59_999;
    await expect(held.invite(deliver)).resolves.toMatchObject({
      outcome: 'copied',
    });
    now += 1;
    deliver.mockClear();
    await expect(held.invite(deliver)).rejects.toMatchObject({
      code: 'expired_invitation',
    });
    expect(deliver).not.toHaveBeenCalled();
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
