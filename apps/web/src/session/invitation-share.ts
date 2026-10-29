import { t } from '@lingui/core/macro';
import { serializeRoomInvitationLinkFragment } from '@ptcgsim/protocol';
import type { RoomInvitationHandoff } from '@ptcgsim/protocol';

import { dismissToast, toast } from '../ui/toast.js';
import { currentBrowserInvitationClipboard } from './browser-invitation-clipboard.js';

/** How an invitation left this page: or that the player put the sheet away. */
export type InvitationDeliveryOutcome = 'shared' | 'copied' | 'cancelled';

/**
 * Passes an invitation link on. It is given the link still being minted,
 * so a copy can begin while the press still counts (a browser refuses a
 * clipboard write once the gesture has passed).
 */
export type InvitationDelivery = (
  link: Promise<string>
) => Promise<InvitationDeliveryOutcome>;

/** A share sheet's own shape: `navigator.share`, where the browser has one. */
type ShareFunction = (data: ShareData) => Promise<void>;

/**
 * The page's own address, without its query or fragment: where a link
 * opens the game.
 */
export const currentInvitationLinkBase = (): string | undefined => {
  const location = globalThis.location as Location | undefined;
  return location ? `${location.origin}${location.pathname}` : undefined;
};

/** The link that opens the game straight into the invitation's room. */
export const invitationLink = (
  base: string,
  handoff: RoomInvitationHandoff
): string =>
  `${base.split('#')[0]!}#${serializeRoomInvitationLinkFragment(handoff)}`;

const errorName = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'name' in error
    ? String(error.name)
    : undefined;

/**
 * Asks the player for another press once the first no longer counts: a link
 * minted after the browser stopped treating the press as theirs can't be
 * shared or copied from it. `pass` must be called inside that press; the
 * link stays in it, never on the page. Resolves with how that went, or
 * `cancelled` if no press comes.
 */
export type AnotherPress = (
  pass: () => Promise<InvitationDeliveryOutcome>,
  way: 'share' | 'copy'
) => Promise<InvitationDeliveryOutcome>;

/** How long the notice waits for that press. */
const ANOTHER_PRESS_MS = 30_000;

/** A notice whose button is that press. */
export const noticeForAnotherPress: AnotherPress = (pass, way) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const id = toast({
      title: t`Invitation link ready`,
      timeout: ANOTHER_PRESS_MS,
      action: {
        label: way === 'share' ? t`Share` : t`Copy`,
        onAction: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          pass().then(resolve, reject);
        },
      },
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      dismissToast(id);
      resolve('cancelled');
    }, ANOTHER_PRESS_MS);
  });

/** The browser no longer counts the press as the player's. */
const pressLapsed = (error: unknown): boolean =>
  errorName(error) === 'NotAllowedError';

/**
 * The browser's way to pass a link on: the system share sheet on a touch
 * screen that has one (a phone's messaging apps), the clipboard elsewhere.
 * The share needs the link, minted only after the press; where minting
 * outlasted the press (a slow network; iOS counts a press only briefly),
 * the browser refuses the share and any copy alike, so a notice asks for
 * another press (`anotherPress`), which shares, or copies where the sheet
 * still won't. Undefined where neither is available.
 */
export const browserInvitationDelivery = ({
  preferShare,
  share = typeof globalThis.navigator?.share === 'function'
    ? globalThis.navigator.share.bind(globalThis.navigator)
    : undefined,
  clipboard = currentBrowserInvitationClipboard(),
  anotherPress = noticeForAnotherPress,
}: {
  readonly preferShare: boolean;
  readonly share?: ShareFunction | undefined;
  readonly clipboard?: ReturnType<typeof currentBrowserInvitationClipboard>;
  readonly anotherPress?: AnotherPress;
}): InvitationDelivery | undefined => {
  const copy = async (url: string): Promise<InvitationDeliveryOutcome> => {
    if (!clipboard) throw new Error('No clipboard');
    // Begun at once: inside the press that calls it.
    await clipboard.writeText(Promise.resolve(url));
    return 'copied';
  };
  if (preferShare && share) {
    // Called inside a press: the sheet opens at once, a copy if it won't.
    const shareOrCopy = async (
      url: string
    ): Promise<InvitationDeliveryOutcome> => {
      try {
        await share({ url });
        return 'shared';
      } catch (error) {
        if (errorName(error) === 'AbortError') return 'cancelled';
        if (!clipboard) throw error;
        return copy(url);
      }
    };
    return async (link) => {
      const url = await link;
      try {
        await share({ url });
        return 'shared';
      } catch (error) {
        if (errorName(error) === 'AbortError') return 'cancelled';
        if (pressLapsed(error))
          return anotherPress(() => shareOrCopy(url), 'share');
        if (!clipboard) throw error;
        return copy(url);
      }
    };
  }
  if (!clipboard) return undefined;
  return async (link) => {
    try {
      await clipboard.writeText(link);
      return 'copied';
    } catch (error) {
      if (!pressLapsed(error)) throw error;
      const url = await link;
      return anotherPress(() => copy(url), 'copy');
    }
  };
};
