import { DatabaseSync } from 'node:sqlite';

import type {
  AccountHttpDependencies,
  AccountObject,
  SignInRecordObject,
} from './account-http.js';
import { AccountStoreSql, type AccountSql } from './account-store.js';
import { SignInRecordCustody, type SignInRecord } from './sign-in-record.js';
import type { Fetch, SignInConfiguration } from './sign-in-providers.js';

/** A Durable Object's `sql.exec`, over Node's SQLite. */
export const memorySql = (): AccountSql & {
  readonly count: (table: string) => number;
} => {
  const db = new DatabaseSync(':memory:');
  return {
    exec: (query, ...bindings) => {
      const statement = db.prepare(query);
      if (/^\s*select/iu.test(query)) {
        const rows = statement.all(...(bindings as never[])) as Record<
          string,
          unknown
        >[];
        return { toArray: () => rows };
      }
      statement.run(...(bindings as never[]));
      return { toArray: () => [] };
    },
    count: (table) =>
      Number(
        (
          db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
            n: number;
          }
        ).n
      ),
  };
};

/** Accounts and sign-in records in memory, as the Worker's objects. */
export const memoryAccounts = (
  configuration: SignInConfiguration = { test: true },
  fetch: Fetch = () => Promise.reject(new Error('no network in tests'))
) => {
  const stores = new Map<string, AccountStoreSql>();
  const records = new Map<string, SignInRecord>();
  let clock = 1_800_000_000_000;
  const storeOf = (accountId: string): AccountStoreSql => {
    let store = stores.get(accountId);
    if (!store) {
      store = new AccountStoreSql(memorySql());
      stores.set(accountId, store);
    }
    return store;
  };
  const account = (accountId: string): AccountObject => ({
    signIn: async (id, identity, session) =>
      storeOf(accountId).signIn(id, identity, session),
    read: async (hash, now) => storeOf(accountId).read(hash, now) ?? null,
    update: async (hash, now, change) =>
      storeOf(accountId).update(hash, now, change) ?? null,
    signOut: async (hash) => storeOf(accountId).signOut(hash),
    holds: async (provider, subject) =>
      storeOf(accountId).holds(provider, subject),
    link: async (hash, now, identity) =>
      storeOf(accountId).link(hash, now, identity),
    unlink: async (hash, now, provider) =>
      storeOf(accountId).unlink(hash, now, provider),
    signIns: async (hash, now) =>
      storeOf(accountId).signIns(hash, now) ?? null,
    erase: async (hash, now) => {
      if (!storeOf(accountId).read(hash, now)) return false;
      stores.delete(accountId);
      return true;
    },
  });
  const signInRecord = (provider: string, subject: string): SignInRecordObject => {
    const key = `${provider}:${subject}`;
    const custody = new SignInRecordCustody({
      get: async () => records.get(key),
      put: async (record) => {
        records.set(key, record);
      },
      delete: async () => {
        records.delete(key);
      },
    });
    return {
      claim: (accountId, now) => custody.claim(accountId, now),
      release: (accountId) => custody.release(accountId),
    };
  };
  const dependencies: AccountHttpDependencies = {
    account,
    signInRecord,
    configuration,
    fetch,
    now: () => clock,
    rateLimit: async () => ({ allowed: true, retryAfterSeconds: 60 }),
  };
  return {
    dependencies,
    stores,
    records,
    advance: (ms: number) => {
      clock += ms;
    },
  };
};
