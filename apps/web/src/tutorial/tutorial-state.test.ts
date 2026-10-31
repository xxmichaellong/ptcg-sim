import { describe, expect, it } from 'vitest';

import { freeRoomIn } from './TutorialSpotlight.js';
import {
  pendingTutorialRequest,
  startTutorial,
  takeTutorialRequest,
  TUTORIAL_PREFERENCES,
  tutorialRequestFromUrl,
} from './tutorial-state.js';

describe('tutorial state', () => {
  it('keeps finished lessons by version, and reads nothing else', () => {
    expect(
      TUTORIAL_PREFERENCES.parse({
        completed: { start: 1, cards: 2, 'bad id!': 1, deck: 0, turns: 'x' },
      })
    ).toEqual({ completed: { start: 1, cards: 2 } });
    expect(TUTORIAL_PREFERENCES.parse('nonsense')).toEqual({ completed: {} });
    expect(TUTORIAL_PREFERENCES.parse(null)).toEqual({ completed: {} });
  });

  it('answers each request once, a lesson or the list', () => {
    startTutorial('damage');
    const first = pendingTutorialRequest()!;
    expect(first.lesson).toBe('damage');
    startTutorial();
    const second = pendingTutorialRequest()!;
    expect(second.lesson).toBeUndefined();
    expect(second.serial).toBeGreaterThan(first.serial);
    // An answered request that was replaced leaves the newer one.
    takeTutorialRequest(first);
    expect(pendingTutorialRequest()).toBe(second);
    takeTutorialRequest(second);
    expect(pendingTutorialRequest()).toBeNull();
  });

  it('reads a lesson from the page’s address', () => {
    expect(tutorialRequestFromUrl('?tutorial=damage')).toBe('damage');
    expect(tutorialRequestFromUrl('?tutorial')).toBe('');
    expect(tutorialRequestFromUrl('?room=ABC')).toBeUndefined();
  });

  it('points a drag at an empty room of a zone, not onto a card in it', () => {
    const bench = { x: 100, y: 500, width: 600, height: 140 };
    const pidgey = { x: 350, y: 505, width: 100, height: 130 };
    const room = freeRoomIn(bench, [pidgey]);
    // As far right as is clear, clear of Pidgey.
    expect(room.x + room.width).toBeCloseTo(700, 5);
    expect(
      room.x >= pidgey.x + pidgey.width || room.x + room.width <= pidgey.x
    ).toBe(true);
    // A full Bench has no room: the zone itself.
    const full = Array.from({ length: 6 }, (_, index) => ({
      x: 100 + index * 100,
      y: 505,
      width: 100,
      height: 130,
    }));
    expect(freeRoomIn(bench, full)).toEqual(bench);
  });
});
