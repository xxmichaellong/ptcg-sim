import { describe, expect, it } from 'vitest';

import { alreadyThereNotice } from './already-there-notice.js';
import type { BoardSessionControllerEffect } from './BoardSessionController.js';
import { refusalCommandType, refusalNotice } from './refusal-notice.js';

const rejected = (
  patch: Partial<
    Extract<BoardSessionControllerEffect, { kind: 'GroupActionRejected' }>
  >
): BoardSessionControllerEffect => ({
  kind: 'GroupActionRejected',
  action: { kind: 'send', to: 'discard' },
  reason: 'no_op',
  itemCount: 3,
  ...patch,
});

describe("the table's word on a group it kept back", () => {
  it('says where a group already lies, all of it', () => {
    expect(alreadyThereNotice(rejected({}))?.title).toBe(
      'All 3 are already in the discard pile'
    );
    expect(
      alreadyThereNotice(
        rejected({ action: { kind: 'play', slot: 'bench' }, itemCount: 2 })
      )?.title
    ).toBe('All 2 are already on the Bench');
    // A group of one reads as one card does.
    expect(alreadyThereNotice(rejected({ itemCount: 1 }))?.title).toBe(
      'Already in the discard pile'
    );
    // A drag let go where the cards lie says nothing.
    expect(
      alreadyThereNotice(
        rejected({ action: { kind: 'drop', targetId: 'zone' } })
      )
    ).toBeUndefined();
  });

  it("says why a group can't go, naming the card it stopped at", () => {
    expect(
      alreadyThereNotice(
        rejected({
          action: { kind: 'play', slot: 'active' },
          reason: 'one_active',
        })
      )?.title
    ).toBe('Only one Pokémon can be Active');
    expect(
      alreadyThereNotice(
        rejected({
          action: { kind: 'damage', delta: 10 },
          reason: 'not_in_play',
          cardName: 'Switch',
        })
      )
    ).toMatchObject({
      title: 'Only Pokémon in play take damage',
      body: "Switch isn't in play.",
    });
    expect(
      alreadyThereNotice(rejected({ action: null, reason: 'no_target' }))?.title
    ).toBe('No Pokémon can take all of these');
    expect(
      alreadyThereNotice(
        rejected({ reason: 'unsupported_target', itemCount: 2 })
      )?.title
    ).toBe("Can't do that with these cards");
    // A table not ready for moves needs no word.
    expect(
      alreadyThereNotice(rejected({ reason: 'not_ready' }))
    ).toBeUndefined();
  });

  it("says why a card can't join the selection, and nothing for a card gone", () => {
    const refused = (reason: string) =>
      alreadyThereNotice({
        kind: 'IntentRejected',
        intent: { kind: 'CardSelected', cardId: 'card' as never, mode: 'add' },
        reason: reason as never,
      });
    expect(refused('in_selected_pokemon')?.title).toBe(
      'Already part of the selected Pokémon'
    );
    expect(refused('not_an_item')?.title).toBe(
      'Open the pile to pick cards from it'
    );
    expect(refused('full')?.title).toBe('Up to 60 cards can be selected');
    expect(refused('stale_card')).toBeUndefined();
  });

  it("speaks of the cards when the room refuses a group's one move", () => {
    expect(refusalNotice('stale_reference', 'ApplyCardSteps').body).toBe(
      'The table changed, so the cards went back.'
    );
    expect(refusalNotice('stale_reference', 'MoveCard').body).toBe(
      'The table changed, so the card went back.'
    );
    expect(refusalNotice(undefined, 'ApplyCardSteps').body).toBe(
      'The cards went back.'
    );
  });

  it('speaks of a refused batch of marks as a mark: no card went back', () => {
    const damage = refusalCommandType({
      type: 'ApplyCardSteps',
      steps: [
        { type: 'SetDamage', stackId: 'a', damage: 10 },
        { type: 'SetDamage', stackId: 'b', damage: 20 },
      ],
    });
    expect(damage).toBe('SetDamage');
    expect(refusalNotice('stale_reference', damage).title).toBe(
      "Didn't go through"
    );
    expect(
      refusalCommandType({
        type: 'ApplyCardSteps',
        steps: [
          { type: 'SetDamage', stackId: 'a', damage: 10 },
          {
            type: 'MoveCard',
            cardId: 'card',
            expectedSourceZoneId: 'hand',
            destinationZoneId: 'discard',
          },
        ],
      } as never)
    ).toBe('ApplyCardSteps');
    expect(
      refusalCommandType({ type: 'ShuffleZone', zoneId: 'deck' } as never)
    ).toBe('ShuffleZone');
  });
});
