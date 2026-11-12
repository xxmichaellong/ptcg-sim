import { describe, expect, it } from 'vitest';

import {
  AccountFriendsSql,
  FriendGraph,
  MAX_RECEIVED_REQUESTS,
  MAX_SENT_REQUESTS,
  REQUEST_COOLDOWN_MS,
  friendsView,
  recentPlayers,
  type FriendPeer,
  type FriendProfile,
} from './account-friends.js';
import { memorySql } from './accounts.test-support.js';

const NOW = 1_800_000_000_000;

/** Accounts in memory, each reaching the others as its object would. */
const world = (options: { readonly crossing?: boolean } = {}) => {
  const accounts = new Map<
    string,
    { profile: FriendProfile; store: AccountFriendsSql; graph: FriendGraph }
  >();
  let failing = false;
  // Crossing: each call to another object waits a turn first, so two
  // requests made together both write their half before either is asked.
  const turn = () =>
    options.crossing ? new Promise((resolve) => setTimeout(resolve, 0)) : undefined;
  const peer = (id: string): FriendPeer => ({
    peerRequest: async (from, now) => {
      await turn();
      if (failing) throw new Error('unreachable');
      const account = accounts.get(id);
      return account ? account.graph.peerRequest(from, now) : { kind: 'missing' };
    },
    peerAccept: async (from, now) => {
      await turn();
      if (failing) throw new Error('unreachable');
      return accounts.get(id)?.graph.peerAccept(from, now) ?? 'gone';
    },
    peerDrop: async (fromId, states) => {
      await turn();
      accounts.get(id)?.graph.peerDrop(fromId, states);
    },
    peerProfile: async (from) => {
      accounts.get(id)?.graph.peerProfile(from);
    },
    publicProfile: async () => accounts.get(id)?.profile ?? null,
  });
  const add = (id: string, name: string) => {
    const store = new AccountFriendsSql(memorySql());
    const entry = {
      profile: { id, name, avatar: 'initials' as const },
      store,
      graph: undefined as unknown as FriendGraph,
    };
    entry.graph = new FriendGraph(store, () => entry.profile, peer);
    accounts.set(id, entry);
    return entry;
  };
  return {
    add,
    fail: (value: boolean) => {
      failing = value;
    },
  };
};

const DAWN = 'a_dawn000000000000';
const MAY = 'a_may0000000000000';
const IRIS = 'a_iris000000000000';

const states = (store: AccountFriendsSql) =>
  Object.fromEntries(store.rows().map((row) => [row.id, row.state]));

describe('friends', () => {
  it('asks, then becomes friends on both sides when accepted', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    const may = add(MAY, 'May');
    expect(await dawn.graph.request(MAY, NOW)).toEqual({
      outcome: 'sent',
      name: 'May',
    });
    expect(states(dawn.store)).toEqual({ [MAY]: 'outgoing' });
    expect(may.store.row(DAWN)).toMatchObject({ state: 'incoming', name: 'Dawn' });
    // Asking again changes nothing.
    expect((await dawn.graph.request(MAY, NOW + 5000)).outcome).toBe('sent');
    expect(await may.graph.accept(DAWN, NOW + 10)).toEqual({
      outcome: 'friends',
      name: 'Dawn',
    });
    expect(states(dawn.store)).toEqual({ [MAY]: 'friend' });
    expect(states(may.store)).toEqual({ [DAWN]: 'friend' });
    expect(friendsView(dawn.store, []).friends).toEqual([
      { id: MAY, name: 'May', avatar: 'initials', since: NOW + 10 },
    ]);
  });

  it('makes two requests that cross a friendship', async () => {
    const { add } = world({ crossing: true });
    const dawn = add(DAWN, 'Dawn');
    const may = add(MAY, 'May');
    const [first, second] = await Promise.all([
      dawn.graph.request(MAY, NOW),
      may.graph.request(DAWN, NOW + 2000),
    ]);
    expect(first.outcome).toBe('friends');
    expect(second.outcome).toBe('friends');
    expect(states(dawn.store)).toEqual({ [MAY]: 'friend' });
    expect(states(may.store)).toEqual({ [DAWN]: 'friend' });
  });

  it('accepts by asking back', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    const may = add(MAY, 'May');
    await dawn.graph.request(MAY, NOW);
    expect((await may.graph.request(DAWN, NOW + 2000)).outcome).toBe('friends');
    expect(states(dawn.store)).toEqual({ [MAY]: 'friend' });
  });

  it('declines silently: the sender still reads sent', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    const may = add(MAY, 'May');
    await dawn.graph.request(MAY, NOW);
    expect(may.graph.decline(DAWN).outcome).toBe('declined');
    expect(states(may.store)).toEqual({});
    expect(states(dawn.store)).toEqual({ [MAY]: 'outgoing' });
    expect((await dawn.graph.request(MAY, NOW + 5000)).outcome).toBe('sent');
    expect(states(may.store)).toEqual({});
  });

  it('cancels, and waits a day before asking the same player again', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    const may = add(MAY, 'May');
    await dawn.graph.request(MAY, NOW);
    expect((await dawn.graph.cancel(MAY, NOW + 1000)).outcome).toBe('cancelled');
    expect(states(may.store)).toEqual({});
    expect(friendsView(dawn.store, []).outgoing).toEqual([]);
    expect((await dawn.graph.request(MAY, NOW + 60_000)).outcome).toBe('cooldown');
    expect(
      (await dawn.graph.request(MAY, NOW + 1000 + REQUEST_COOLDOWN_MS)).outcome
    ).toBe('sent');
    expect(states(may.store)).toEqual({ [DAWN]: 'incoming' });
  });

  it('removes a friend on both sides', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    const may = add(MAY, 'May');
    await dawn.graph.request(MAY, NOW);
    await may.graph.accept(DAWN, NOW);
    expect((await may.graph.remove(DAWN)).outcome).toBe('removed');
    expect(states(dawn.store)).toEqual({});
    expect(states(may.store)).toEqual({});
  });

  it('blocks unseen: ends the friendship and swallows requests', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    const may = add(MAY, 'May');
    await dawn.graph.request(MAY, NOW);
    await may.graph.accept(DAWN, NOW);
    expect(await may.graph.block(DAWN, NOW + 10)).toEqual({
      outcome: 'blocked',
      name: 'Dawn',
    });
    expect(states(dawn.store)).toEqual({});
    expect(friendsView(may.store, []).blocked).toEqual([
      { id: DAWN, name: 'Dawn', avatar: 'initials' },
    ]);
    // Dawn's request reads as sent; May never sees it.
    expect((await dawn.graph.request(MAY, NOW + 5000)).outcome).toBe('sent');
    expect(states(may.store)).toEqual({});
    // May can't ask Dawn without unblocking first.
    expect((await may.graph.request(DAWN, NOW + 9000)).outcome).toBe('you_blocked');
    may.graph.unblock(DAWN);
    expect((await may.graph.request(DAWN, NOW + 20_000)).outcome).toBe('friends');
  });

  it('blocks someone it never met, by id', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    add(MAY, 'May');
    expect((await dawn.graph.block(MAY, NOW)).outcome).toBe('blocked');
    expect((await dawn.graph.block('a_nobody0000000000', NOW)).outcome).toBe(
      'missing'
    );
  });

  it('withdraws a request blocked while it waited', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    const may = add(MAY, 'May');
    await dawn.graph.request(MAY, NOW);
    await dawn.graph.block(MAY, NOW + 10);
    expect(states(may.store)).toEqual({});
  });

  it('says only "unavailable" when the other side is full', async () => {
    const { add } = world();
    const may = add(MAY, 'May');
    for (let index = 0; index < MAX_RECEIVED_REQUESTS; index += 1) {
      const id = `a_fan${String(index).padStart(13, '0')}`;
      await add(id, `Fan ${String(index)}`).graph.request(MAY, NOW);
    }
    const dawn = add(DAWN, 'Dawn');
    expect(await dawn.graph.request(MAY, NOW)).toEqual({
      outcome: 'unavailable',
      name: 'May',
    });
    expect(states(dawn.store)).toEqual({});
    expect(may.store.count('incoming')).toBe(MAX_RECEIVED_REQUESTS);
  });

  it('keeps its own limits: sent requests, and one a second', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    let clock = NOW;
    for (let index = 0; index < MAX_SENT_REQUESTS; index += 1) {
      const id = `a_idol${String(index).padStart(12, '0')}`;
      add(id, `Idol ${String(index)}`);
      clock += 1000;
      expect((await dawn.graph.request(id, clock)).outcome).toBe('sent');
    }
    add(IRIS, 'Iris');
    expect((await dawn.graph.request(IRIS, clock + 5000)).outcome).toBe(
      'too_many_sent'
    );
    const fresh = add('a_fresh00000000000', 'Fresh');
    expect((await fresh.graph.request(IRIS, NOW)).outcome).toBe('sent');
    add('a_other00000000000', 'Other');
    expect((await fresh.graph.request('a_other00000000000', NOW + 10)).outcome).toBe(
      'slow_down'
    );
  });

  it('refuses itself and ids nobody has', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    expect((await dawn.graph.request(DAWN, NOW)).outcome).toBe('self');
    expect((await dawn.graph.request('a_nobody0000000000', NOW)).outcome).toBe(
      'missing'
    );
    expect(states(dawn.store)).toEqual({});
  });

  it('leaves nothing behind when the other side is unreachable', async () => {
    const { add, fail } = world();
    const dawn = add(DAWN, 'Dawn');
    const may = add(MAY, 'May');
    fail(true);
    expect((await dawn.graph.request(MAY, NOW)).outcome).toBe('failed');
    expect(states(dawn.store)).toEqual({});
    fail(false);
    await dawn.graph.request(MAY, NOW + 2000);
    fail(true);
    expect((await may.graph.accept(DAWN, NOW + 3000)).outcome).toBe('failed');
    expect(states(may.store)).toEqual({ [DAWN]: 'incoming' });
    fail(false);
    expect((await may.graph.accept(DAWN, NOW + 4000)).outcome).toBe('friends');
  });

  it('tells a request withdrawn before it was accepted', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    const may = add(MAY, 'May');
    await dawn.graph.request(MAY, NOW);
    // Dawn's side lost the request (deleted), May accepts the stale one.
    dawn.store.remove(MAY);
    expect((await may.graph.accept(DAWN, NOW + 10)).outcome).toBe('gone');
    expect(states(may.store)).toEqual({});
  });

  it('tells everyone of a new name, and forgets a deleted account', async () => {
    const { add } = world();
    const dawn = add(DAWN, 'Dawn');
    const may = add(MAY, 'May');
    const iris = add(IRIS, 'Iris');
    await dawn.graph.request(MAY, NOW);
    await may.graph.accept(DAWN, NOW);
    await iris.graph.request(DAWN, NOW);
    dawn.profile = { ...dawn.profile, name: 'Dawn Berlitz' };
    await dawn.graph.announceProfile();
    expect(may.store.row(DAWN)?.name).toBe('Dawn Berlitz');
    expect(iris.store.row(DAWN)?.name).toBe('Dawn Berlitz');
    await dawn.graph.forget();
    expect(states(may.store)).toEqual({});
    expect(states(iris.store)).toEqual({});
  });

  it('writes nothing for an account that never uses friends', async () => {
    const sql = memorySql();
    const store = new AccountFriendsSql(sql);
    expect(friendsView(store, [])).toEqual({
      friends: [],
      incoming: [],
      outgoing: [],
      blocked: [],
      recent: [],
      appearOffline: false,
    });
    expect(() => sql.count('friend')).toThrow();
  });
});

describe('recent players', () => {
  const game = (
    filedAt: number,
    accounts: readonly string[],
    mode = 'multiplayer'
  ) => ({
    filedAt,
    mode,
    viewer: 'p1',
    players: ['Dawn', `Rival ${String(filedAt)}`],
    playerOrder: ['p1', 'p2'],
    accounts,
  });

  it('lists the other seats of online games, newest first, once each', () => {
    expect(
      recentPlayers(
        [
          game(1, [DAWN, MAY]),
          game(3, [DAWN, IRIS]),
          game(2, [DAWN, MAY]),
          game(4, [DAWN, '']),
          game(5, [DAWN, 'a_solo0000000000000'], 'solo'),
          { ...game(6, [DAWN, MAY]), accounts: undefined },
        ],
        DAWN
      )
    ).toEqual([
      { id: IRIS, name: 'Rival 3', playedAt: 3 },
      { id: MAY, name: 'Rival 2', playedAt: 2 },
    ]);
  });
});
