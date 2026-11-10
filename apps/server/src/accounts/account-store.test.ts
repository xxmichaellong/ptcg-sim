import { describe, expect, it } from 'vitest';

import { memorySql } from './accounts.test-support.js';
import {
  AccountStoreSql,
  MAX_ACCOUNT_SESSIONS,
  accountName,
  isAccountAvatar,
  type SignInIdentity,
} from './account-store.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const dawn: SignInIdentity = {
  provider: 'google',
  subject: 'g1',
  label: 'dawn@gmail.example',
  name: 'Dawn',
};

describe("an account's storage", () => {
  it('writes nothing for an account that was never made', () => {
    const sql = memorySql();
    const store = new AccountStoreSql(sql);
    expect(store.read('h', NOW)).toBeUndefined();
    store.signOut('h');
    expect(store.holds('google', 'g1')).toBe(false);
    expect(store.unlink('h', NOW, 'google')).toEqual({ kind: 'signed_out' });
    expect(sql.count('sqlite_master')).toBe(0);
    store.signIn('a_AAAAAAAAAAAAAAAA', dawn, { secretHash: 'h', now: NOW });
    expect(store.read('h', NOW)?.name).toBe('Dawn');
  });

  it('keeps the newest sessions, dropping the oldest past the cap', () => {
    const sql = memorySql();
    const store = new AccountStoreSql(sql);
    for (let i = 0; i <= MAX_ACCOUNT_SESSIONS; i += 1) {
      store.signIn('a_AAAAAAAAAAAAAAAA', dawn, {
        secretHash: `h${String(i)}`,
        now: NOW + i,
      });
    }
    expect(sql.count('session')).toBe(MAX_ACCOUNT_SESSIONS);
    expect(store.read('h0', NOW + 100)).toBeUndefined();
    expect(store.read(`h${String(MAX_ACCOUNT_SESSIONS)}`, NOW + 100)?.name).toBe(
      'Dawn'
    );
  });

  it('writes nothing more for a session read twice in a day', () => {
    const writes: string[] = [];
    const sql = memorySql();
    const store = new AccountStoreSql({
      exec: (query, ...bindings) => {
        if (!/^\s*select/iu.test(query)) writes.push(query.trim().split(/\s/u)[0] ?? '');
        return sql.exec(query, ...bindings);
      },
    });
    store.signIn('a_AAAAAAAAAAAAAAAA', dawn, { secretHash: 'h', now: NOW });
    writes.length = 0;
    store.read('h', NOW + DAY / 2);
    store.read('h', NOW + DAY - 1);
    expect(writes).toEqual([]);
    store.read('h', NOW + DAY);
    expect(writes).toEqual(['UPDATE']);
  });

  it('updates a changed label on sign-in, and names only sensibly', () => {
    const store = new AccountStoreSql(memorySql());
    store.signIn('a_AAAAAAAAAAAAAAAA', dawn, { secretHash: 'h', now: NOW });
    store.signIn(
      'a_AAAAAAAAAAAAAAAA',
      { ...dawn, label: 'dawn@new.example', name: 'Ignored' },
      { secretHash: 'h2', now: NOW }
    );
    expect(store.read('h2', NOW)).toMatchObject({
      name: 'Dawn',
      methods: [{ provider: 'google', label: 'dawn@new.example' }],
    });
    expect(accountName('  a\n  b ')).toBe('a b');
    expect(accountName('x'.repeat(50))).toHaveLength(32);
    expect(accountName('🙂'.repeat(40))).toBe('🙂'.repeat(32));
    expect(isAccountAvatar('emblem:pokemon-1025')).toBe(true);
    expect(isAccountAvatar('emblem:pokemon-99999')).toBe(false);
    expect(isAccountAvatar('emblem:ball-master')).toBe(true);
  });
});
