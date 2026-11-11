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

/**
 * How the page was opened, for its own report (ADR-054): by an invite link,
 * by a room code link, or neither. Kept after the links are taken.
 */
let openedBy: 'invite' | 'room_code' | undefined;
export const pageOpenedBy = (): 'invite' | 'room_code' | undefined => openedBy;

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

if (capture()) openedBy = 'invite';

/**
 * An invite link by room code (ADR-047), `?room=CODE`: no secret, but taken
 * off the address too, so a reload doesn't offer the same room again. The
 * lobby fills its code in and opens Play online.
 */
let capturedRoomCode: string | undefined;
const captureRoomCode = (): void => {
  const location = globalThis.location as Location | undefined;
  const history = globalThis.history as History | undefined;
  if (!location || !history) return;
  const params = new URLSearchParams(location.search);
  const code = params.get('room');
  if (code === null) return;
  capturedRoomCode = code;
  openedBy ??= 'room_code';
  params.delete('room');
  const search = params.toString();
  try {
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${search ? `?${search}` : ''}${location.hash}`
    );
  } catch {
    // Kept on the address: the lobby still reads it once.
  }
};

captureRoomCode();

/** The room code the page was opened with (`?room=`), once. */
export const takeRoomCodeLink = (): string | undefined => {
  const value = capturedRoomCode;
  capturedRoomCode = undefined;
  return value;
};

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
