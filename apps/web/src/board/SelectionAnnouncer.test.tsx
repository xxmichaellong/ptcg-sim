// @vitest-environment happy-dom

import { asViewCardId, type ViewCardId } from '@ptcgsim/game-core';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SELECTION_ANNOUNCE_MS,
  SelectionAnnouncer,
  selectionAnnouncement,
} from './SelectionAnnouncer.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(asViewCardId) as [
  ViewCardId,
  ViewCardId,
  ViewCardId,
  ViewCardId,
];
const names: Record<string, string> = {
  a: 'Fire Energy',
  b: 'Switch',
  c: 'Pikachu',
  d: 'Ultra Ball',
};
const labelOf = (cardId: ViewCardId) => names[cardId];
const onTable = (cardId: ViewCardId) => cardId !== d;
const sel = (items: readonly ViewCardId[], mode = false) => ({ items, mode });

describe('what a change to the selection says', () => {
  it('counts a group, and names the one card added or taken out', () => {
    expect(
      selectionAnnouncement(sel([]), sel([a, b, c]), labelOf, onTable)
    ).toBe('3 cards selected');
    expect(
      selectionAnnouncement(sel([a, b]), sel([a, b, c]), labelOf, onTable)
    ).toBe('Pikachu added, 3 selected');
    expect(
      selectionAnnouncement(sel([a, b, c]), sel([a, c]), labelOf, onTable)
    ).toBe('Switch removed, 2 selected');
    // From one to two: a group begins.
    expect(selectionAnnouncement(sel([a]), sel([a, b]), labelOf, onTable)).toBe(
      'Switch added, 2 selected'
    );
  });

  it('says when cards left with the table, and when the selection is cleared', () => {
    expect(
      selectionAnnouncement(sel([a, b, d]), sel([a, b]), labelOf, onTable)
    ).toBe('1 card left the selection, 2 selected');
    expect(
      selectionAnnouncement(sel([a, b, c]), sel([]), labelOf, onTable)
    ).toBe('Selection cleared');
  });

  it('says nothing for one card picked or let go of, as before groups', () => {
    expect(
      selectionAnnouncement(sel([]), sel([a]), labelOf, onTable)
    ).toBeNull();
    expect(
      selectionAnnouncement(sel([a]), sel([b]), labelOf, onTable)
    ).toBeNull();
    expect(
      selectionAnnouncement(sel([a]), sel([]), labelOf, onTable)
    ).toBeNull();
    expect(
      selectionAnnouncement(sel([a, b]), sel([a, b]), labelOf, onTable)
    ).toBeNull();
  });

  it("speaks in touch's selection mode, from its first card", () => {
    expect(
      selectionAnnouncement(sel([a]), sel([a], true), labelOf, onTable)
    ).toBe('Selecting: tap cards to add them');
    expect(
      selectionAnnouncement(sel([a], true), sel([a, b], true), labelOf, onTable)
    ).toBe('Switch added, 2 selected');
    expect(
      selectionAnnouncement(sel([a], true), sel([], true), labelOf, onTable)
    ).toBe('Selection cleared');
  });
});

describe('the selection status region', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.replaceChildren(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
  });
  const render = (selection: readonly ViewCardId[], mode = false) =>
    act(async () =>
      root.render(
        <SelectionAnnouncer
          selection={selection}
          selectionMode={mode}
          labelOf={labelOf}
          present={onTable}
        />
      )
    );
  const region = () =>
    host.querySelector<HTMLElement>('[data-selection-announcer]')!;

  it('still speaks after StrictMode runs its effects twice', async () => {
    const strict = (selection: readonly ViewCardId[]) =>
      act(async () =>
        root.render(
          <StrictMode>
            <SelectionAnnouncer
              selection={selection}
              selectionMode={false}
              labelOf={labelOf}
              present={onTable}
            />
          </StrictMode>
        )
      );
    await strict([]);
    await strict([a, b]);
    await act(async () => vi.advanceTimersByTime(SELECTION_ANNOUNCE_MS));
    expect(region().textContent).toBe('2 cards selected');
  });

  it('reads changes close together as one, replacing what it said', async () => {
    await render([]);
    expect(region().getAttribute('role')).toBe('status');
    expect(region().textContent).toBe('');
    // A rectangle's cards, one render each: one announcement.
    await render([a]);
    await render([a, b]);
    await render([a, b, c]);
    expect(region().textContent).toBe('');
    await act(async () => vi.advanceTimersByTime(SELECTION_ANNOUNCE_MS));
    expect(region().textContent).toBe('3 cards selected');
    // The next change replaces it.
    await render([a, b]);
    await act(async () => vi.advanceTimersByTime(SELECTION_ANNOUNCE_MS));
    expect(region().textContent).toBe('Pikachu removed, 2 selected');
  });
});
