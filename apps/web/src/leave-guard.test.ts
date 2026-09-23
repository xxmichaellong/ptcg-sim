import { describe, expect, it, vi } from 'vitest';

import { installLeaveGuard, LEGACY_LEAVE_MESSAGE } from './leave-guard.js';

describe('the application leave guard', () => {
  it('asks before unload and stops asking once disposed', () => {
    const listeners = new Set<(event: BeforeUnloadEvent) => void>();
    const target = {
      addEventListener: (
        _type: 'beforeunload',
        listener: (event: BeforeUnloadEvent) => void
      ) => {
        listeners.add(listener);
      },
      removeEventListener: (
        _type: 'beforeunload',
        listener: (event: BeforeUnloadEvent) => void
      ) => {
        listeners.delete(listener);
      },
    };
    const dispose = installLeaveGuard(target);
    expect(listeners.size).toBe(1);

    const event = {
      preventDefault: vi.fn(),
      returnValue: '',
    } as unknown as BeforeUnloadEvent;
    for (const listener of listeners) listener(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe(LEGACY_LEAVE_MESSAGE);

    dispose();
    dispose();
    expect(listeners.size).toBe(0);
  });

  it('is inert without a window', () => {
    expect(() => installLeaveGuard(undefined)()).not.toThrow();
  });
});
