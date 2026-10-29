/**
 * Takes an invitation link's fragment (`#invite=…`, ADR-020) off the page's
 * address before anything else can read, keep or report it: main.tsx
 * imports this first, so it runs before any other module of the app. The
 * address bar, history entry and any later `location` read then hold the
 * page's plain address; the fragment waits here, in memory only, for the
 * lobby to take it once (`takeInvitationLink`), and is never written back.
 *
 * A browser never sends a fragment to a server or puts it in a Referer, so
 * the link's claim reaches no one but this page.
 */

const PREFIX = '#invite=';

let captured: string | undefined;
const listeners = new Set<() => void>();

/** Moves an invitation fragment, if the address has one, into memory. */
const capture = (): boolean => {
  const location = globalThis.location as Location | undefined;
  const history = globalThis.history as History | undefined;
  if (!location || !history) return false;
  const { hash } = location;
  if (!hash.startsWith(PREFIX)) return false;
  captured = hash;
  try {
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${location.search}`
    );
  } catch {
    // A page that cannot rewrite its address still reads the link once.
  }
  return true;
};

capture();

// A link opened while the page is already up (pasted into the address
// bar, or followed from another tab of the same page) changes only the
// fragment: no reload, the same capture.
globalThis.addEventListener?.('hashchange', () => {
  if (capture()) for (const listener of listeners) listener();
});

/**
 * The invitation fragment the page was opened with (or given since), once:
 * a second call has nothing, so a reload or a remount never joins twice.
 */
export const takeInvitationLink = (): string | undefined => {
  const value = captured;
  captured = undefined;
  return value;
};

/** Called when a link arrives while the page is open. */
export const onInvitationLink = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
