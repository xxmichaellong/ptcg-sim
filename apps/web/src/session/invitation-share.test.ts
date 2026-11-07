import { afterEach, describe, expect, it, vi } from 'vitest';

const toasts = vi.hoisted(() => ({
  shown: [] as {
    readonly id: string;
    readonly title: string;
    readonly action?: { readonly label: string; readonly onAction: () => void };
  }[],
  dismissed: [] as (string | undefined)[],
}));
vi.mock('../ui/toast.js', () => ({
  toast: (options: (typeof toasts.shown)[number]) => {
    const id = `toast-${String(toasts.shown.length)}`;
    toasts.shown.push({ ...options, id });
    return id;
  },
  dismissToast: (id?: string) => {
    toasts.dismissed.push(id);
  },
}));

const { noticeForAnotherPress } = await import('./invitation-share.js');

afterEach(() => {
  toasts.shown.length = 0;
  toasts.dismissed.length = 0;
  vi.useRealTimers();
});

describe('the notice asking for another press', () => {
  it('passes the link on from its button, inside that press', async () => {
    const pass = vi.fn(async () => 'shared' as const);
    const outcome = noticeForAnotherPress(pass, 'share');
    expect(toasts.shown).toHaveLength(1);
    expect(toasts.shown[0]?.title).toBe('Invitation link ready');
    expect(toasts.shown[0]?.action?.label).toBe('Share');
    expect(pass).not.toHaveBeenCalled();
    toasts.shown[0]?.action?.onAction();
    // Called within the press itself, not after a turn of the event loop.
    expect(pass).toHaveBeenCalledOnce();
    await expect(outcome).resolves.toBe('shared');
  });

  it('gives up quietly when no press comes', async () => {
    vi.useFakeTimers();
    const pass = vi.fn(async () => 'copied' as const);
    const outcome = noticeForAnotherPress(pass, 'copy');
    expect(toasts.shown[0]?.action?.label).toBe('Copy');
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(outcome).resolves.toBe('cancelled');
    expect(toasts.dismissed).toEqual(['toast-0']);
    // Too late now: its button does nothing.
    toasts.shown[0]?.action?.onAction();
    expect(pass).not.toHaveBeenCalled();
  });
});
