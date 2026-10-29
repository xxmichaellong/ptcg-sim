import { serializeRoomInvitationLinkFragment } from '@ptcgsim/protocol';
import type { RoomInvitationHandoff } from '@ptcgsim/protocol';

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
 * The browser's way to pass a link on: the system share sheet on a touch
 * screen that has one (a phone's messaging apps), the clipboard elsewhere.
 * A share the browser refuses (the press too long ago) falls back to the
 * clipboard. Undefined where neither is available.
 */
export const browserInvitationDelivery = ({
  preferShare,
  share = typeof globalThis.navigator?.share === 'function'
    ? globalThis.navigator.share.bind(globalThis.navigator)
    : undefined,
  clipboard = currentBrowserInvitationClipboard(),
}: {
  readonly preferShare: boolean;
  readonly share?: ShareFunction | undefined;
  readonly clipboard?: ReturnType<typeof currentBrowserInvitationClipboard>;
}): InvitationDelivery | undefined => {
  if (preferShare && share) {
    return async (link) => {
      const url = await link;
      try {
        await share({ url });
        return 'shared';
      } catch (error) {
        if (errorName(error) === 'AbortError') return 'cancelled';
        if (!clipboard) throw error;
        await clipboard.writeText(Promise.resolve(url));
        return 'copied';
      }
    };
  }
  if (!clipboard) return undefined;
  return async (link) => {
    await clipboard.writeText(link);
    return 'copied';
  };
};
