/**
 * Takes a friend's invite link (`#friend=<User ID>`, ADR-055) off the
 * page's address as the app starts, as a shared game's is
 * (replay-link-capture.ts). The id waits here for Friends to open on it,
 * once. The link names a player, not a secret: it can only ask.
 */

const PREFIX = '#friend=';
const USER_ID = /^a_[A-Za-z0-9_-]{16}$/u;

let captured: string | undefined;

const capture = (): void => {
  const location = globalThis.location as Location | undefined;
  const history = globalThis.history as History | undefined;
  if (!location || !history || !location.hash.startsWith(PREFIX)) return;
  const id = location.hash.slice(PREFIX.length);
  if (USER_ID.test(id)) captured = id;
  try {
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${location.search}`
    );
  } catch {
    // Opens Friends once all the same.
  }
};

capture();

let onLink: (() => void) | undefined;

// A link pasted into this tab's own address bar changes only the fragment:
// taken as it comes, too.
globalThis.addEventListener?.('hashchange', () => {
  capture();
  if (captured !== undefined) onLink?.();
});

/** The linked player's id, once. */
export const takeFriendLink = (): string | undefined => {
  const id = captured;
  captured = undefined;
  return id;
};

/** Hears of a link that arrives while the page is open. */
export const onFriendLink = (listener: (() => void) | undefined): void => {
  onLink = listener;
};
