import {
  serializeProjectedReplayFile,
  type ProjectedReplayArtifact,
} from '@ptcgsim/client-session';

import { AccountRequestError } from './account-api.js';

/**
 * The account's games (ADR-053, apps/server/src/accounts/replay-http.ts),
 * as the app calls them.
 */

export interface AccountReplay {
  readonly id: string;
  readonly filedAt: number;
  readonly startedAt?: number;
  readonly moves: number;
  readonly parts: number;
  /** Each seat's name, in seat order. */
  readonly players: readonly string[];
  readonly playerOrder: readonly string[];
  /** The seat it is watched from. */
  readonly viewer: string;
  readonly mode: 'solo' | 'multiplayer';
  readonly truncated: boolean;
  readonly starred: boolean;
  /** Its share link (a path on this site), once shared. */
  readonly shareLink?: string;
}

/** Where a replay comes from: the player's own, or a share link's. */
export type ReplaySource =
  | { readonly kind: 'own'; readonly id: string }
  | { readonly kind: 'shared'; readonly token: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readReplay = (value: unknown): AccountReplay | undefined => {
  if (!isRecord(value)) return undefined;
  const { id, filedAt, startedAt, moves, parts, viewer, mode, truncated } =
    value;
  if (
    typeof id !== 'string' ||
    typeof filedAt !== 'number' ||
    typeof moves !== 'number' ||
    typeof parts !== 'number' ||
    typeof viewer !== 'string' ||
    (mode !== 'solo' && mode !== 'multiplayer')
  ) {
    return undefined;
  }
  const strings = (field: unknown): readonly string[] =>
    Array.isArray(field)
      ? field.filter((item): item is string => typeof item === 'string')
      : [];
  return {
    id,
    filedAt,
    ...(typeof startedAt === 'number' ? { startedAt } : {}),
    moves,
    parts,
    players: strings(value['players']),
    playerOrder: strings(value['playerOrder']),
    viewer,
    mode,
    truncated: truncated === true,
    starred: value['starred'] === true,
    ...(typeof value['shareLink'] === 'string'
      ? { shareLink: value['shareLink'] }
      : {}),
  };
};

const errorOf = async (response: Response): Promise<AccountRequestError> => {
  let code = 'failed';
  try {
    const error: unknown = Reflect.get(Object(await response.json()), 'error');
    if (typeof error === 'string') code = error;
  } catch {
    // Its status says enough.
  }
  return new AccountRequestError(response.status, code);
};

const send = async (
  path: string,
  method: string,
  body?: unknown
): Promise<Response> => {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await errorOf(response);
  return response;
};

export const fetchAccountReplays = async (): Promise<
  readonly AccountReplay[]
> => {
  const body: unknown = await (await send('/v2/account/replays', 'GET')).json();
  const replays: unknown = Reflect.get(Object(body), 'replays');
  return Array.isArray(replays)
    ? replays.flatMap((replay) => readReplay(replay) ?? [])
    : [];
};

export const setReplayStarred = async (
  id: string,
  starred: boolean
): Promise<void> => {
  await send(`/v2/account/replays/${id}`, 'PATCH', { starred });
};

export const deleteAccountReplay = async (id: string): Promise<void> => {
  await send(`/v2/account/replays/${id}`, 'DELETE');
};

/** The game's share link, made the first time; the same link after. */
export const shareAccountReplay = async (id: string): Promise<string> => {
  const body: unknown = await (
    await send(`/v2/account/replays/${id}/share`, 'POST')
  ).json();
  const link: unknown = Reflect.get(Object(body), 'shareLink');
  if (typeof link !== 'string') throw new AccountRequestError(200, 'malformed');
  return new URL(link, globalThis.location?.href ?? 'http://localhost/').href;
};

export interface ReplayPart {
  readonly part: number;
  readonly parts: number;
  /** The part as a replay file, ready to play. */
  readonly file: Uint8Array;
  /** Its replay's id, to know it is the one playing. */
  readonly replayId: string;
}

const partPath = (source: ReplaySource, part: number): string => {
  if (source.kind === 'own') {
    return `/v2/account/replays/${source.id}/parts/${String(part)}`;
  }
  const [accountId, id, secret] = source.token.split('.');
  return `/v2/replays/${accountId ?? ''}/${id ?? ''}/${secret ?? ''}/parts/${String(part)}`;
};

/**
 * One part of a game, as a replay file: the server sends its frames as
 * the room streams them, and the app's own file format checks them, so it
 * plays as any replay file does.
 */
export const fetchReplayPart = async (
  source: ReplaySource,
  part: number
): Promise<ReplayPart> => {
  const body: unknown = await (
    await send(partPath(source, part), 'GET')
  ).json();
  if (!isRecord(body) || !isRecord(body['replay'])) {
    throw new AccountRequestError(200, 'malformed');
  }
  const replay = body['replay'] as unknown as ProjectedReplayArtifact;
  const file = new TextEncoder().encode(
    await serializeProjectedReplayFile(replay)
  );
  return {
    part: Number(body['part']),
    parts: Number(body['parts']),
    file,
    replayId: String(replay.replayId),
  };
};
