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
import type { FriendAction } from './friends-http.js';

/** What an account's object reaches of the Worker (ADR-055). */
interface AccountObjectEnv {
  readonly PTCG_ACCOUNT: DurableObjectNamespace<PtcgAccount>;
}

/** One account (ADR-052), by its id: its profile, methods and sessions. */
export class PtcgAccount
  extends DurableObject<Env>
  implements AccountObject
{
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
        (this.env as unknown as AccountObjectEnv).PTCG_ACCOUNT.getByName(
          id
        ) as unknown as FriendPeer
    );
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
    if (!this.store.read(secretHash, now)) return false;
    // Every friend and requester forgets it first (ADR-055).
    await this.graph.forget();
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

  /** The player's own Friends sheet; null signed out. */
  async friends(secretHash: string, now: number): Promise<FriendsView | null> {
    const view = this.store.read(secretHash, now);
    if (!view) return null;
    return friendsView(this.friendRows, recentPlayers(this.replays.list(), view.id));
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
    return {
      answer,
      friends: friendsView(
        this.friendRows,
        recentPlayers(this.replays.list(), view.id)
      ),
    };
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

  async peerRequest(from: unknown, now: number): Promise<PeerRequestAnswer> {
    const profile = readFriendProfile(from);
    if (!profile) return { kind: 'missing' };
    return this.graph.peerRequest(profile, now);
  }

  async peerAccept(from: unknown, now: number): Promise<'friends' | 'gone'> {
    const profile = readFriendProfile(from);
    return profile ? this.graph.peerAccept(profile, now) : 'gone';
  }

  async peerDrop(fromId: string, states: readonly FriendState[]): Promise<void> {
    this.graph.peerDrop(fromId, states);
  }

  async peerProfile(from: unknown): Promise<void> {
    const profile = readFriendProfile(from);
    if (profile) this.graph.peerProfile(profile);
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
