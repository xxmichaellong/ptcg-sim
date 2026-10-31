import { asViewCardId } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  ALREADY_THERE_TOAST_ID,
  alreadyThereNotice,
} from './already-there-notice.js';

const cardId = asViewCardId('card-1');

describe('alreadyThereNotice', () => {
  it('names where a card already lies when a key sends it there', () => {
    expect(
      alreadyThereNotice({
        kind: 'ShortcutActionRejected',
        request: { action: 'moveCardToPlay', cardId, slot: 'bench' },
        reason: 'no_op',
      })
    ).toEqual({ id: ALREADY_THERE_TOAST_ID, title: 'Already on the Bench' });
    expect(
      alreadyThereNotice({
        kind: 'ShortcutActionRejected',
        request: { action: 'moveCardToPlay', cardId, slot: 'active' },
        reason: 'no_op',
      })?.title
    ).toBe('Already in the Active Spot');
    expect(
      alreadyThereNotice({
        kind: 'ShortcutActionRejected',
        request: { action: 'moveCardToZone', cardId, destination: 'discard' },
        reason: 'no_op',
      })?.title
    ).toBe('Already in the discard pile');
    expect(
      alreadyThereNotice({
        kind: 'ShortcutActionRejected',
        request: { action: 'moveCardToStadium', cardId },
        reason: 'no_op',
      })?.title
    ).toBe('Already the Stadium');
    expect(
      alreadyThereNotice({
        kind: 'OverlayActionRejected',
        request: {
          kind: 'context',
          action: 'moveCard',
          cardId,
          destination: 'board',
        },
        reason: 'no_op',
      })?.title
    ).toBe('Already on the Board');
  });

  it('is calm, not a warning: nothing went wrong', () => {
    expect(
      alreadyThereNotice({
        kind: 'ShortcutActionRejected',
        request: { action: 'moveCardToZone', cardId, destination: 'hand' },
        reason: 'no_op',
      })?.tone
    ).toBeUndefined();
  });

  it('says nothing for any other refusal or action', () => {
    expect(
      alreadyThereNotice({
        kind: 'ShortcutActionRejected',
        request: { action: 'moveCardToPlay', cardId, slot: 'bench' },
        reason: 'stale_card',
      })
    ).toBeUndefined();
    expect(
      alreadyThereNotice({
        kind: 'ShortcutActionRejected',
        request: { action: 'removeDamage', cardId },
        reason: 'no_op',
      })
    ).toBeUndefined();
    expect(
      alreadyThereNotice({
        kind: 'SubmitCommand',
        command: { type: 'FlipCoin' },
      })
    ).toBeUndefined();
  });
});
