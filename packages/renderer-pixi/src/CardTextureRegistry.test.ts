import { describe, expect, it, vi } from 'vitest';
import { CardTextureRegistry } from './CardTextureRegistry.js';

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('Pixi card texture registry', () => {
  it('reuses a zero-reference pending load when the same URL is rebound', async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const unload = vi.fn(async () => undefined);
    const registry = new CardTextureRegistry({
      placeholder: 'placeholder',
      load,
      unload,
    });
    const staleReady = vi.fn();
    const currentReady = vi.fn();

    registry.bind('card', '/same.png', staleReady, vi.fn());
    registry.release('card');
    registry.bind('card', '/same.png', currentReady, vi.fn());
    expect(load).toHaveBeenCalledOnce();

    pending.resolve('texture');
    await pending.promise;
    await Promise.resolve();
    expect(staleReady).not.toHaveBeenCalled();
    expect(currentReady).toHaveBeenCalledWith('texture');
    expect(unload).not.toHaveBeenCalled();

    registry.release('card');
    await Promise.resolve();
    expect(unload).toHaveBeenCalledOnce();
  });

  it('deduplicates loads and unloads only after the final card releases the URL', async () => {
    const pending = deferred<{ readonly name: string }>();
    const load = vi.fn(() => pending.promise);
    const unload = vi.fn(async () => undefined);
    const registry = new CardTextureRegistry({
      placeholder: { name: 'placeholder' },
      load,
      unload,
    });
    const firstReady = vi.fn();
    const secondReady = vi.fn();
    registry.bind('card-1', '/same.png', firstReady, vi.fn());
    registry.bind('card-2', '/same.png', secondReady, vi.fn());
    expect(load).toHaveBeenCalledTimes(1);
    registry.release('card-1');
    pending.resolve({ name: 'loaded' });
    await pending.promise;
    await Promise.resolve();
    expect(firstReady).not.toHaveBeenCalled();
    expect(secondReady).toHaveBeenCalledWith({ name: 'loaded' });
    expect(unload).not.toHaveBeenCalled();
    registry.release('card-2');
    await Promise.resolve();
    expect(unload).toHaveBeenCalledOnce();
    expect(unload).toHaveBeenCalledWith('/same.png');
  });

  it('never binds a stale image completion to a card whose URL changed', async () => {
    const oldLoad = deferred<string>();
    const newLoad = deferred<string>();
    const unload = vi.fn(async () => undefined);
    const registry = new CardTextureRegistry({
      placeholder: 'placeholder',
      load: (url) =>
        url === '/old-private.png' ? oldLoad.promise : newLoad.promise,
      unload,
    });
    const ready = vi.fn();
    registry.bind('card', '/old-private.png', ready, vi.fn());
    registry.bind('card', '/card-back.png', ready, vi.fn());
    oldLoad.resolve('old-private-texture');
    await oldLoad.promise;
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    expect(unload).toHaveBeenCalledWith('/old-private.png');

    newLoad.resolve('safe-back-texture');
    await newLoad.promise;
    await Promise.resolve();
    expect(ready).toHaveBeenCalledWith('safe-back-texture');
  });

  it('suppresses late success and failure callbacks after destruction', async () => {
    const pending = deferred<string>();
    const ready = vi.fn();
    const failed = vi.fn();
    const registry = new CardTextureRegistry({
      placeholder: 'placeholder',
      load: () => pending.promise,
      unload: async () => undefined,
    });
    registry.bind('card', '/private.png', ready, failed);
    registry.destroy();
    pending.resolve('texture');
    await pending.promise;
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();

    const rejected = deferred<string>();
    const second = new CardTextureRegistry({
      placeholder: 'placeholder',
      load: () => rejected.promise,
      unload: async () => undefined,
    });
    second.bind('card', '/broken.png', ready, failed);
    second.destroy();
    rejected.reject(new Error('decode failed'));
    await expect(rejected.promise).rejects.toThrow('decode failed');
    await Promise.resolve();
    expect(failed).not.toHaveBeenCalled();
  });
});
