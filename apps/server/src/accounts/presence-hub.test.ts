import { describe, expect, it } from 'vitest';

import { memorySql } from './accounts.test-support.js';
import {
  PresenceHub,
  STALE_AFTER_MS,
  VERIFIED_FOR_MS,
  type PresenceView,
} from './presence-hub.js';

const NOW = 1_800_000_000_000;
const DAWN = 'a_dawn000000000000';
const MAY = 'a_may0000000000000';
const IRIS = 'a_iris000000000000';

const hub = () => {
  const sql = memorySql();
  const pushes: { to: string; from: string; view: PresenceView }[] = [];
  const live = new Set<string>();
  let checks = 0;
  const presence = new PresenceHub(sql, {
    push: async (to, from, view) => {
      pushes.push({ to, from, view });
    },
    live: async (account) => {
      checks += 1;
      return live.has(account);
    },
  });
  return { sql, presence, pushes, live, checks: () => checks };
};

describe('presence hub', () => {
  it('pushes a change to online friends only, and answers with theirs', async () => {
    const { presence, pushes } = hub();
    // May comes online first: Dawn is offline, so nothing is pushed.
    expect(
      await presence.update(MAY, { state: 'online', hidden: false }, [DAWN], NOW)
    ).toEqual({ [DAWN]: { state: 'offline' } });
    expect(pushes).toEqual([]);
    // Dawn comes online: May hears, and Dawn learns May is online.
    expect(
      await presence.update(
        DAWN,
        { state: 'online', hidden: false },
        [MAY, IRIS],
        NOW + 10
      )
    ).toEqual({ [MAY]: { state: 'online' }, [IRIS]: { state: 'offline' } });
    expect(pushes).toEqual([
      { to: MAY, from: DAWN, view: { state: 'online' } },
    ]);
    // In a game, with the room to join through.
    await presence.update(
      DAWN,
      { state: 'playing', room: 'K7PQ', hidden: false },
      [MAY],
      NOW + 20
    );
    expect(pushes.at(-1)).toEqual({
      to: MAY,
      from: DAWN,
      view: { state: 'playing', room: 'K7PQ' },
    });
    // Leaving: offline, with when.
    await presence.update(DAWN, { state: 'offline', hidden: false }, [MAY], NOW + 30);
    expect(pushes.at(-1)?.view).toEqual({ state: 'offline', lastSeen: NOW + 30 });
  });

  it('writes and pushes nothing when nothing friends see changed', async () => {
    const { presence, pushes, sql } = hub();
    await presence.update(MAY, { state: 'online', hidden: false }, [], NOW);
    await presence.update(DAWN, { state: 'online', hidden: false }, [MAY], NOW);
    const before = pushes.length;
    await presence.update(DAWN, { state: 'online', hidden: false }, [MAY], NOW + 5);
    expect(pushes.length).toBe(before);
    expect(sql.count('presence')).toBe(2);
  });

  it('shows an account that appears offline as offline, from then', async () => {
    const { presence, pushes } = hub();
    await presence.update(MAY, { state: 'online', hidden: false }, [], NOW);
    await presence.update(DAWN, { state: 'online', hidden: false }, [MAY], NOW);
    await presence.update(
      DAWN,
      { state: 'playing', room: 'K7PQ', hidden: true },
      [MAY],
      NOW + 100
    );
    expect(pushes.at(-1)?.view).toEqual({ state: 'offline', lastSeen: NOW + 100 });
    expect(await presence.read([DAWN], NOW + 200)).toEqual({
      [DAWN]: { state: 'offline', lastSeen: NOW + 100 },
    });
    // It still hears its friends: it is online, only unseen.
    await presence.update(MAY, { state: 'watching', room: 'ABCD', hidden: false }, [DAWN], NOW + 300);
    expect(pushes.at(-1)).toEqual({
      to: DAWN,
      from: MAY,
      view: { state: 'watching', room: 'ABCD' },
    });
  });

  it('checks a row that looks stale with its account, once in a while', async () => {
    const { presence, live, checks } = hub();
    await presence.update(DAWN, { state: 'online', hidden: false }, [], NOW);
    await presence.update(MAY, { state: 'online', hidden: false }, [], NOW);
    live.add(DAWN);
    const later = NOW + STALE_AFTER_MS + 1;
    expect(await presence.read([DAWN, MAY], later)).toEqual({
      [DAWN]: { state: 'online' },
      // May's tabs closed without a goodbye: offline since her last change.
      [MAY]: { state: 'offline', lastSeen: NOW },
    });
    expect(checks()).toBe(2);
    // Found live a moment ago: not asked again so soon.
    await presence.read([DAWN], later + 1000);
    expect(checks()).toBe(2);
    await presence.read([DAWN], later + VERIFIED_FOR_MS + 1);
    expect(checks()).toBe(3);
  });

  it('forgets a deleted account', async () => {
    const { presence, sql } = hub();
    await presence.update(DAWN, { state: 'online', hidden: false }, [], NOW);
    presence.forget(DAWN);
    expect(sql.count('presence')).toBe(0);
    expect(await presence.read([DAWN], NOW)).toEqual({
      [DAWN]: { state: 'offline' },
    });
  });
});
