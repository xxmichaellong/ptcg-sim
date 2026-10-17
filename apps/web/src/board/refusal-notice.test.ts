import { describe, expect, it } from 'vitest';

import {
  REFUSAL_TOAST_ID,
  refusalNotice,
  unsentNotice,
} from './refusal-notice.js';

describe('refusalNotice', () => {
  it('explains a refused move in the player’s terms, one notice at a time', () => {
    const stale = refusalNotice('stale_reference');
    expect(stale).toMatchObject({
      id: REFUSAL_TOAST_ID,
      title: "That move didn't go through",
      tone: 'warning',
    });
    expect(stale.body).toMatch(/table changed/u);
    expect(refusalNotice('precondition_failed')).toEqual(stale);
    expect(refusalNotice('rate_limited').title).toBe('Slow down a moment');
    expect(refusalNotice('unauthorized').title).toBe(
      "That move isn't yours to make"
    );
    for (const code of [
      undefined,
      'internal_retryable',
      'room_not_ready',
      'invalid_sequence',
    ] as const) {
      const notice = refusalNotice(code);
      expect(notice.id).toBe(REFUSAL_TOAST_ID);
      expect(notice.body).toMatch(/went back/u);
    }
  });

  it('speaks of a card only when the refused command moved one', () => {
    for (const type of ['MovePlayStack', 'PlaceCardOnPlayStack', 'DrawCards'])
      expect(refusalNotice('precondition_failed', type).body).toMatch(
        /card went back/u
      );
    for (const type of [
      'SetupPlayer',
      'ResetPlayer',
      'DeclareAttack',
      'PassTurn',
      'ApplySoloUndo',
      'SetDamage',
    ]) {
      for (const code of [
        undefined,
        'stale_reference',
        'rate_limited',
        'unauthorized',
      ] as const) {
        const notice = refusalNotice(code, type);
        expect(notice.id).toBe(REFUSAL_TOAST_ID);
        expect(notice.tone).toBe('warning');
        expect(`${notice.title} ${notice.body ?? ''}`).not.toMatch(/card/u);
      }
    }
    expect(refusalNotice('precondition_failed', 'SetupPlayer').title).toBe(
      "That didn't go through"
    );
  });
});

describe('unsentNotice', () => {
  it('answers every press the client could not send, but a repeated Undo', () => {
    expect(unsentNotice('not_ready')?.title).toBe('Not connected right now');
    expect(unsentNotice('queue_full')?.title).toBe('Slow down a moment');
    expect(unsentNotice('spectator')?.title).toBe("You're watching this table");
    expect(unsentNotice('too_large')?.body).toMatch(/fewer cards/u);
    expect(unsentNotice('command_pending', 'ApplySoloUndo')).toBeUndefined();
    expect(unsentNotice('command_pending', 'SetupPlayer')?.id).toBe(
      REFUSAL_TOAST_ID
    );
  });
});
