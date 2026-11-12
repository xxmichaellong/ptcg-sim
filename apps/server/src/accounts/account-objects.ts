import { ROOM_ALIAS_PATTERN } from '@ptcgsim/protocol';
import { DurableObject } from 'cloudflare:workers';

import { WebCryptoAuthoritySource } from '../authority-crypto.js';
import type { ReplayFiling } from '../replay-archive.js';
import type { AccountObject, SignInRecordObject } from './account-http.js';
import {
  AccountReplaysSql,
  projectReplayPart,
  type AccountReplayPart,
  type ReplayListing,
  type StarOutcome,
} from './account-replays.js';
import {
  AccountStoreSql,
  type AccountAvatar,
  type AccountProvider,
  type AccountView,
  type LinkOutcome,
  type NewSession,
  type SignInIdentity,
  type SignInOutcome,
  type UnlinkOutcome,
} from './account-store.js';
import { AccountSavesSql, type AccountSave } from './account-saves.js';
import {
  AccountSyncSql,
  type SyncAnswer,
  type SyncRequest,
} from './account-sync.js';
import { SignInRecordCustody, type SignInRecord } from './sign-in-record.js';
import {
  AccountFriendsSql,
  FriendGraph,
  friendsView,
  readFriendProfile,
  recentPlayers,
  type FriendAnswer,
  type FriendPeer,
  type FriendProfile,
  type FriendState,
  type FriendsView,
  type PeerRequestAnswer,
} from './account-friends.js';
import type {
  FriendAction,
  InviteKind,
  InviteOutcome,
} from './friends-http.js';
import { APPEAR_OFFLINE_SETTING } from './account-friends.js';
import {
  LIVE_TAG,
  MAX_LIVE_TABS,
  readLiveAttachment,
  readLiveWhere,
  samePresence,
  tabsPresence,
  type LiveAttachment,
} from './account-live.js';
import { readSessionToken, sha256Hex } from './account-session.js';
import {
  PresenceHub,
  readPresenceReport,
  type PresenceView,
} from './presence-hub.js';

/** What an account's object reaches of the Worker (ADR-055). */
interface AccountObjectEnv {
  readonly PTCG_ACCOUNT: DurableObjectNamespace<PtcgAccount>;
  readonly PTCG_PRESENCE: DurableObjectNamespace<PtcgPresence>;
}

/** The one presence hub (ADR-055). */
export const PRESENCE_HUB_NAME = 'hub';

/** An invite or an ask lasts this long on the friend's screen. */
export const INVITE_LIFETIME_MS = 30 * 60 * 1000;
/** One invite or ask a second per account. */
const INVITE_SPACING_MS = 1000;

/** One account (ADR-052), by its id: its profile, methods and sessions. */
export class PtcgAccount
  extends DurableObject<Env>
  implements AccountObject
{
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A tab's keep-alive is answered without waking the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    );
  }

  private get objects(): AccountObjectEnv {
    return this.env as unknown as AccountObjectEnv;
  }

  private store = new AccountStoreSql(this.ctx.storage.sql);
  private synced = new AccountSyncSql(this.ctx.storage.sql);
  private saved = new AccountSavesSql(this.ctx.storage.sql);
  private friendRows = new AccountFriendsSql(this.ctx.storage.sql);
  private graph = this.makeGraph();

  private makeGraph(): FriendGraph {
    return new FriendGraph(
      this.friendRows,
      () => this.store.publicProfile(),
      (id) =>
        this.objects.PTCG_ACCOUNT.getByName(id) as unknown as FriendPeer
    );
  }

  // ---- Live tabs and presence (ADR-055 step 2) -------------------------

  private hub() {
    return this.objects.PTCG_PRESENCE.getByName(PRESENCE_HUB_NAME);
  }

  /** The tabs open now, but `leaving`. */
  private tabs(leaving?: WebSocket): LiveAttachment[] {
    return this.ctx
      .getWebSockets(LIVE_TAG)
      .filter((socket) => socket !== leaving)
      .flatMap((socket) => readLiveAttachment(socket.deserializeAttachment()) ?? []);
  }

  private broadcast(message: unknown, only?: WebSocket): void {
    const text = JSON.stringify(message);
    for (const socket of only ? [only] : this.ctx.getWebSockets(LIVE_TAG)) {
      try {
        socket.send(text);
      } catch {
        // Closing: its close says so.
      }
    }
  }

  private friendIds(): string[] {
    return this.friendRows
      .rows()
      .filter((row) => row.state === 'friend')
      .map((row) => row.id);
  }

  /** Tells the hub where the account is now, and its tabs where friends are. */
  private async report(leaving?: WebSocket): Promise<void> {
    const me = this.store.publicProfile();
    if (!me) return;
    const { state, room } = tabsPresence(this.tabs(leaving));
    const report = readPresenceReport({
      state,
      ...(room ? { room } : {}),
      hidden: this.friendRows.setting(APPEAR_OFFLINE_SETTING) === 'on',
    });
    if (!report) return;
    const friends = await this.hub().update(
      me.id,
      report,
      this.friendIds(),
      Date.now()
    );
    this.broadcast({ type: 'presence', friends });
  }

  /** Friends' presence as the hub has it. */
  private async presence(): Promise<Record<string, PresenceView>> {
    const friends = this.friendIds();
    if (friends.length === 0) return {};
    try {
      return await this.hub().read(friends, Date.now());
    } catch {
      return {};
    }
  }

  /** A tab opens its live line: `/v2/account/live`, signed in. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 426 });
    }
    const token = readSessionToken(request);
    const view = token
      ? this.store.read(await sha256Hex(token.secret), Date.now())
      : undefined;
    if (!token || !view || view.id !== token.accountId) {
      return new Response(null, { status: 401 });
    }
    // The oldest tab gives way past the most kept.
    const open = this.ctx.getWebSockets(LIVE_TAG);
    for (const old of open.slice(0, Math.max(0, open.length - MAX_LIVE_TABS + 1))) {
      try {
        old.close(1008, 'too many tabs');
      } catch {
        // Gone already.
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [LIVE_TAG]);
    server.serializeAttachment({
      tab: crypto.randomUUID(),
      where: { kind: 'none' },
      greeted: false,
    } satisfies LiveAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    if (typeof message !== 'string' || message.length > 1024) return;
    let data: unknown;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    const type: unknown = Reflect.get(Object(data), 'type');
    if (type !== 'hello' && type !== 'where') return;
    const where = readLiveWhere(Reflect.get(Object(data), 'where'));
    const attachment = readLiveAttachment(socket.deserializeAttachment());
    if (!where || !attachment) return;
    const before = tabsPresence(this.tabs());
    socket.serializeAttachment({
      ...attachment,
      where,
      greeted: true,
    } satisfies LiveAttachment);
    const after = tabsPresence(this.tabs());
    if (!samePresence(before, after)) {
      await this.report();
    } else if (type === 'hello') {
      // Another tab: it hears where friends are now.
      this.broadcast({ type: 'presence', friends: await this.presence() }, socket);
    }
  }

  override async webSocketClose(
    socket: WebSocket,
    code: number
  ): Promise<void> {
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, 'closed');
    } catch {
      // Already closed.
    }
    await this.tabClosed(socket);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.tabClosed(socket);
  }

  private async tabClosed(socket: WebSocket): Promise<void> {
    const closing = readLiveAttachment(socket.deserializeAttachment());
    const others = this.tabs(socket);
    const before = tabsPresence(closing ? [...others, closing] : others);
    if (!samePresence(before, tabsPresence(others))) await this.report(socket);
  }

  /** From the hub: a friend's presence changed. Not a player's call. */
  async friendPresence(from: string, view: unknown): Promise<void> {
    if (this.friendRows.row(from)?.state !== 'friend') return;
    this.broadcast({ type: 'presence', id: from, view });
  }

  // ---- Playing together (ADR-055 step 3) -------------------------------

  private lastInviteAt = 0;

  /**
   * Invites a friend to the room this account plays in, or asks to join
   * theirs, by the player; null signed out. The room is the one its own
   * tabs say they play in, never one the request names.
   */
  async inviteFriend(
    secretHash: string,
    now: number,
    otherId: string,
    kind: InviteKind,
    answering: boolean
  ): Promise<InviteOutcome | null> {
    const view = this.store.read(secretHash, now);
    const me = this.store.publicProfile();
    if (!view || !me) return null;
    if (this.friendRows.row(otherId)?.state !== 'friend') return 'not_friends';
    if (now - this.lastInviteAt < INVITE_SPACING_MS) return 'slow_down';
    this.lastInviteAt = now;
    let room: string | undefined;
    if (kind === 'invite') {
      const here = tabsPresence(this.tabs());
      if (here.state !== 'playing' || !here.room) return 'not_in_room';
      room = here.room;
    }
    try {
      return await this.objects.PTCG_ACCOUNT.getByName(otherId).peerInvite(
        me,
        kind,
        room ?? null,
        answering,
        now
      );
    } catch {
      return 'failed';
    }
  }

  /**
   * From a friend's object: an invite or an ask, to this account's open
   * tabs. Nothing is kept: with no tab open, it is "offline".
   */
  async peerInvite(
    from: unknown,
    kind: InviteKind,
    room: string | null,
    answering: boolean,
    now: number
  ): Promise<InviteOutcome> {
    const profile = readFriendProfile(from);
    if (!profile || (kind !== 'invite' && kind !== 'ask')) return 'failed';
    if (
      this.friendRows.row(profile.id)?.state !== 'friend' ||
      this.friendRows.isBlocked(profile.id)
    ) {
      return 'not_friends';
    }
    if (kind === 'invite' && (!room || !ROOM_ALIAS_PATTERN.test(room))) {
      return 'failed';
    }
    if (this.ctx.getWebSockets(LIVE_TAG).length === 0) return 'offline';
    this.broadcast({
      type: kind,
      from: profile,
      ...(kind === 'invite' && room ? { room } : {}),
      answering: answering === true,
      sentAt: now,
      expiresAt: now + INVITE_LIFETIME_MS,
    });
    return 'sent';
  }

  /** From the hub: whether any tab is still open. Not a player's call. */
  async isLive(): Promise<boolean> {
    return this.ctx.getWebSockets(LIVE_TAG).length > 0;
  }

  /** Appear offline, by the player (ADR-055); null signed out. */
  async setAppearOffline(
    secretHash: string,
    now: number,
    hidden: boolean
  ): Promise<(FriendsView & { readonly presence: Record<string, PresenceView> }) | null> {
    const view = this.store.read(secretHash, now);
    if (!view) return null;
    this.friendRows.setSetting(APPEAR_OFFLINE_SETTING, hidden ? 'on' : undefined);
    // Friends hear at once if a tab is open; else on the next one.
    if (this.ctx.getWebSockets(LIVE_TAG).length > 0) await this.report();
    return {
      ...friendsView(this.friendRows, recentPlayers(this.replays.list(), view.id)),
      presence: await this.presence(),
    };
  }

  async signIn(
    accountId: string,
    identity: SignInIdentity,
    session: NewSession
  ): Promise<SignInOutcome> {
    return this.store.signIn(accountId, identity, session);
  }

  async read(secretHash: string, now: number): Promise<AccountView | null> {
    return this.store.read(secretHash, now) ?? null;
  }

  async update(
    secretHash: string,
    now: number,
    change: { readonly name?: string; readonly avatar?: AccountAvatar }
  ): Promise<AccountView | null> {
    const before = this.store.publicProfile();
    const view = this.store.update(secretHash, now, change) ?? null;
    // Friends see the new name or avatar (ADR-055): renames are rare.
    if (
      view &&
      before &&
      (before.name !== view.name || before.avatar !== view.avatar)
    ) {
      await this.graph.announceProfile();
    }
    return view;
  }

  async signOut(secretHash: string): Promise<void> {
    this.store.signOut(secretHash);
  }

  async holds(provider: AccountProvider, subject: string): Promise<boolean> {
    return this.store.holds(provider, subject);
  }

  async link(
    secretHash: string,
    now: number,
    identity: SignInIdentity
  ): Promise<LinkOutcome> {
    return this.store.link(secretHash, now, identity);
  }

  async unlink(
    secretHash: string,
    now: number,
    provider: AccountProvider
  ): Promise<UnlinkOutcome> {
    return this.store.unlink(secretHash, now, provider);
  }

  async signIns(secretHash: string, now: number) {
    return this.store.signIns(secretHash, now) ?? null;
  }

  /** Deletes everything the account keeps, if the session is still good. */
  async erase(secretHash: string, now: number): Promise<boolean> {
    const view = this.store.read(secretHash, now);
    if (!view) return false;
    // Every friend and requester forgets it first, and the hub (ADR-055).
    await this.graph.forget();
    for (const socket of this.ctx.getWebSockets(LIVE_TAG)) {
      try {
        socket.close(1000, 'account deleted');
      } catch {
        // Gone already.
      }
    }
    await this.hub()
      .forget(view.id)
      .catch(() => undefined);
    await this.ctx.storage.deleteAll();
    this.store = new AccountStoreSql(this.ctx.storage.sql);
    this.synced = new AccountSyncSql(this.ctx.storage.sql);
    this.saved = new AccountSavesSql(this.ctx.storage.sql);
    this.replays = new AccountReplaysSql(this.ctx.storage.sql);
    this.friendRows = new AccountFriendsSql(this.ctx.storage.sql);
    this.graph = this.makeGraph();
    return true;
  }

  // ---- Friends (ADR-055) ----------------------------------------------

  /** The list as the sheet shows it, with friends' presence. */
  private async listFor(accountId: string): Promise<FriendsView> {
    return {
      ...friendsView(
        this.friendRows,
        recentPlayers(this.replays.list(), accountId)
      ),
      presence: await this.presence(),
    };
  }

  /** The player's own Friends sheet; null signed out. */
  async friends(secretHash: string, now: number): Promise<FriendsView | null> {
    const view = this.store.read(secretHash, now);
    return view ? this.listFor(view.id) : null;
  }

  /** A change to one friendship, by the player; null signed out. */
  async changeFriend(
    secretHash: string,
    now: number,
    otherId: string,
    action: FriendAction
  ): Promise<{
    readonly answer: FriendAnswer;
    readonly friends: FriendsView;
  } | null> {
    const view = this.store.read(secretHash, now);
    if (!view) return null;
    const answer = await this.friendChange(otherId, action, now);
    // The player's other tabs read the list again.
    this.broadcast({ type: 'friends' });
    return { answer, friends: await this.listFor(view.id) };
  }

  private friendChange(
    otherId: string,
    action: FriendAction,
    now: number
  ): Promise<FriendAnswer> | FriendAnswer {
    switch (action) {
      case 'request':
        return this.graph.request(otherId, now);
      case 'accept':
        return this.graph.accept(otherId, now);
      case 'decline':
        return this.graph.decline(otherId);
      case 'cancel':
        return this.graph.cancel(otherId, now);
      case 'remove':
        return this.graph.remove(otherId);
      case 'block':
        return this.graph.block(otherId, now);
      case 'unblock':
        return this.graph.unblock(otherId);
    }
  }

  /** Who this account is to another player; null if it was never made. */
  async publicProfile(): Promise<FriendProfile | null> {
    return this.store.publicProfile() ?? null;
  }

  // Asked by another account's object, never by a player.

  // Each tells the player's open tabs to read the list again.

  async peerRequest(from: unknown, now: number): Promise<PeerRequestAnswer> {
    const profile = readFriendProfile(from);
    if (!profile) return { kind: 'missing' };
    const answer = this.graph.peerRequest(profile, now);
    this.broadcast({ type: 'friends' });
    return answer;
  }

  async peerAccept(from: unknown, now: number): Promise<'friends' | 'gone'> {
    const profile = readFriendProfile(from);
    const answer = profile ? this.graph.peerAccept(profile, now) : 'gone';
    this.broadcast({ type: 'friends' });
    return answer;
  }

  async peerDrop(fromId: string, states: readonly FriendState[]): Promise<void> {
    this.graph.peerDrop(fromId, states);
    this.broadcast({ type: 'friends' });
  }

  async peerProfile(from: unknown): Promise<void> {
    const profile = readFriendProfile(from);
    if (profile) this.graph.peerProfile(profile);
    this.broadcast({ type: 'friends' });
  }

  /** A device's changes and what changed since it last asked (step 2). */
  async sync(
    secretHash: string,
    now: number,
    request: SyncRequest
  ): Promise<SyncAnswer | null> {
    if (!this.store.read(secretHash, now)) return null;
    return this.synced.sync(request, now);
  }

  /** The saved games, for the player's own session only. */
  async saves(
    secretHash: string,
    now: number
  ): Promise<readonly AccountSave[] | null> {
    if (!this.store.read(secretHash, now)) return null;
    return this.saved.list(now);
  }

  async putSave(
    secretHash: string,
    now: number,
    save: AccountSave
  ): Promise<boolean> {
    if (!this.store.read(secretHash, now)) return false;
    this.saved.put(save);
    return true;
  }

  async removeSave(
    secretHash: string,
    now: number,
    id: string
  ): Promise<boolean> {
    if (!this.store.read(secretHash, now)) return false;
    this.saved.remove(id);
    return true;
  }

  // ---- Replays (ADR-053) ----------------------------------------------

  private replays = new AccountReplaysSql(this.ctx.storage.sql);
  private readonly opaqueIds = new WebCryptoAuthoritySource();

  /** From a room: a signed-in seat's game. Not a player's call. */
  async fileReplay(filing: ReplayFiling): Promise<boolean> {
    return this.replays.file(filing, Date.now());
  }

  async listReplays(
    secretHash: string,
    now: number
  ): Promise<readonly ReplayListing[] | null> {
    if (!this.store.read(secretHash, now)) return null;
    return this.replays.list();
  }

  async starReplay(
    secretHash: string,
    now: number,
    id: string,
    starred: boolean
  ): Promise<StarOutcome | null> {
    if (!this.store.read(secretHash, now)) return null;
    return this.replays.star(id, starred);
  }

  async deleteReplay(
    secretHash: string,
    now: number,
    id: string
  ): Promise<boolean | null> {
    if (!this.store.read(secretHash, now)) return null;
    return this.replays.remove(id);
  }

  /** Shares (the secret, the same each time) or unshares; null signed out. */
  async shareReplay(
    secretHash: string,
    now: number,
    id: string,
    shared: boolean
  ): Promise<{ readonly found: boolean; readonly secret?: string } | null> {
    if (!this.store.read(secretHash, now)) return null;
    if (!shared) return { found: this.replays.unshare(id) };
    const secret = this.replays.share(id);
    return secret ? { found: true, secret } : { found: false };
  }

  /** A part from the player's own seat; 'missing' if there's no such. */
  async replayPart(
    secretHash: string,
    now: number,
    id: string,
    part: number
  ): Promise<AccountReplayPart | 'missing' | null> {
    if (!this.store.read(secretHash, now)) return null;
    const found = this.replays.record(id);
    if (!found) return 'missing';
    return (
      (await projectReplayPart(
        found.body,
        part,
        'seat',
        found.listing,
        this.opaqueIds
      )) ?? 'missing'
    );
  }

  /** A part through a share link, as a spectator sees it. */
  async sharedReplayPart(
    id: string,
    secret: string,
    part: number
  ): Promise<AccountReplayPart | 'missing'> {
    const found = this.replays.record(id, secret);
    if (!found) return 'missing';
    return (
      (await projectReplayPart(
        found.body,
        part,
        'spectator',
        found.listing,
        this.opaqueIds
      )) ?? 'missing'
    );
  }
}

/**
 * Who is online, for friends (ADR-055 presence-hub.ts): one object, by
 * `PRESENCE_HUB_NAME`, asked only by accounts' objects.
 */
export class PtcgPresence extends DurableObject<Env> {
  private readonly presence = new PresenceHub(this.ctx.storage.sql, {
    push: (to, from, view) =>
      (this.env as unknown as AccountObjectEnv).PTCG_ACCOUNT.getByName(
        to
      ).friendPresence(from, view),
    live: (account) =>
      (this.env as unknown as AccountObjectEnv).PTCG_ACCOUNT.getByName(
        account
      ).isLive(),
  });

  async update(
    account: string,
    report: unknown,
    friends: readonly string[],
    now: number
  ): Promise<Record<string, PresenceView>> {
    const checked = readPresenceReport(report);
    if (!checked) return {};
    return this.presence.update(account, checked, friends, now);
  }

  async read(
    friends: readonly string[],
    now: number
  ): Promise<Record<string, PresenceView>> {
    return this.presence.read(friends, now);
  }

  async forget(account: string): Promise<void> {
    this.presence.forget(account);
  }
}

/** Which account one provider id belongs to (sign-in-record.ts). */
export class PtcgSignIn
  extends DurableObject<Env>
  implements SignInRecordObject
{
  private readonly custody = new SignInRecordCustody({
    get: () => this.ctx.storage.get<SignInRecord>('record'),
    put: (record) => this.ctx.storage.put('record', record),
    delete: async () => {
      await this.ctx.storage.delete('record');
    },
  });

  async claim(accountId: string, now: number): Promise<string> {
    return this.custody.claim(accountId, now);
  }

  async release(accountId: string): Promise<void> {
    return this.custody.release(accountId);
  }
}
