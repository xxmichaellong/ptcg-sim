import { afterEach, describe, expect, it, vi } from 'vitest';

import { definePreference, PreferenceStore } from './preference-store.js';

interface Volume {
  readonly level: number;
  readonly muted: boolean;
}

const VOLUME = definePreference<Volume>({
  key: 'test.volume.v1',
  defaults: { level: 5, muted: false },
  parse: (value) => {
    const level =
      typeof value === 'object' && value !== null
        ? Reflect.get(value, 'level')
        : undefined;
    const muted =
      typeof value === 'object' && value !== null
        ? Reflect.get(value, 'muted')
        : undefined;
    return {
      level: typeof level === 'number' && level >= 0 && level <= 10 ? level : 5,
      muted: muted === true,
    };
  },
});

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('PreferenceStore', () => {
  it('reads a preference once, lazily, and field by field', () => {
    const storage = memoryStorage({
      'test.volume.v1': '{"level":99,"muted":true}',
    });
    const store = new PreferenceStore({ storage });
    expect(storage.getItem).not.toHaveBeenCalled();
    // An out-of-range level falls back alone; the valid field survives.
    expect(store.get(VOLUME)).toEqual({ level: 5, muted: true });
    expect(store.get(VOLUME)).toBe(store.get(VOLUME));
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it('falls back to the defaults for missing, corrupt or unreadable storage', () => {
    expect(new PreferenceStore().get(VOLUME)).toBe(VOLUME.defaults);
    expect(
      new PreferenceStore({
        storage: memoryStorage({ 'test.volume.v1': '{nope' }),
      }).get(VOLUME)
    ).toBe(VOLUME.defaults);
    const blocked = () => {
      throw new Error('blocked');
    };
    const store = new PreferenceStore({
      storage: { getItem: blocked, setItem: blocked, removeItem: blocked },
    });
    expect(store.get(VOLUME)).toBe(VOLUME.defaults);
    store.patch(VOLUME, { level: 7 });
    expect(store.get(VOLUME).level).toBe(7);
    expect(() => store.flush()).not.toThrow();
  });

  it('applies changes at once but batches the writes', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const store = new PreferenceStore({ storage, writeDelayMs: 200 });
    const listener = vi.fn();
    store.subscribe(VOLUME, listener);
    for (let level = 0; level <= 10; level += 1) store.patch(VOLUME, { level });
    expect(store.get(VOLUME).level).toBe(10);
    expect(listener).toHaveBeenCalledTimes(11);
    expect(storage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(
      'test.volume.v1',
      '{"level":10}'
    );
  });

  it('publishes nothing for an equal value', () => {
    const store = new PreferenceStore();
    const listener = vi.fn();
    store.subscribe(VOLUME, listener);
    store.patch(VOLUME, { level: 5 });
    store.set(VOLUME, { level: 5, muted: false });
    expect(listener).not.toHaveBeenCalled();
  });

  it('stores only what differs from the defaults and nothing at the defaults', () => {
    const storage = memoryStorage();
    const store = new PreferenceStore({ storage });
    store.patch(VOLUME, { muted: true });
    store.flush();
    expect(storage.data.get('test.volume.v1')).toBe('{"muted":true}');
    store.reset(VOLUME);
    store.flush();
    expect(storage.data.has('test.volume.v1')).toBe(false);
  });

  it('writes what is pending when the page is hidden', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), {
      visibilityState: 'visible',
    });
    const store = new PreferenceStore({
      storage,
      window: win,
      document: doc,
    });
    store.patch(VOLUME, { level: 2 });
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(storage.setItem).not.toHaveBeenCalled();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(storage.data.get('test.volume.v1')).toBe('{"level":2}');
    store.patch(VOLUME, { level: 3 });
    win.dispatchEvent(new Event('pagehide'));
    expect(storage.data.get('test.volume.v1')).toBe('{"level":3}');
  });

  it("follows another tab's change, which supersedes a pending write", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const win = new EventTarget();
    const store = new PreferenceStore({ storage, window: win });
    const listener = vi.fn();
    store.subscribe(VOLUME, listener);
    store.patch(VOLUME, { level: 1 });
    const fromOtherTab = (key: string | null, newValue: string | null) => {
      const event = new Event('storage') as Event & {
        key: string | null;
        newValue: string | null;
      };
      event.key = key;
      event.newValue = newValue;
      win.dispatchEvent(event);
    };
    fromOtherTab('test.volume.v1', '{"level":8}');
    expect(store.get(VOLUME).level).toBe(8);
    expect(listener).toHaveBeenCalledTimes(2);
    vi.runAllTimers();
    expect(storage.setItem).not.toHaveBeenCalled();
    // Unrelated keys and unchanged values publish nothing.
    fromOtherTab('someone.else', '1');
    fromOtherTab('test.volume.v1', '{"level":8}');
    expect(listener).toHaveBeenCalledTimes(2);
    // Cleared storage returns every preference to its defaults.
    fromOtherTab(null, null);
    expect(store.get(VOLUME)).toBe(VOLUME.defaults);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('stops listening and writes what is pending on dispose', () => {
    const storage = memoryStorage();
    const store = new PreferenceStore({ storage });
    const listener = vi.fn();
    store.subscribe(VOLUME, listener);
    store.patch(VOLUME, { muted: true });
    store.dispose();
    expect(storage.data.get('test.volume.v1')).toBe('{"muted":true}');
  });
});
