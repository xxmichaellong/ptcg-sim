import { describe, expect, it } from 'vitest';

import { activeSocketCountExcluding } from './socket-telemetry.js';

describe('socket telemetry accounting', () => {
  it('excludes the socket whose terminal callback is being observed', () => {
    const closing = {};
    const active = {};

    expect(activeSocketCountExcluding([closing], closing)).toBe(0);
    expect(activeSocketCountExcluding([active, closing], closing)).toBe(1);
    expect(activeSocketCountExcluding([active], closing)).toBe(1);
  });
});
