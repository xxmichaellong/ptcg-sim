import { describe, expect, it } from 'vitest';

import { REFUSAL_TOAST_ID, refusalNotice } from './refusal-notice.js';

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
});
