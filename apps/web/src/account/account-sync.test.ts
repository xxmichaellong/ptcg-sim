import { describe, expect, it } from 'vitest';

import type { SavedDeck } from '../features/deck/deck-library.js';
import type { Preference } from '../preferences/preference-store.js';
import {
  deckHash,
  readSyncState,
  syncOnce,
  type SyncEnvironment,
} from './account-sync.js';

/** The account's rules (apps/server/src/accounts/account-sync.ts), in brief. */
const fakeAccount = () => {
  const records = new Map<
    string,
    {
      kind: string;
      id: string;
      rev: number;
      changedAt: number;
      body: string | null;
    }
  >();
  let rev = 0;
  let floor = 0;
  let requests = 0;
  const send: SyncEnvironment['send'] = async ({ since, changes }) => {
    requests += 1;
    const accepted: { kind: string; id: string; rev: number }[] = [];
    const conflicts: { kind: string; id: string }[] = [];
    for (const change of changes) {
      const key = `${change.kind}:${change.id}`;
      const current = records.get(key);
      if ((current?.rev ?? 0) !== change.base) {
        conflicts.push({ kind: change.kind, id: change.id });
        continue;
      }
      if (change.body === null && !current) continue;
      rev += 1;
      records.set(key, { ...change, rev });
      accepted.push({ kind: change.kind, id: change.id, rev });
    }
    const changed = [...records.values()]
      .filter((record) => record.rev > since)
      .sort((left, right) => left.rev - right.rev);
    return {
      rev,
      reset: since < floor,
      more: false,
      records: changed,
      accepted,
      conflicts,
      refused: [],
    };
  };
  return {
    send,
    records,
    requests: () => requests,
    /** Lets every deletion go, as half a year on. */
    forget: () => {
      for (const [key, record] of records) {
        if (record.body === null) {
          floor = Math.max(floor, record.rev);
          records.delete(key);
        }
      }
    },
  };
};

const deck = (id: string, name: string, updatedAt = 1): SavedDeck => ({
  id,
  name,
  format: 'standard',
  cards: [
    {
      card: {
        id: 'PAL 185',
        name: 'Gardevoir ex',
        category: 'Pokémon',
        image: 'https://images.example/pal-185.png',
      },
      count: 2,
    },
  ] as unknown as SavedDeck['cards'],
  createdAt: 1,
  updatedAt,
});

const PLAYER: Preference<unknown> = {
  key: 'ptcgsim.player.v1',
  defaults: {},
  parse: (value) => value,
  synced: true,
};
const MOTION: Preference<unknown> = {
  key: 'ptcgsim.motion.v1',
  defaults: {},
  parse: (value) => value,
  synced: true,
};

let clock = 1_000;

const device = (account: ReturnType<typeof fakeAccount>) => {
  const decks = new Map<string, SavedDeck>();
  const settings = new Map<string, string>();
  const storage = new Map<string, string>();
  const environment: SyncEnvironment = {
    library: {
      readStored: async () => [...decks.values()],
      receive: (received, removals) => {
        for (const one of received) decks.set(one.id, one);
        for (const id of removals) decks.delete(id);
      },
    },
    store: {
      storedText: (preference) => settings.get(preference.key) ?? null,
      applyStoredText: (preference, text) => {
        if (text === null) settings.delete(preference.key);
        else settings.set(preference.key, text);
        return text;
      },
    },
    synced: () => [PLAYER, MOTION],
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
      removeItem: (key) => void storage.delete(key),
    },
    send: account.send,
    now: () => (clock += 1),
  };
  return {
    environment,
    storage,
    decks,
    settings,
    sync: (pull = true) => syncOnce('a_account', environment, { pull }),
    state: () =>
      readSyncState(
        storage.get('ptcgsim.account-sync.v1') ?? null,
        'a_account'
      ),
    addDeviceDecks: () => {
      const state = readSyncState(
        storage.get('ptcgsim.account-sync.v1') ?? null,
        'a_account'
      );
      storage.set(
        'ptcgsim.account-sync.v1',
        JSON.stringify({ ...state, deviceDecks: [] })
      );
    },
  };
};

it('abandons a response after the signed-in account changes', async () => {
  const account = fakeAccount();
  await account.send({
    expectedAccountId: 'first',
    since: 0,
    changes: [
      {
        kind: 'deck',
        id: 'private',
        base: 0,
        changedAt: 1,
        body: JSON.stringify(deck('private', 'Private')),
      },
    ],
  });
  const local = device(account);
  let current = true;
  let observed: string | undefined;
  const outcome = await syncOnce('first', {
    ...local.environment,
    isCurrent: () => current,
    send: async (request) => {
      observed = request.expectedAccountId;
      const answer = await account.send(request);
      current = false;
      return answer;
    },
  });
  expect(observed).toBe('first');
  expect(outcome).toBeUndefined();
  expect(local.decks.size).toBe(0);
  expect(local.storage.size).toBe(0);
});

describe('account sync on a device', () => {
  it('brings a deck made on one device to the other', async () => {
    const account = fakeAccount();
    const phone = device(account);
    const laptop = device(account);
    await phone.sync();
    await laptop.sync();
    phone.decks.set('d1', deck('d1', 'Gardevoir'));
    await phone.sync(false);
    await laptop.sync();
    expect(laptop.decks.get('d1')?.name).toBe('Gardevoir');
    // In step: nothing more to send, and a change-only sync asks nothing.
    const before = account.requests();
    await laptop.sync(false);
    expect(account.requests()).toBe(before);
  });

  it('asks before adding the decks a device had, then adds them', async () => {
    const account = fakeAccount();
    const borrowed = device(account);
    borrowed.decks.set('mine', deck('mine', 'Not the player’s'));
    await borrowed.sync();
    expect(borrowed.state()?.deviceDecks).toEqual(['mine']);
    expect(account.records.size).toBe(0);
    // A deck made after signing in goes up.
    borrowed.decks.set('new', deck('new', 'Charizard'));
    await borrowed.sync(false);
    expect([...account.records.keys()]).toEqual(['deck:new']);
    borrowed.addDeviceDecks();
    await borrowed.sync(false);
    expect(account.records.has('deck:mine')).toBe(true);
  });

  it('lets the later change win when both devices changed a deck', async () => {
    const account = fakeAccount();
    const phone = device(account);
    const laptop = device(account);
    await phone.sync();
    await laptop.sync();
    phone.decks.set('d1', deck('d1', 'First'));
    await phone.sync(false);
    await laptop.sync();
    phone.decks.set('d1', deck('d1', 'Phone', 10));
    laptop.decks.set('d1', deck('d1', 'Laptop', 20));
    await phone.sync(false);
    await laptop.sync(false);
    await phone.sync();
    expect(phone.decks.get('d1')?.name).toBe('Laptop');
    expect(JSON.parse(account.records.get('deck:d1')!.body!)).toMatchObject({
      name: 'Laptop',
    });
    // The earlier one, arriving second, gives way.
    phone.decks.set('d1', deck('d1', 'Old', 5));
    laptop.decks.set('d1', deck('d1', 'New', 30));
    await laptop.sync(false);
    await phone.sync(false);
    expect(phone.decks.get('d1')?.name).toBe('New');
  });

  it('deletes on every device, and ignores a change to facts alone', async () => {
    const account = fakeAccount();
    const phone = device(account);
    const laptop = device(account);
    await phone.sync();
    await laptop.sync();
    phone.decks.set('d1', deck('d1', 'Gardevoir'));
    await phone.sync(false);
    await laptop.sync();
    // The laptop's catalog adds facts: not the player's change.
    const withFacts = deck('d1', 'Gardevoir');
    laptop.decks.set('d1', {
      ...withFacts,
      factsFrom: '2/2026-11-10',
      cards: withFacts.cards.map((entry) => ({
        ...entry,
        card: { ...entry.card, facts: { stage: 'Stage 2' } },
      })) as unknown as SavedDeck['cards'],
    });
    expect(deckHash(laptop.decks.get('d1')!)).toBe(deckHash(withFacts));
    const before = account.requests();
    await laptop.sync(false);
    expect(account.requests()).toBe(before);
    phone.decks.delete('d1');
    await phone.sync(false);
    await laptop.sync();
    expect(laptop.decks.has('d1')).toBe(false);
  });

  it('gives a new device the account’s settings, then shares its own', async () => {
    const account = fakeAccount();
    const phone = device(account);
    await phone.sync();
    phone.settings.set(PLAYER.key, '{"displayName":"Dawn"}');
    await phone.sync(false);
    const laptop = device(account);
    laptop.settings.set(PLAYER.key, '{"displayName":"Guest"}');
    laptop.settings.set(MOTION.key, '{"reduced":true}');
    await laptop.sync();
    expect(laptop.settings.get(PLAYER.key)).toBe('{"displayName":"Dawn"}');
    // Its own setting the account didn't have went up after the first read.
    await phone.sync();
    expect(phone.settings.get(MOTION.key)).toBe('{"reduced":true}');
  });

  it('reads everything again after being away past the deletions kept', async () => {
    const account = fakeAccount();
    const phone = device(account);
    const laptop = device(account);
    await phone.sync();
    phone.decks.set('d1', deck('d1', 'One'));
    phone.decks.set('d2', deck('d2', 'Two'));
    await phone.sync(false);
    await laptop.sync();
    expect([...laptop.decks.keys()]).toEqual(['d1', 'd2']);
    phone.decks.delete('d1');
    await phone.sync(false);
    account.forget();
    await laptop.sync();
    expect([...laptop.decks.keys()]).toEqual(['d2']);
    expect(laptop.state()?.base['deck:d1']).toBeUndefined();
  });
});
