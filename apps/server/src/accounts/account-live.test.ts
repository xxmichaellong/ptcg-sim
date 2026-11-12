import { describe, expect, it } from 'vitest';

import {
  readLiveAttachment,
  readLiveWhere,
  tabsPresence,
  type LiveAttachment,
} from './account-live.js';

const tab = (where: LiveAttachment['where'], greeted = true): LiveAttachment => ({
  tab: Math.random().toString(36),
  where,
  greeted,
});

describe('live tabs', () => {
  it('takes the most present tab: in a game, then watching, then online', () => {
    expect(tabsPresence([])).toEqual({ state: 'offline' });
    expect(tabsPresence([tab({ kind: 'none' }, false)])).toEqual({
      state: 'offline',
    });
    expect(tabsPresence([tab({ kind: 'none' })])).toEqual({ state: 'online' });
    expect(
      tabsPresence([
        tab({ kind: 'none' }),
        tab({ kind: 'room', role: 'spectator', room: 'ABCD' }),
      ])
    ).toEqual({ state: 'watching', room: 'ABCD' });
    expect(
      tabsPresence([
        tab({ kind: 'room', role: 'spectator', room: 'ABCD' }),
        tab({ kind: 'room', role: 'player', room: 'K7PQ' }),
      ])
    ).toEqual({ state: 'playing', room: 'K7PQ' });
  });

  it('reads only well-formed places', () => {
    expect(readLiveWhere({ kind: 'room', role: 'player', room: 'K7PQ' })).toEqual({
      kind: 'room',
      role: 'player',
      room: 'K7PQ',
    });
    for (const bad of [
      null,
      { kind: 'room', role: 'host', room: 'K7PQ' },
      { kind: 'room', role: 'player', room: 'k7pq' },
      { kind: 'room', role: 'player', room: 'IO10' },
      { kind: 'lobby' },
    ]) {
      expect(readLiveWhere(bad)).toBeUndefined();
    }
    expect(
      readLiveAttachment({ tab: 't', where: { kind: 'none' }, greeted: 'yes' })
    ).toEqual({ tab: 't', where: { kind: 'none' }, greeted: false });
  });
});
