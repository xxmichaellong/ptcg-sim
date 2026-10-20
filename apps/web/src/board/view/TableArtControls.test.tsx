// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { preferences } from '../../preferences/preference-store.js';
import { TABLE_ARTS } from '../../session/table-art.js';
import { TABLE_PREFERENCES } from '../../session/table-preferences.js';
import { TableArtControls } from './TableArtControls.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const input = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;

beforeEach(() => {
  preferences().reset(TABLE_PREFERENCES);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  preferences().reset(TABLE_PREFERENCES);
});

describe('TableArtControls', () => {
  it('offers every look as a swatch painted in its own colours', async () => {
    await act(async () => root.render(<TableArtControls />));
    const swatches = [
      ...host.querySelectorAll<HTMLElement>('[data-table-art-swatch]'),
    ];
    expect(swatches.map((swatch) => swatch.dataset.tableArtSwatch)).toEqual(
      TABLE_ARTS.map((look) => look.id)
    );
    expect(
      [...host.querySelectorAll('.table-art-swatch__name')].map(
        (name) => name.textContent
      )
    ).toEqual(TABLE_ARTS.map((look) => look.name));
    expect(host.querySelector('legend')?.textContent).toBe('Table style');
    // Cream is the table for everyone who never chose.
    expect(input('tableArt-cream').checked).toBe(true);
  });

  it('applies a choice at once and keeps it', async () => {
    await act(async () => root.render(<TableArtControls />));
    await act(async () => input('tableArt-slate').click());
    expect(preferences().get(TABLE_PREFERENCES).art).toBe('slate');
    expect(input('tableArt-slate').checked).toBe(true);
    expect(input('tableArt-cream').checked).toBe(false);
    // Another tab's choice shows here too.
    await act(async () =>
      preferences().patch(TABLE_PREFERENCES, { art: 'burgundy' })
    );
    expect(input('tableArt-burgundy').checked).toBe(true);
  });
});
