import { describe, expect, it, vi } from 'vitest';

import { AccessibilityAnnouncementDrain } from './AccessibilityAnnouncementDrain.js';
import type { AccessibilityPresentationEffect } from './PresentationEffects.js';
import { PresentationRuntime } from './PresentationRuntime.js';

const announcement = (revision: number): AccessibilityPresentationEffect => ({
  kind: 'accessibility',
  revision,
  eventType: 'PlayerReset',
  message: `announcement ${revision}`,
  politeness: 'polite',
});

const deferred = (): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('AccessibilityAnnouncementDrain', () => {
  it('delivers and acknowledges announcements strictly one at a time', async () => {
    const runtime = new PresentationRuntime();
    const first = deferred();
    const second = deferred();
    const delivered: number[] = [];
    const drain = new AccessibilityAnnouncementDrain({
      source: runtime.accessibility,
      acknowledge: runtime.acknowledgeAccessibility,
      announce: (entry) => {
        delivered.push(entry.effect.revision);
        return entry.effect.revision === 1 ? first.promise : second.promise;
      },
    });

    runtime.adapters.announceAccessibility?.(announcement(1));
    runtime.adapters.announceAccessibility?.(announcement(2));
    expect(delivered).toEqual([1]);
    expect(runtime.accessibility.getSnapshot().announcements).toHaveLength(2);

    first.resolve();
    await flush();
    expect(delivered).toEqual([1, 2]);
    expect(
      runtime.accessibility
        .getSnapshot()
        .announcements.map((entry) => entry.effect.revision)
    ).toEqual([2]);

    second.resolve();
    await flush();
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    drain.dispose();
  });

  it('reports a failed handler, drops that head, and continues', async () => {
    const runtime = new PresentationRuntime();
    const failure = new Error('live region unavailable');
    const reportFailure = vi.fn(() => {
      throw new Error('diagnostics failed');
    });
    const delivered: number[] = [];
    const drain = new AccessibilityAnnouncementDrain({
      source: runtime.accessibility,
      acknowledge: runtime.acknowledgeAccessibility,
      announce: (entry) => {
        delivered.push(entry.effect.revision);
        if (entry.effect.revision === 1) throw failure;
      },
      reportFailure,
    });

    runtime.adapters.announceAccessibility?.(announcement(1));
    runtime.adapters.announceAccessibility?.(announcement(2));
    await flush();

    expect(delivered).toEqual([1, 2]);
    expect(reportFailure).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ effect: announcement(1) })
    );
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    drain.dispose();
  });

  it('aborts cleared, replaced, and disposed work without stale acknowledgement', async () => {
    const runtime = new PresentationRuntime({
      maximumAccessibilityAnnouncements: 1,
    });
    const tasks = [deferred(), deferred(), deferred()];
    const signals: AbortSignal[] = [];
    const delivered: number[] = [];
    const drain = new AccessibilityAnnouncementDrain({
      source: runtime.accessibility,
      acknowledge: runtime.acknowledgeAccessibility,
      announce: (entry, signal) => {
        delivered.push(entry.effect.revision);
        signals.push(signal);
        return tasks[delivered.length - 1]!.promise;
      },
    });

    runtime.adapters.announceAccessibility?.(announcement(1));
    runtime.adapters.announceAccessibility?.(announcement(2));
    expect(delivered).toEqual([1, 2]);
    expect(signals[0]!.aborted).toBe(true);

    tasks[0]!.resolve();
    await flush();
    expect(
      runtime.accessibility.getSnapshot().announcements[0]!.effect.revision
    ).toBe(2);

    runtime.clearTransientEffects();
    expect(signals[1]!.aborted).toBe(true);
    runtime.adapters.announceAccessibility?.(announcement(3));
    expect(delivered).toEqual([1, 2, 3]);

    drain.dispose();
    expect(signals[2]!.aborted).toBe(true);
    runtime.adapters.announceAccessibility?.(announcement(4));
    expect(delivered).toEqual([1, 2, 3]);
  });
});
