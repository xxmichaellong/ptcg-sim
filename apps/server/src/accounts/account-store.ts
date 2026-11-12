import { isCardBackEmblem } from '@ptcgsim/game-core';

import {
  ACCOUNT_SESSION_LIFETIME_MS,
  ACCOUNT_SESSION_RENEWAL_MS,
} from './account-session.js';

/**
 * One account's own storage (ADR-052): its profile, the sign-in methods
 * that lead to it, and its sessions, in the account's Durable Object.
 * Every change is authorized by a session in the same call, so checking
 * and acting can't come apart.
 */

export const ACCOUNT_PROVIDERS = ['google', 'discord', 'test'] as const;
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number];

export const isAccountProvider = (value: unknown): value is AccountProvider =>
  (ACCOUNT_PROVIDERS as readonly unknown[]).includes(value);

export const MAX_ACCOUNT_NAME_LENGTH = 32;
const MAX_LABEL_LENGTH = 128;
/** The most sessions (devices) one account keeps; the oldest goes. */
export const MAX_ACCOUNT_SESSIONS = 20;

/** An avatar: the name's initial, or a card-back emblem ("pokemon-25"). */
export type AccountAvatar = 'initials' | `emblem:${string}`;

export const isAccountAvatar = (value: unknown): value is AccountAvatar =>
  value === 'initials' ||
  (typeof value === 'string' &&
    value.startsWith('emblem:') &&
    value !== 'emblem:none' &&
    isCardBackEmblem(value.slice('emblem:'.length)));

/** A name as an account keeps it: trimmed, bounded, never empty. */
export const accountName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(/\s+/gu, ' ').trim();
  if (name.length === 0) return undefined;
  return [...name].slice(0, MAX_ACCOUNT_NAME_LENGTH).join('');
};

export interface SignInIdentity {
  readonly provider: AccountProvider;
  /** The provider's own id for the person: Google's `sub`, Discord's id. */
  readonly subject: string;
  /** What the person knows it by: an email address or a username. */
  readonly label: string;
  /** The name the provider gives, for a new account. */
  readonly name: string;
}

export interface AccountMethodView {
  readonly provider: AccountProvider;
  readonly label: string;
  readonly linkedAt: number;
}

export interface AccountView {
  readonly id: string;
  readonly name: string;
  readonly avatar: AccountAvatar;
  readonly createdAt: number;
  readonly methods: readonly AccountMethodView[];
  /** The method this session signed in with. */
  readonly sessionProvider: AccountProvider;
}

export interface NewSession {
  readonly secretHash: string;
  readonly now: number;
}

export type SignInOutcome =
  | { readonly kind: 'signed_in'; readonly created: boolean }
  /** The account doesn't have that method (any longer). */
  | { readonly kind: 'not_linked' };

export type LinkOutcome =
  | { readonly kind: 'linked'; readonly view: AccountView }
  | { readonly kind: 'signed_out' }
  /** The account already has another id at this provider. */
  | { readonly kind: 'provider_taken' };

export type UnlinkOutcome =
  | { readonly kind: 'removed'; readonly subject: string }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'last_method' };

/** The SQL the store needs of a Durable Object's storage. */
export interface AccountSql {
  exec(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): Record<string, unknown>[] };
}

interface SessionRow {
  readonly provider: AccountProvider;
  readonly usedAt: number;
  readonly expiresAt: number;
}

export class AccountStoreSql {
  private made = false;

  constructor(private readonly sql: AccountSql) {}

  /**
   * Whether the account's tables exist. Only a sign-in makes them, so a
   * request naming an account that was never made writes nothing.
   */
  private tables(create: boolean): boolean {
    if (this.made) return true;
    const [found] = this.sql
      .exec(
        `SELECT COUNT(*) AS n FROM sqlite_master
         WHERE type = 'table' AND name IN ('profile', 'sign_in_method', 'session')`
      )
      .toArray();
    if (Number(found?.['n']) === 3) {
      this.made = true;
      return true;
    }
    if (!create) return false;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS profile (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         avatar TEXT NOT NULL,
         created INTEGER NOT NULL
       )`
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS sign_in_method (
         provider TEXT PRIMARY KEY,
         subject TEXT NOT NULL,
         label TEXT NOT NULL,
         linked INTEGER NOT NULL
       )`
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS session (
         hash TEXT PRIMARY KEY,
         provider TEXT NOT NULL,
         created INTEGER NOT NULL,
         used INTEGER NOT NULL,
         expires INTEGER NOT NULL
       )`
    );
    this.made = true;
    return true;
  }

  private profile():
    | {
        readonly id: string;
        readonly name: string;
        readonly avatar: AccountAvatar;
        readonly createdAt: number;
      }
    | undefined {
    if (!this.tables(false)) return undefined;
    const [row] = this.sql
      .exec('SELECT id, name, avatar, created FROM profile LIMIT 1')
      .toArray();
    if (!row) return undefined;
    const avatar = row['avatar'];
    return {
      id: String(row['id']),
      name: String(row['name']),
      avatar: isAccountAvatar(avatar) ? avatar : 'initials',
      createdAt: Number(row['created']),
    };
  }

  private methods(): (AccountMethodView & { readonly subject: string })[] {
    if (!this.tables(false)) return [];
    return this.sql
      .exec(
        'SELECT provider, subject, label, linked FROM sign_in_method ORDER BY linked'
      )
      .toArray()
      .flatMap((row) => {
        const provider = row['provider'];
        return isAccountProvider(provider)
          ? [
              {
                provider,
                subject: String(row['subject']),
                label: String(row['label']),
                linkedAt: Number(row['linked']),
              },
            ]
          : [];
      });
  }

  private session(secretHash: string): SessionRow | undefined {
    if (!this.tables(false)) return undefined;
    const [row] = this.sql
      .exec(
        'SELECT provider, used, expires FROM session WHERE hash = ?',
        secretHash
      )
      .toArray();
    if (!row) return undefined;
    const provider = row['provider'];
    if (!isAccountProvider(provider)) return undefined;
    return {
      provider,
      usedAt: Number(row['used']),
      expiresAt: Number(row['expires']),
    };
  }

  private addSession(
    provider: AccountProvider,
    { secretHash, now }: NewSession
  ): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO session (hash, provider, created, used, expires)
       VALUES (?, ?, ?, ?, ?)`,
      secretHash,
      provider,
      now,
      now,
      now + ACCOUNT_SESSION_LIFETIME_MS
    );
    this.sql.exec('DELETE FROM session WHERE expires <= ?', now);
    this.sql.exec(
      `DELETE FROM session WHERE hash NOT IN (
         SELECT hash FROM session ORDER BY used DESC LIMIT ?
       )`,
      MAX_ACCOUNT_SESSIONS
    );
  }

  private view(provider: AccountProvider): AccountView | undefined {
    const profile = this.profile();
    if (!profile) return undefined;
    return {
      ...profile,
      methods: this.methods().map(({ provider, label, linkedAt }) => ({
        provider,
        label,
        linkedAt,
      })),
      sessionProvider: provider,
    };
  }

  /**
   * Signs in with a method this account has, or creates the account with it
   * when there is no account here yet (its sign-in record already points
   * here). A method the account no longer has signs nobody in.
   */
  signIn(
    accountId: string,
    identity: SignInIdentity,
    session: NewSession
  ): SignInOutcome {
    this.tables(true);
    const profile = this.profile();
    const label = identity.label.slice(0, MAX_LABEL_LENGTH);
    if (!profile) {
      this.sql.exec(
        'INSERT INTO profile (id, name, avatar, created) VALUES (?, ?, ?, ?)',
        accountId,
        accountName(identity.name) ?? 'Player',
        'initials',
        session.now
      );
      this.sql.exec(
        `INSERT INTO sign_in_method (provider, subject, label, linked)
         VALUES (?, ?, ?, ?)`,
        identity.provider,
        identity.subject,
        label,
        session.now
      );
      this.addSession(identity.provider, session);
      return { kind: 'signed_in', created: true };
    }
    const method = this.methods().find(
      (entry) => entry.provider === identity.provider
    );
    if (method?.subject !== identity.subject) return { kind: 'not_linked' };
    if (method.label !== label) {
      this.sql.exec(
        'UPDATE sign_in_method SET label = ? WHERE provider = ?',
        label,
        identity.provider
      );
    }
    this.addSession(identity.provider, session);
    return { kind: 'signed_in', created: false };
  }

  /**
   * The account a session is signed in to, renewing the session when it was
   * last renewed a day or more ago. An expired session is removed.
   */
  read(secretHash: string, now: number): AccountView | undefined {
    const session = this.session(secretHash);
    if (!session) return undefined;
    if (session.expiresAt <= now) {
      this.sql.exec('DELETE FROM session WHERE hash = ?', secretHash);
      return undefined;
    }
    const view = this.view(session.provider);
    if (!view) return undefined;
    if (now - session.usedAt >= ACCOUNT_SESSION_RENEWAL_MS) {
      this.sql.exec(
        'UPDATE session SET used = ?, expires = ? WHERE hash = ?',
        now,
        now + ACCOUNT_SESSION_LIFETIME_MS,
        secretHash
      );
    }
    return view;
  }

  signOut(secretHash: string): void {
    if (!this.tables(false)) return;
    this.sql.exec('DELETE FROM session WHERE hash = ?', secretHash);
  }

  /**
   * Who this account is to another player (ADR-055): its id, name and
   * avatar, with no session. Nothing for an account never made.
   */
  publicProfile():
    | {
        readonly id: string;
        readonly name: string;
        readonly avatar: AccountAvatar;
      }
    | undefined {
    const profile = this.profile();
    return profile
      ? { id: profile.id, name: profile.name, avatar: profile.avatar }
      : undefined;
  }

  /** Changes the name and/or avatar; unchanged values write nothing. */
  update(
    secretHash: string,
    now: number,
    change: { readonly name?: string; readonly avatar?: AccountAvatar }
  ): AccountView | undefined {
    const view = this.read(secretHash, now);
    if (!view) return undefined;
    const name = change.name === undefined ? undefined : accountName(change.name);
    if (name !== undefined && name !== view.name) {
      this.sql.exec('UPDATE profile SET name = ?', name);
    }
    if (change.avatar !== undefined && change.avatar !== view.avatar) {
      this.sql.exec('UPDATE profile SET avatar = ?', change.avatar);
    }
    return this.view(view.sessionProvider);
  }

  /** Adds a method to the signed-in account, its record already claimed. */
  link(
    secretHash: string,
    now: number,
    identity: SignInIdentity
  ): LinkOutcome {
    const view = this.read(secretHash, now);
    if (!view) return { kind: 'signed_out' };
    const existing = this.methods().find(
      (entry) => entry.provider === identity.provider
    );
    if (existing && existing.subject !== identity.subject) {
      return { kind: 'provider_taken' };
    }
    if (!existing) {
      this.sql.exec(
        `INSERT INTO sign_in_method (provider, subject, label, linked)
         VALUES (?, ?, ?, ?)`,
        identity.provider,
        identity.subject,
        identity.label.slice(0, MAX_LABEL_LENGTH),
        now
      );
    }
    const linked = this.view(view.sessionProvider);
    return linked ? { kind: 'linked', view: linked } : { kind: 'signed_out' };
  }

  /**
   * Whether this account still has that id at that provider. Answers only
   * yes or no, so a record pointing here can be found stale.
   */
  holds(provider: AccountProvider, subject: string): boolean {
    return (
      this.profile() !== undefined &&
      this.methods().some(
        (entry) => entry.provider === provider && entry.subject === subject
      )
    );
  }

  /** Removes a method, never the last one. */
  unlink(
    secretHash: string,
    now: number,
    provider: AccountProvider
  ): UnlinkOutcome {
    const view = this.read(secretHash, now);
    if (!view) return { kind: 'signed_out' };
    const methods = this.methods();
    const method = methods.find((entry) => entry.provider === provider);
    if (!method) return { kind: 'missing' };
    if (methods.length < 2) return { kind: 'last_method' };
    this.sql.exec('DELETE FROM sign_in_method WHERE provider = ?', provider);
    return { kind: 'removed', subject: method.subject };
  }

  /** Every method's provider and id, for deleting the account. */
  signIns(
    secretHash: string,
    now: number
  ):
    | {
        readonly accountId: string;
        readonly methods: readonly {
          readonly provider: AccountProvider;
          readonly subject: string;
        }[];
      }
    | undefined {
    const view = this.read(secretHash, now);
    if (!view) return undefined;
    return {
      accountId: view.id,
      methods: this.methods().map(({ provider, subject }) => ({
        provider,
        subject,
      })),
    };
  }
}
