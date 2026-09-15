import { describe, expect, it } from 'vitest';

import {
  CONTINUATION_HTTP_ACTIVATION_VALUE,
  continuationHttpIsActive,
} from './continuation-http-activation.js';

describe('continuation HTTP activation gate', () => {
  it('opens only for the exact reviewed opt-in value', () => {
    expect(continuationHttpIsActive(CONTINUATION_HTTP_ACTIVATION_VALUE)).toBe(
      true
    );
    for (const value of [
      undefined,
      null,
      true,
      'true',
      'enabled',
      `${CONTINUATION_HTTP_ACTIVATION_VALUE} `,
    ]) {
      expect(continuationHttpIsActive(value)).toBe(false);
    }
  });
});
