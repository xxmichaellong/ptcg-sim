import { describe, expect, it } from 'vitest';

import { PRESENTATION_LEVEL, PROTOCOL_VERSION } from './constants.js';
import * as v from 'valibot';

import { parseClientFrame } from './ingress.js';
import {
  presentationEventsForLevel,
  PresentationEventSchema,
  type PresentationEvent,
} from './schemas.js';

const events: PresentationEvent[] = [
  {
    type: 'DamageSet',
    revision: 3,
    playerId: 'p1',
    stackId: 'stack-1',
    source: 'active',
    cardName: 'Pikachu',
    damage: 30,
  },
  {
    type: 'ConditionSet',
    revision: 3,
    playerId: 'p1',
    source: 'active',
    cardName: 'Pikachu',
    condition: 'P',
  },
  {
    type: 'CardMoved',
    revision: 3,
    playerId: 'p1',
    verb: 'switched',
    cardName: 'Pikachu',
    targetCardName: 'Raichu',
    source: 'active',
    destination: 'bench',
  },
  { type: 'MulliganDeclared', revision: 3, playerId: 'p1' },
];

describe('presentation levels', () => {
  it('leaves out for a client from before levels what its schema refused, and nothing for one that reads them', () => {
    // Each is a valid event now.
    for (const event of events) {
      expect(v.safeParse(PresentationEventSchema, event).success).toBe(true);
    }
    expect(presentationEventsForLevel(events, 0)).toEqual([events[3]]);
    expect(presentationEventsForLevel(events, PRESENTATION_LEVEL)).toBe(events);
  });

  it('gives a level-1 client one Special Condition, not the list it would not read', () => {
    const several: PresentationEvent = {
      type: 'ConditionSet',
      revision: 4,
      playerId: 'p1',
      source: 'active',
      cardName: 'Pikachu',
      condition: 'B',
      conditions: ['poisoned', 'burned'],
    };
    expect(v.safeParse(PresentationEventSchema, several).success).toBe(true);
    const [single, kept] = presentationEventsForLevel([several, events[3]!], 1);
    expect(single).toEqual({
      type: 'ConditionSet',
      revision: 4,
      playerId: 'p1',
      source: 'active',
      cardName: 'Pikachu',
      condition: 'B',
    });
    expect(kept).toBe(events[3]);
    expect(presentationEventsForLevel([several], 2)).toEqual([several]);
    // A list breaking the rules' bounds is no event.
    expect(
      v.safeParse(PresentationEventSchema, {
        ...several,
        conditions: ['poisoned', 'burned', 'asleep', 'confused'],
      }).success
    ).toBe(false);
  });

  it('takes a Hello with its level, or without one (a build from before)', () => {
    const hello = {
      type: 'Hello',
      protocolVersion: PROTOCOL_VERSION,
      buildId: 'build',
      roomCode: 'ROOM',
      displayName: 'Blue',
      requestedRole: 'player',
    };
    const without = parseClientFrame(JSON.stringify(hello));
    expect(without.ok && without.value.type === 'Hello').toBe(true);
    if (without.ok && without.value.type === 'Hello') {
      expect(without.value.presentationLevel).toBeUndefined();
    }
    const withLevel = parseClientFrame(
      JSON.stringify({ ...hello, presentationLevel: PRESENTATION_LEVEL })
    );
    expect(withLevel.ok).toBe(true);
    if (withLevel.ok && withLevel.value.type === 'Hello') {
      expect(withLevel.value.presentationLevel).toBe(PRESENTATION_LEVEL);
    }
    for (const bad of [-1, 1.5, '1', 100_000]) {
      expect(
        parseClientFrame(JSON.stringify({ ...hello, presentationLevel: bad }))
          .ok
      ).toBe(false);
    }
  });
});
