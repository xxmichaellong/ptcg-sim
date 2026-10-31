// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSearchTyping } from './search-typing.js';

const Screen = () => {
  const ref = useRef<HTMLDivElement>(null);
  useSearchTyping(ref);
  return (
    <div ref={ref} className="deck-screen">
      <section className="card-search">
        <input id="cardSearch" type="search" />
        <button id="result" type="button">
          Dragapult ex
        </button>
      </section>
      <input id="deckFinder" type="search" />
      <input id="deckName" type="text" />
    </div>
  );
};

describe('useSearchTyping', () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  const mount = () => {
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<Screen />));
    return {
      screen: host.querySelector<HTMLElement>('.deck-screen')!,
      get: (id: string) => host.querySelector<HTMLElement>(`#${id}`)!,
    };
  };
  const pointer = (type: 'pointerdown' | 'pointerup', target: Element) =>
    target.dispatchEvent(new Event(type, { bubbles: true }));

  it('marks a search being typed into, the card search apart', () => {
    const { screen, get } = mount();
    act(() => get('cardSearch').focus());
    expect(screen.dataset.searchTyping).toBe('card');
    act(() => get('deckFinder').focus());
    expect(screen.dataset.searchTyping).toBe('other');
    act(() => get('deckName').focus());
    expect(screen.dataset.searchTyping).toBeUndefined();
  });

  it('keeps the layout through a tap on a result until its click is through', () => {
    vi.useFakeTimers();
    const { screen, get } = mount();
    act(() => get('cardSearch').focus());
    // A finger on a result: the press, then the focus moves to it (a
    // touch's compatibility mousedown), then the click.
    pointer('pointerdown', get('result'));
    pointer('pointerup', get('result'));
    act(() => get('result').focus());
    expect(screen.dataset.searchTyping).toBe('card');
    act(() => {
      get('result').click();
    });
    expect(screen.dataset.searchTyping).toBe('card');
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(screen.dataset.searchTyping).toBeUndefined();
  });

  it('lets the layout come back after a press that never clicks', () => {
    vi.useFakeTimers();
    const { screen, get } = mount();
    act(() => get('cardSearch').focus());
    pointer('pointerdown', get('result'));
    act(() => get('result').focus());
    pointer('pointerup', get('result'));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.dataset.searchTyping).toBeUndefined();
  });
});
