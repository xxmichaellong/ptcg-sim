// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react';
import { STANDARD_CARD_BACK, STANDARD_COIN } from '@ptcgsim/game-core';
import {
  COIN_PREFERENCES,
  RECENT_COIN_PREFERENCES,
} from '../../card-backs/coin-preferences.js';
import { RECENT_CARD_BACK_PREFERENCES } from '../../card-backs/card-back-preferences.js';
import { OverlayHost } from '../../ui/OverlayHost.js';
import { cancelAllDialogRequests } from '../../ui/dialog-requests.js';
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

it.each(['cardBack', 'coin', 'playmat'] as const)(
  'deletes a %s from decks wearing it and its Undo respects later edits and deleted decks',
  async (kind) => {
    const design = 'design:1.navy.stripes.gold.star';
    const other = 'design:1.forest.plain.cream.none';
    const defaults = {
      cardBack: STANDARD_CARD_BACK,
      coin: STANDARD_COIN,
      playmat: 'style:default',
    };
    const library = new DeckLibrary({ backend: null, channel: null });
    const save = (name: string, look: object) =>
      library.create({ name, format: 'standard', cards: [], ...look });
    const deck = save('Customized', { [kind]: design });
    const second = save('Also wearing it', { [kind]: design });
    const untouched = save('Another design', { [kind]: other });
    // Sleeves and mats share designs; coins keep their own recent choices.
    const shared = save('Shared design', {
      cardBack: design,
      coin: design,
      playmat: design,
    });
    const fields =
      kind === 'coin'
        ? (['coin'] as const)
        : (['cardBack', 'playmat'] as const);
    const store = preferences();
    const beforeCoin = store.get(COIN_PREFERENCES);
    const beforeRecentCoins = store.get(RECENT_COIN_PREFERENCES);
    const beforeRecentBacks = store.get(RECENT_CARD_BACK_PREFERENCES);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const Harness = () => {
      useSyncExternalStore(library.subscribe, library.getSnapshot);
      return (
        <>
          <OverlayHost />
          <DeckCustomize deck={library.get(deck.id)!} library={library} />
        </>
      );
    };
    const click = async (selector: string) => {
      const button = document.querySelector<HTMLButtonElement>(selector);
      expect(button).not.toBeNull();
      await act(async () => button!.click());
    };
    const deleted = () => {
      expect(library.get(deck.id)?.[kind]).toBe(defaults[kind]);
      expect(library.get(second.id)?.[kind]).toBe(defaults[kind]);
      expect(library.get(untouched.id)?.[kind]).toBe(other);
      for (const field of fields)
        expect(library.get(shared.id)?.[field]).toBe(defaults[field]);
      if (kind === 'coin') {
        expect(library.get(shared.id)?.cardBack).toBe(design);
        expect(library.get(shared.id)?.playmat).toBe(design);
        expect(store.get(COIN_PREFERENCES).coin).toBe(STANDARD_COIN);
      } else expect(library.get(shared.id)?.coin).toBe(design);
    };
    try {
      store.set(COIN_PREFERENCES, { coin: design });
      store.set(RECENT_COIN_PREFERENCES, { backs: [design] });
      store.set(RECENT_CARD_BACK_PREFERENCES, { backs: [design] });
      await act(async () => root.render(<Harness />));
      await act(async () =>
        host
          .querySelectorAll<HTMLButtonElement>('.deck-customize__look')
          [['cardBack', 'coin', 'playmat'].indexOf(kind)]!.click()
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      await click('#cardBackMode-backs');
      // Another tab can add a wearer after the chooser has opened.
      let late: ReturnType<typeof save>;
      await act(async () => {
        late = save('Added while choosing', { [kind]: design });
      });
      await click('button[aria-label^="Delete Design"]');
      deleted();
      expect(library.get(late!.id)?.[kind]).toBe(defaults[kind]);
      await click('#undoCardBackDeleteButton');
      expect(library.get(deck.id)?.[kind]).toBe(design);
      expect(library.get(second.id)?.[kind]).toBe(design);
      expect(library.get(late!.id)?.[kind]).toBe(design);
      for (const field of fields)
        expect(library.get(shared.id)?.[field]).toBe(design);
      if (kind === 'coin')
        expect(store.get(COIN_PREFERENCES).coin).toBe(design);
      await click('button[aria-label^="Delete Design"]');
      deleted();
      await act(async () => {
        library.update(deck.id, { [kind]: other });
        library.remove(second.id);
        if (kind === 'coin') store.set(COIN_PREFERENCES, { coin: other });
      });
      await click('#undoCardBackDeleteButton');
      expect(library.get(deck.id)?.[kind]).toBe(other);
      expect(library.get(second.id)).toBeUndefined();
      for (const field of fields)
        expect(library.get(shared.id)?.[field]).toBe(design);
      if (kind === 'coin') expect(store.get(COIN_PREFERENCES).coin).toBe(other);
    } finally {
      await act(async () => {
        cancelAllDialogRequests();
        root.unmount();
        store.set(COIN_PREFERENCES, beforeCoin);
        store.set(RECENT_COIN_PREFERENCES, beforeRecentCoins);
        store.set(RECENT_CARD_BACK_PREFERENCES, beforeRecentBacks);
      });
      library.dispose();
      host.remove();
    }
  }
);
