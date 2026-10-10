import { describe, expect, it, vi } from 'vitest';
import {
  CardTextureRegistry,
  TextureAssetLeaseBroker,
} from './CardTextureRegistry.js';

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
  it('coordinates active URL leases across renderer-local registries', async () => {
    const load = vi.fn(async () => 'shared-texture');
    const unload = vi.fn(async () => undefined);
    const assets = { placeholder: 'placeholder', load, unload };
    const broker = new TextureAssetLeaseBroker(assets);
    const first = new CardTextureRegistry(broker);
    const second = new CardTextureRegistry(broker);

    first.bind('first-card', '/shared.png', vi.fn(), vi.fn());
    second.bind('second-card', '/shared.png', vi.fn(), vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
    expect(first.getDiagnostics()).toMatchObject({
      bindings: 1,
      entries: 1,
      references: 2,
    });

    first.destroy();
    await Promise.resolve();
    expect(unload).not.toHaveBeenCalled();
    expect(second.getDiagnostics()).toMatchObject({
      bindings: 1,
      entries: 1,
      references: 1,
    });

    second.destroy();
    await Promise.resolve();
    await Promise.resolve();
    expect(unload).toHaveBeenCalledOnce();
    expect(broker.getDiagnostics().references).toBe(0);
  });

  it('returns broker-bound leases whose release is idempotent', async () => {
    const unload = vi.fn(async () => undefined);
    const broker = new TextureAssetLeaseBroker({
      placeholder: 'placeholder',
      load: async () => 'texture',
      unload,
    });
    const first = broker.acquire('/shared.png');
    const second = broker.acquire('/shared.png');
    await first.promise;

    first.release();
    first.release();
    await Promise.resolve();
    expect(broker.getDiagnostics().references).toBe(1);
    expect(unload).not.toHaveBeenCalled();

    second.release();
    await vi.waitFor(() => expect(unload).toHaveBeenCalledOnce());
    expect(broker.getDiagnostics().references).toBe(0);
  });

  it('waits for an in-flight global unload before reloading the same URL', async () => {
    const unloading = deferred<void>();
    const calls: string[] = [];
    const assets = {
      placeholder: 'placeholder',
      load: vi.fn(async (url: string) => {
        calls.push(`load:${url}`);
        return `texture:${calls.length}`;
      }),
      unload: vi.fn(async (url: string) => {
        calls.push(`unload:${url}`);
        await unloading.promise;
      }),
    };
    const broker = new TextureAssetLeaseBroker(assets);
    const first = new CardTextureRegistry(broker);
    const second = new CardTextureRegistry(broker);

    first.bind('first-card', '/race.png', vi.fn(), vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    first.destroy();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(['load:/race.png', 'unload:/race.png']);

    const ready = vi.fn();
    second.bind('second-card', '/race.png', ready, vi.fn());
    await Promise.resolve();
    expect(assets.load).toHaveBeenCalledOnce();
    expect(broker.getDiagnostics()).toMatchObject({
      entries: 2,
      pendingEntries: 1,
      unloadingEntries: 1,
      references: 1,
    });

    unloading.resolve();
    await unloading.promise;
    await vi.waitFor(() => expect(assets.load).toHaveBeenCalledTimes(2));
    expect(calls).toEqual([
      'load:/race.png',
      'unload:/race.png',
      'load:/race.png',
    ]);
    expect(ready).toHaveBeenCalledWith('texture:3');
    second.destroy();
  });

  it('contains a synchronous unload failure before a replacement load', async () => {
    const calls: string[] = [];
    const assets = {
      placeholder: 'placeholder',
      load: vi.fn(async (url: string) => {
        calls.push(`load:${url}`);
        return `texture:${calls.length}`;
      }),
      unload: vi.fn((url: string): Promise<void> => {
        calls.push(`unload:${url}`);
        throw new Error('synchronous unload failure');
      }),
    };
    const broker = new TextureAssetLeaseBroker(assets);
    const first = new CardTextureRegistry(broker);
    const second = new CardTextureRegistry(broker);

    first.bind('first-card', '/sync-race.png', vi.fn(), vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    first.destroy();
    await Promise.resolve();
    expect(broker.getDiagnostics()).toMatchObject({
      entries: 1,
      unloadingEntries: 1,
      references: 0,
    });

    const ready = vi.fn();
    second.bind('second-card', '/sync-race.png', ready, vi.fn());
    expect(assets.load).toHaveBeenCalledOnce();
    expect(broker.getDiagnostics()).toMatchObject({
      entries: 2,
      pendingEntries: 1,
      unloadingEntries: 1,
      references: 1,
    });

    await vi.waitFor(() => expect(assets.load).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([
      'load:/sync-race.png',
      'unload:/sync-race.png',
      'load:/sync-race.png',
    ]);
    expect(ready).toHaveBeenCalledWith('texture:3');
    expect(broker.getDiagnostics()).toMatchObject({
      entries: 1,
      unloadingEntries: 0,
      references: 1,
      unloadFailures: 1,
    });
    second.destroy();
  });

  it('reports and counts an asynchronous unload failure', async () => {
    const failure = new Error('asynchronous unload failure');
    const reportError = vi.fn();
    const broker = new TextureAssetLeaseBroker({
      placeholder: 'placeholder',
      load: async () => 'texture',
      unload: async () => {
        throw failure;
      },
    });
    const registry = new CardTextureRegistry(broker, reportError);

    registry.bind('card', '/broken-unload.png', vi.fn(), vi.fn());
    await Promise.resolve();
    registry.destroy();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(failure));
    expect(broker.getDiagnostics()).toMatchObject({
      entries: 0,
      references: 0,
      unloadFailures: 1,
    });
  });

  it('keeps duplicate callback registrations independent across registries', async () => {
    const failure = new Error('shared observer unload failure');
    const reportError = vi.fn();
    const broker = new TextureAssetLeaseBroker({
      placeholder: 'placeholder',
      load: async () => 'texture',
      unload: async () => {
        throw failure;
      },
    });
    const first = new CardTextureRegistry(broker, reportError);
    const second = new CardTextureRegistry(broker, reportError);
    first.bind('first', '/shared-failure.png', vi.fn(), vi.fn());
    second.bind('second', '/shared-failure.png', vi.fn(), vi.fn());
    await Promise.resolve();

    first.destroy();
    expect(reportError).not.toHaveBeenCalled();
    second.destroy();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(failure));
    expect(reportError).toHaveBeenCalledOnce();
    expect(broker.getDiagnostics().unloadFailures).toBe(1);
  });

  it('reuses a zero-reference pending load when the same URL is rebound', async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const unload = vi.fn(async () => undefined);
    const registry = new CardTextureRegistry(
      new TextureAssetLeaseBroker({
        placeholder: 'placeholder',
        load,
        unload,
      })
    );
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
    const registry = new CardTextureRegistry(
      new TextureAssetLeaseBroker({
        placeholder: { name: 'placeholder' },
        load,
        unload,
      })
    );
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
    const registry = new CardTextureRegistry(
      new TextureAssetLeaseBroker({
        placeholder: 'placeholder',
        load: (url) =>
          url === '/old-private.png' ? oldLoad.promise : newLoad.promise,
        unload,
      })
    );
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
    const registry = new CardTextureRegistry(
      new TextureAssetLeaseBroker({
        placeholder: 'placeholder',
        load: () => pending.promise,
        unload: async () => undefined,
      })
    );
    registry.bind('card', '/private.png', ready, failed);
    registry.destroy();
    pending.resolve('texture');
    await pending.promise;
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();

    const rejected = deferred<string>();
    const second = new CardTextureRegistry(
      new TextureAssetLeaseBroker({
        placeholder: 'placeholder',
        load: () => rejected.promise,
        unload: async () => undefined,
      })
    );
    second.bind('card', '/broken.png', ready, failed);
    second.destroy();
    rejected.reject(new Error('decode failed'));
    await expect(rejected.promise).rejects.toThrow('decode failed');
    await Promise.resolve();
    expect(failed).not.toHaveBeenCalled();
  });
});
