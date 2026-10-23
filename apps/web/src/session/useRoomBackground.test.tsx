// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import type {
  BrowserRoomBackgroundRequest,
  RoomBackground,
} from './browser-room-background.js';
import { useRoomBackground } from './useRoomBackground.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
};

it('keeps only the latest request and aborts outstanding work on teardown', async () => {
  const first = deferred<RoomBackground | undefined>();
  const second = deferred<RoomBackground | undefined>();
  const third = deferred<RoomBackground | undefined>();
  const pending = [first, second, third];
  const signals: AbortSignal[] = [];
  const requestBackground = vi.fn<BrowserRoomBackgroundRequest>((options) => {
    signals.push(options?.signal as AbortSignal);
    return pending.shift()!.promise;
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const Harness = () => {
    const background = useRoomBackground({ requestBackground });
    return (
      <button
        type="button"
        data-kind={background.background?.kind ?? 'default'}
        data-url={
          background.background?.kind === 'image'
            ? background.background.url
            : ''
        }
        onClick={background.chooseBackground}
      >
        Choose
      </button>
    );
  };

  await act(async () => root.render(<Harness />));
  const button = host.querySelector('button')!;
  await act(async () => button.click());
  await act(async () => button.click());
  expect(signals[0]?.aborted).toBe(true);
  expect(signals[1]?.aborted).toBe(false);

  await act(async () => {
    first.resolve({ kind: 'image', url: 'https://stale.example/one.png' });
    await first.promise;
  });
  expect(button.dataset.kind).toBe('default');

  await act(async () => {
    second.resolve({ kind: 'image', url: 'https://latest.example/two.png' });
    await second.promise;
  });
  expect(button.dataset.kind).toBe('image');
  expect(button.dataset.url).toBe('https://latest.example/two.png');

  await act(async () => button.click());
  await act(async () => root.unmount());
  expect(signals[2]?.aborted).toBe(true);
  third.resolve({ kind: 'blank' });
});
