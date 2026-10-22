import { describe, expect, it } from 'vitest';

import {
  orderedDeckEntries,
  TUTORIAL_CARDS,
  TUTORIAL_IMAGE_URLS,
} from './tutorial-cards.js';
import {
  MIDGAME_SCENARIO,
  START_SCENARIO,
  seatDeckOrder,
  seatDrawCount,
  type TutorialSeat,
} from './tutorial-scenarios.js';

describe('the practice table’s cards', () => {
  it('loads a deck in exactly the order given, top card first', () => {
    const entries = orderedDeckEntries([
      'charmander',
      'charmander',
      'fireEnergy',
      'charmander',
    ]);
    // Copies together share an entry; a card that comes back later goes in
    // under a copy of its definition, showing the same card.
    expect(entries.map((entry) => [entry.definition.id, entry.count])).toEqual([
      ['tutorial-charmander', 2],
      ['tutorial-fire-energy', 1],
      ['tutorial-charmander~2', 1],
    ]);
    expect(entries[2]!.definition).toMatchObject({
      name: 'Charmander',
      imageUrl: TUTORIAL_CARDS.charmander.imageUrl,
    });
    // No two entries share a definition: the room refuses that.
    const ids = entries.map((entry) => entry.definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses Limitless scans, each name once', () => {
    for (const url of TUTORIAL_IMAGE_URLS) {
      expect(url).toMatch(
        /^https:\/\/limitlesstcg\.nyc3\.digitaloceanspaces\.com\/tpci\/[A-Z]+\/[A-Z]+_[0-9A-Z]+_R_EN\.png$/u
      );
    }
    const names = Object.values(TUTORIAL_CARDS).map((card) => card.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('deals sixty-card decks on both sides of every lesson', () => {
    for (const scenario of [START_SCENARIO, MIDGAME_SCENARIO]) {
      for (const seat of [scenario.you, scenario.them]) {
        expect(seatDeckOrder(seat)).toHaveLength(60);
      }
    }
    const them = MIDGAME_SCENARIO.them;
    expect(them.prizes).toHaveLength(6);
    expect(seatDrawCount(them)).toBe(60 - them.deck.length);
    const you = MIDGAME_SCENARIO.you as TutorialSeat;
    expect(you.prizes).toHaveLength(6);
    // The lessons' cards are where they ask for them.
    expect(you.hand).toEqual(
      expect.arrayContaining(['fireEnergy', 'charmeleon', 'research', 'pidgey'])
    );
    expect(you.deck[0]).toBe('charizardEx');
    expect(you.deck).toContain('rareCandy');
    expect(them.active?.evolutions).toEqual(['kirlia']);
  });
});
