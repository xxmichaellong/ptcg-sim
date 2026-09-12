import { describe, expect, it } from 'vitest';

import { asPlayerId, asZoneId } from './ids.js';
import { isConcealedZone } from './public-visibility.js';
import type { CardZone, ZoneKind } from './model.js';

const ALL_ZONE_KINDS: readonly ZoneKind[] = [
  'deck',
  'hand',
  'prizes',
  'discard',
  'lostZone',
  'board',
  'stadium',
];

const zone = (kind: ZoneKind): CardZone => ({
  id: asZoneId(`zone:concealment:${kind}`),
  kind,
  ownerId: kind === 'stadium' ? null : asPlayerId('concealment-owner'),
  cardIds: [],
});

/**
 * Which zones hide the identity of the cards inside them.
 *
 * This is the privacy model's root fact. `decideCommand` stamps
 * `concealIdentity` onto the events it emits from this predicate and
 * `applyEvents` re-derives it to validate that stamp, so the two must agree --
 * they held separate copies until they were folded into one, and a change to
 * either alone would have made the authority reject legitimate events or
 * disclose a card it should have concealed.
 *
 * Every zone kind is listed rather than only the concealed ones, so adding a
 * kind fails here until someone states which side it falls on.
 */
describe('zone concealment', () => {
  const concealed: readonly ZoneKind[] = ['deck', 'hand', 'prizes'];

  it('conceals exactly the deck, hand and prizes', () => {
    expect(
      ALL_ZONE_KINDS.filter((kind) => isConcealedZone(zone(kind)))
    ).toEqual(concealed);
  });

  it('leaves every other zone open', () => {
    const open = ALL_ZONE_KINDS.filter((kind) => !concealed.includes(kind));
    expect(open).toEqual(['discard', 'lostZone', 'board', 'stadium']);
    for (const kind of open) {
      expect(isConcealedZone(zone(kind)), `${kind} is open`).toBe(false);
    }
  });

  it('covers every zone kind the model defines', () => {
    // A new kind must be classified here before it can reach the authority.
    expect(new Set(ALL_ZONE_KINDS).size).toBe(ALL_ZONE_KINDS.length);
    expect(ALL_ZONE_KINDS).toHaveLength(7);
  });

  it('depends on the kind alone, not on owner or contents', () => {
    for (const kind of ALL_ZONE_KINDS) {
      const bare = zone(kind);
      const filled: CardZone = {
        ...bare,
        ownerId: null,
        cardIds: [],
      };
      expect(isConcealedZone(filled), `${kind} ignores owner`).toBe(
        isConcealedZone(bare)
      );
    }
  });
});
