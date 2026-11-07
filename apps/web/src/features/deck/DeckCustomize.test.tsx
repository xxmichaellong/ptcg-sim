// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { preferences } from '../../preferences/preference-store.js';
import { DeckCustomize } from './DeckCustomize.js';
import { DeckLibrary } from './deck-library.js';
import { DECK_LOOK_THEMES } from './deck-look-themes.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it.each([{ isComposing: true }, { keyCode: 229 }])(
  'waits for a completed theme name ($isComposing, $keyCode)',
  async (init) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host),
      library = new DeckLibrary({ backend: null, channel: null });
    const store = preferences(),
      before = store.get(DECK_LOOK_THEMES);
    try {
      const deck = library.create({
        name: 'Theme test',
        format: 'standard',
        cards: [],
      });
      await act(async () =>
        root.render(<DeckCustomize deck={deck} library={library} />)
      );
      const input = host.querySelector<HTMLInputElement>(
        '[aria-label="Theme name"]'
      )!;
      await act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )!.set!.call(input, 'うみ');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            ...init,
            bubbles: true,
            cancelable: true,
          })
        )
      );
      expect(input.value).toBe('うみ');
      expect(store.get(DECK_LOOK_THEMES)).toEqual(before);
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          })
        )
      );
      expect(store.get(DECK_LOOK_THEMES).themes.at(-1)?.name).toBe('うみ');
      expect(input.value).toBe('');
    } finally {
      await act(async () => {
        root.unmount();
        store.set(DECK_LOOK_THEMES, before);
      });
      library.dispose();
      host.remove();
    }
  }
);
