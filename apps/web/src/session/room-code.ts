import {
  normalizeRoomAlias,
  parseRoomAliasResponse,
  ROOM_ALIAS_MAX_LENGTH,
} from '@ptcgsim/protocol';

import {
  currentBrowserOrigin,
  normalizeHttpOrigin,
  readBoundedJsonResponse,
  withRequestDeadline,
} from './browser-json.js';

/**
 * Rooms by their public code (ADR-047): a short code anyone can type to
 * join -- to play while the guest seat is free, or to watch -- read and
 * renewed by the room's own sessions and chosen by its host.
 */

const MAX_RESPONSE_BYTES = 2_048;

/** The query parameter an invite link carries its room's code in. */
export const ROOM_CODE_LINK_PARAMETER = 'room';

/**
 * The room code in what was typed or pasted: the code itself, or an invite
 * link carrying it (`?room=CODE`).
 */
export const roomCodeFromText = (text: string): string | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const direct = normalizeRoomAlias(trimmed);
  if (direct) return direct;
  try {
    const url = new URL(trimmed);
    const value = url.searchParams.get(ROOM_CODE_LINK_PARAMETER);
    return value ? normalizeRoomAlias(value) : undefined;
  } catch {
    return undefined;
  }
};

/** What the code field keeps of a key press: the alphabet, up to twelve. */
export const roomCodeFieldValue = (value: string): string =>
  value
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/gu, '')
    .slice(0, ROOM_ALIAS_MAX_LENGTH);

/** The link that opens the game with a room's code ready to join. */
export const roomInviteLink = (
  code: string,
  base: string | undefined = currentLinkBase()
): string => {
  const url = new URL(base ?? 'https://ptcgsim.online/');
  url.search = '';
  url.hash = '';
  url.searchParams.set(ROOM_CODE_LINK_PARAMETER, code);
  return url.href;
};

const currentLinkBase = (): string | undefined => {
  const location = globalThis.location as Location | undefined;
  return location ? `${location.origin}${location.pathname}` : undefined;
};

/** The error a refused request names, if it names one. */
export const errorOf = async (
  response: Response
): Promise<string | undefined> => {
  try {
    const body = await readBoundedJsonResponse(response, MAX_RESPONSE_BYTES);
    const error =
      body.ok && typeof body.value === 'object' && body.value !== null
        ? (body.value as { readonly error?: unknown }).error
        : undefined;
    return typeof error === 'string' ? error : undefined;
  } catch {
    return undefined;
  }
};

/** A room's code as this page knows it. */
export interface RoomCodeState {
  /** Undefined until the room says (or while it has none to show). */
  readonly code?: string;
  /** This session may choose another: it is the host's. */
  readonly canChange: boolean;
}

export type RoomCodeChangeOutcome =
  'changed' | 'code_taken' | 'invalid' | 'not_host' | 'failed';

export interface RoomCodeCustodyOptions {
  readonly roomCode: string;
  /** The session's resume bearer: it says which session asks. */
  readonly resumeToken: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly origin?: string;
}

const NO_CODE: RoomCodeState = Object.freeze({ canChange: false });

/**
 * A live room's code: asked for once the session is in, renewed while it
 * stays (the code is held on a lease the room's use keeps), and changed by
 * the host. The resume bearer stays here, never in a store or the page.
 */
export class RoomCodeCustody {
  private state: RoomCodeState = NO_CODE;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  /** The ask now out, which another ask meanwhile shares. */
  private asking: Promise<void> | undefined;
  /** Codes the host has chosen here: an answer asked before one is old. */
  private changes = 0;

  constructor(private readonly options: RoomCodeCustodyOptions) {}

  getSnapshot = (): RoomCodeState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Asks the room for its code (made for a player if it has none). One ask
   * at a time: asked again before the room answers (a connection and Room
   * opening together, or React mounting twice in development), the same
   * answer is waited for.
   */
  refresh(): Promise<void> {
    if (this.asking) return this.asking;
    const asked = this.changes;
    const asking: Promise<void> = this.request(undefined)
      .then((answer) => {
        // The host chose a code while this was out: the room's answer is
        // the code given back, and shows nothing new.
        if (answer.ok && this.changes === asked)
          this.publish({ code: answer.code, canChange: answer.canChange });
      })
      .finally(() => {
        if (this.asking === asking) this.asking = undefined;
      });
    this.asking = asking;
    return asking;
  }

  /** The host's choice of code. */
  async change(value: string): Promise<RoomCodeChangeOutcome> {
    const code = normalizeRoomAlias(value);
    if (!code) return 'invalid';
    const answer = await this.request(code);
    if (answer.ok) {
      // Anything asked before this answer is older than it; an ask from
      // here on goes to the room again.
      this.changes += 1;
      this.asking = undefined;
      this.publish({ code: answer.code, canChange: answer.canChange });
      return 'changed';
    }
    return answer.error === 'code_taken' || answer.error === 'not_host'
      ? answer.error
      : 'failed';
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private publish(next: RoomCodeState): void {
    if (this.disposed) return;
    if (
      next.code === this.state.code &&
      next.canChange === this.state.canChange
    )
      return;
    this.state = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }

  private async request(
    code: string | undefined
  ): Promise<
    | { readonly ok: true; readonly code: string; readonly canChange: boolean }
    | { readonly ok: false; readonly error: string }
  > {
    const origin = normalizeHttpOrigin(
      this.options.origin ?? currentBrowserOrigin() ?? ''
    );
    const fetchImplementation = this.options.fetch ?? globalThis.fetch;
    if (!origin || !fetchImplementation || this.disposed) {
      return { ok: false, error: 'failed' };
    }
    let response: Response;
    try {
      response = await fetchImplementation(
        new URL(
          `/v2/rooms/${encodeURIComponent(this.options.roomCode)}/code`,
          origin
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resumeToken: this.options.resumeToken,
            ...(code ? { code } : {}),
          }),
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: withRequestDeadline(undefined),
        }
      );
    } catch {
      return { ok: false, error: 'failed' };
    }
    if (response.status !== 200) {
      return { ok: false, error: (await errorOf(response)) ?? 'failed' };
    }
    const body = await readBoundedJsonResponse(response, MAX_RESPONSE_BYTES);
    const parsed = body.ok ? parseRoomAliasResponse(body.value) : undefined;
    return parsed?.ok
      ? { ok: true, code: parsed.value.code, canChange: parsed.value.canChange }
      : { ok: false, error: 'failed' };
  }
}
