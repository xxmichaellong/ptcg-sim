import { describe, expect, it } from 'vitest';

import {
  CONTINUATION_HTTP_ACTIVATION_VALUE,
  CONTINUATION_HTTP_DRAIN_VALUE,
  continuationHttpMode,
} from './continuation-http-activation.js';

describe('continuation HTTP activation gate', () => {
  it('enables the complete surface only for the exact opt-in value', () => {
    expect(continuationHttpMode(CONTINUATION_HTTP_ACTIVATION_VALUE)).toBe(
      'enabled'
    );
  });

  it('retains only revocation for the exact drain value', () => {
    expect(continuationHttpMode(CONTINUATION_HTTP_DRAIN_VALUE)).toBe(
      'draining'
    );
  });

  it('fails closed for absence and every other value', () => {
    for (const value of [
      undefined,
      null,
      true,
      'true',
      'enabled',
      `${CONTINUATION_HTTP_ACTIVATION_VALUE} `,
      `${CONTINUATION_HTTP_DRAIN_VALUE} `,
    ]) {
      expect(continuationHttpMode(value)).toBe('closed');
    }
  });
});
