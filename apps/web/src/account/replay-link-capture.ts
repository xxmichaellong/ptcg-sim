/**
 * Takes a shared game's link (`#replay=<account>.<game>.<secret>`, ADR-053)
 * off the page's address as the app starts, as an invitation's is
 * (invitation-link-capture.ts): a fragment never reaches a server or a
 * Referer, and the address bar and history keep the plain page. The link
 * waits here, in memory, for the Solo table to play it once.
 */

const PREFIX = '#replay=';
const TOKEN = /^a_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/u;

let captured: string | undefined;

const capture = (): void => {
  const location = globalThis.location as Location | undefined;
  const history = globalThis.history as History | undefined;
  if (!location || !history || !location.hash.startsWith(PREFIX)) return;
  const token = location.hash.slice(PREFIX.length);
  if (TOKEN.test(token)) captured = token;
  try {
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${location.search}`
    );
  } catch {
    // A page that cannot rewrite its address still plays the link once.
  }
};

capture();

/** The shared game's token, once. */
export const takeReplayLink = (): string | undefined => {
  const token = captured;
  captured = undefined;
  return token;
};
