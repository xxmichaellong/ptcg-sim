import { DurableObject } from 'cloudflare:workers';

import type { AccountObject, SignInRecordObject } from './account-http.js';
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

/** One account (ADR-052), by its id: its profile, methods and sessions. */
export class PtcgAccount
  extends DurableObject<Env>
  implements AccountObject
{
  private store = new AccountStoreSql(this.ctx.storage.sql);
  private synced = new AccountSyncSql(this.ctx.storage.sql);
  private saved = new AccountSavesSql(this.ctx.storage.sql);

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
    return this.store.update(secretHash, now, change) ?? null;
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
    await this.ctx.storage.deleteAll();
    this.store = new AccountStoreSql(this.ctx.storage.sql);
    this.synced = new AccountSyncSql(this.ctx.storage.sql);
    this.saved = new AccountSavesSql(this.ctx.storage.sql);
    return true;
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
