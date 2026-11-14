// @vitest-environment happy-dom

import { decodeCatalog } from '@ptcgsim/deck-core';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import fixture from '../../../../../tests/fixtures/card-catalog.json';
import { CardSearchPanel } from './CardSearchPanel.js';
import type {
  CardCatalogSource,
  CardCatalogState,
} from './card-catalog-contract.js';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state: CardCatalogState = {
  status: 'ready',
  catalog: decodeCatalog(fixture),
};
const catalog: CardCatalogSource = {
  getSnapshot: () => state,
  subscribe: () => () => undefined,
  load: () => undefined,
  retry: () => undefined,
};

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <CardSearchPanel
        catalog={catalog}
        deck={[]}
        format="standard"
        searchRef={createRef()}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onInspect={() => undefined}
        onCustomCard={() => undefined}
        onZoom={() => undefined}
        onZoomEnd={() => undefined}
        onZoomSourceGone={() => undefined}
        onScroll={() => undefined}
      />
    )
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const box = (): HTMLInputElement =>
  host.querySelector<HTMLInputElement>('#nativeDeckBuilderSearchInput')!;
const type = async (value: string): Promise<void> => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(box(), value);
    box().dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const press = async (element: Element | null | undefined): Promise<void> => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
};
const button = (label: string): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const drawer = (): HTMLElement | null =>
  host.querySelector<HTMLElement>('[role="group"][aria-label="More filters"]');
/** The drawer's own: the type filters above it have Fire too. */
const control = (label: string): HTMLButtonElement | null =>
  drawer()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
  null;
const results = (): string[] =>
  [...host.querySelectorAll('.card-result__name')].map(
    (name) => name.textContent ?? ''
  );

describe('More filters', () => {
  it('shows what the search box says, and writes what is chosen into it', async () => {
    await type('hp>=200 ac<=RR reg:H charizard');
    expect(button('More filters')!.textContent).toContain('3');
    await press(button('More filters'));
    expect(drawer()).not.toBeNull();
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="Min HP"]')!.value
    ).toBe('200');
    expect(control('Fire: 2')).not.toBeNull();
    expect(
      [...host.querySelectorAll('.filter-marks__mark')]
        .filter((mark) => mark.getAttribute('aria-pressed') === 'true')
        .map((mark) => mark.textContent)
    ).toEqual(['H']);

    // A control changes its own word, in its place.
    await press(control('Fire: 2'));
    expect(box().value).toBe('hp>=200 ac<=RRR reg:H charizard');
    await press(control('Colorless'));
    expect(box().value).toBe('hp>=200 ac<=RRRC reg:H charizard');
    await press(
      [...host.querySelectorAll('.filter-marks__mark')].find(
        (mark) => mark.textContent === 'G'
      )
    );
    expect(box().value).toBe('hp>=200 ac<=RRRC reg:G,H charizard');
    await act(async () =>
      host.querySelector<HTMLInputElement>('#advanced-retreat-1')!.click()
    );
    expect(box().value).toBe('hp>=200 ac<=RRRC reg:G,H charizard rc<=1 ');
    await press(control('Lower Min HP'));
    expect(box().value).toBe('hp>=190 ac<=RRRC reg:G,H charizard rc<=1 ');
    await press(control('Clear'));
    expect(box().value).toBe('hp>=190 reg:G,H charizard rc<=1 ');

    // Reset takes the drawer's words out and leaves the name.
    await press(
      [...drawer()!.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === 'Reset'
      )
    );
    expect(box().value).toBe('charizard');
    expect(button('More filters')!.textContent).not.toMatch(/\d/u);
  });

  it('finds the cards the controls ask for', async () => {
    await press(button('More filters'));
    await press(control('Fire'));
    await press(control('Fire: 1'));
    expect(box().value).toBe('ac<=RR ');
    // Standard-legal attacks paid with two Fire: Jet Headbutt (C) and
    // Burst Roar (C), never Irritated Outburst (DD).
    const found = results();
    expect(found).toEqual(
      expect.arrayContaining(['Dragapult ex', 'Raging Bolt ex'])
    );
    expect(found).not.toContain('Pecharunt ex');
  });

  it('reads a set typed in the box as the set it names', async () => {
    await type('e:"Paldea Evolved"');
    await press(button('More filters'));
    const chips = [...host.querySelectorAll('.filter-list__chip')].map(
      (chip) => chip.textContent
    );
    expect(chips).toEqual(['PAL']);
    await press(control('Remove Paldea Evolved'));
    expect(box().value).toBe('');
  });
});
