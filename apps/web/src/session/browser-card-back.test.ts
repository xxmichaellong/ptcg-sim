// @vitest-environment happy-dom

import { STANDARD_CARD_BACK } from '@ptcgsim/game-core';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CardBackChooserProps } from '../card-backs/CardBackChooser.js';
import { RECENT_CARD_BACK_PREFERENCES } from '../card-backs/card-back-preferences.js';
import { PreferenceStore } from '../preferences/preference-store.js';
import type { PanelOptions } from '../ui/dialog-requests.js';
import { requestBrowserCardBack } from './browser-card-back.js';

const STORED = `img:${'ab'.repeat(32)}`;
const DESIGN = 'design:1.navy.stripes.gold.star';

/**
 * Stands in for the panel: records what it was opened with and the
 * chooser it shows, and answers as the player does with `pick`.
 */
const panel = (pick: (props: CardBackChooserProps) => string | null) => {
  const opened: PanelOptions[] = [];
  const shown: CardBackChooserProps[] = [];
  const open = vi.fn(async (options: PanelOptions) => {
    opened.push(options);
    let answer: string | null = null;
    const element = options.content((value) => {
      answer = value;
    }) as ReactElement<CardBackChooserProps>;
    shown.push(element.props);
    const picked = pick(element.props);
    if (picked !== null) element.props.onChoose(picked);
    else element.props.onCancel();
    return answer;
  });
  return { open, opened, shown };
};

describe('browser card-back request', () => {
  it('opens the chooser on the seat back with the decks backs and the recent ones', async () => {
    const store = new PreferenceStore();
    store.set(RECENT_CARD_BACK_PREFERENCES, { backs: [DESIGN] });
    const dialog = panel(() => null);

    await expect(
      requestBrowserCardBack({
        open: dialog.open,
        preferences: store,
        current: 'preset:jade',
        worn: [STORED],
      })
    ).resolves.toBeUndefined();
    expect(dialog.opened[0]).toMatchObject({ title: 'Card back' });
    expect(dialog.shown[0]).toMatchObject({
      current: 'preset:jade',
      worn: [STORED],
      recent: [DESIGN],
    });
  });

  it('answers with the back picked; the standard back is a choice like any other', async () => {
    const store = new PreferenceStore();
    await expect(
      requestBrowserCardBack({
        open: panel(() => STANDARD_CARD_BACK).open,
        preferences: store,
      })
    ).resolves.toBe(STANDARD_CARD_BACK);
    // A preset is always on offer, so it isn't kept as a recent back.
    expect(store.get(RECENT_CARD_BACK_PREFERENCES).backs).toEqual([]);
  });

  it('keeps a design or a picture picked first among the recent backs', async () => {
    const store = new PreferenceStore();
    store.set(RECENT_CARD_BACK_PREFERENCES, { backs: [DESIGN, STORED] });

    await expect(
      requestBrowserCardBack({
        open: panel(() => STORED).open,
        preferences: store,
      })
    ).resolves.toBe(STORED);
    expect(store.get(RECENT_CARD_BACK_PREFERENCES).backs).toEqual([
      STORED,
      DESIGN,
    ]);
  });

  it('gives the panel the request signal and changes nothing once aborted', async () => {
    const abort = new AbortController();
    const store = new PreferenceStore();
    const open = vi.fn(
      (options: PanelOptions) =>
        new Promise<string | null>((resolve) => {
          options.signal?.addEventListener('abort', () => resolve(DESIGN));
        })
    );
    const pending = requestBrowserCardBack({
      signal: abort.signal,
      open,
      preferences: store,
    });
    expect(open.mock.calls[0]?.[0].signal).toBe(abort.signal);
    abort.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(store.get(RECENT_CARD_BACK_PREFERENCES).backs).toEqual([]);
  });

  it('never opens once the request is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const dialog = panel(() => STANDARD_CARD_BACK);
    await expect(
      requestBrowserCardBack({ signal: abort.signal, open: dialog.open })
    ).resolves.toBeUndefined();
    expect(dialog.open).not.toHaveBeenCalled();
  });
});
