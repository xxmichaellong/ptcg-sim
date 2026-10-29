// @vitest-environment happy-dom

import { STANDARD_CARD_BACK } from '@ptcgsim/game-core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CardBackChooser,
  type CardBackChooserProps,
} from './CardBackChooser.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const STORED = `img:${'cd'.repeat(32)}`;
const DESIGN = 'design:1.navy.stripes.gold.star';

let root: Root | undefined;

const mount = async (
  props: Partial<CardBackChooserProps> = {}
): Promise<{
  readonly host: HTMLDivElement;
  readonly onChoose: ReturnType<typeof vi.fn>;
  readonly onCancel: ReturnType<typeof vi.fn>;
  readonly fetchPicture: ReturnType<typeof vi.fn>;
}> => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  const fetchPicture = vi.fn(async () => null);
  await act(async () =>
    root!.render(
      <CardBackChooser
        worn={[]}
        recent={[]}
        onChoose={onChoose}
        onCancel={onCancel}
        fetchPicture={fetchPicture}
        savePicture={async () => null}
        {...props}
      />
    )
  );
  return { host, onChoose, onCancel, fetchPicture };
};

const radio = (host: HTMLElement, value: string): HTMLInputElement => {
  const found = host.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${value}"]`
  );
  if (!found) throw new Error(`no ${value} choice`);
  return found;
};

const use = (host: HTMLElement): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>('#useCardBackButton')!;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe('card-back chooser', () => {
  it('opens on the standard back, a tile of its own, and uses it as it is', async () => {
    const { host, onChoose } = await mount();
    const standard = host.querySelector<HTMLInputElement>(
      '#standardCardBackChoice'
    )!;
    expect(standard.value).toBe(STANDARD_CARD_BACK);
    expect(standard.checked).toBe(true);
    expect(standard.closest('label')?.textContent).toContain('Standard back');
    await act(async () => use(host).click());
    expect(onChoose).toHaveBeenCalledWith(STANDARD_CARD_BACK);
  });

  it('picks a preset from the grid', async () => {
    const { host, onChoose } = await mount({ current: STANDARD_CARD_BACK });
    await act(async () => radio(host, 'preset:crimson').click());
    expect(radio(host, 'preset:crimson').checked).toBe(true);
    await act(async () => use(host).click());
    expect(onChoose).toHaveBeenCalledWith('preset:crimson');
  });

  it("offers the player's own backs once each, never a preset twice or an outside URL", async () => {
    const { host } = await mount({
      current: STORED,
      recent: [DESIGN, STORED],
      worn: [STORED, 'preset:jade', 'https://example.test/back.png', DESIGN],
    });
    const values = [
      ...host.querySelectorAll<HTMLInputElement>('.card-back-grid input'),
    ].map((input) => input.value);
    expect(values).toEqual([
      STANDARD_CARD_BACK,
      'preset:crimson',
      'preset:azure',
      'preset:jade',
      'preset:amber',
      'preset:violet',
      DESIGN,
      STORED,
    ]);
    expect(radio(host, STORED).checked).toBe(true);
  });

  it('designs a sleeve from the lists and uses its reference', async () => {
    const { host, onChoose } = await mount({ current: DESIGN });
    // A designed back opens the designer on its own values.
    expect(
      host.querySelector('.card-back-chooser')?.getAttribute('data-mode')
    ).toBe('design');
    await act(async () => radio(host, 'dots').click());
    await act(async () => radio(host, 'moon').click());
    await act(async () => use(host).click());
    expect(onChoose).toHaveBeenCalledWith('design:1.navy.dots.gold.moon');
  });

  it('says plainly when a link gives no picture, and has nothing to use', async () => {
    const { host, fetchPicture, onChoose } = await mount();
    await act(async () =>
      host.querySelector<HTMLInputElement>('#cardBackMode-picture')!.click()
    );
    expect(use(host).disabled).toBe(true);
    const field = host.querySelector<HTMLInputElement>('#cardBackLinkInput')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!;
      setValue.call(field, '  https://pictures.example/back.png  ');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      field.form!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    );
    expect(fetchPicture).toHaveBeenCalledWith(
      'https://pictures.example/back.png',
      expect.any(AbortSignal)
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't get a picture from that link."
    );
    expect(use(host).disabled).toBe(true);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('turns away a file that is not a picture, in plain words', async () => {
    const { host } = await mount();
    await act(async () =>
      host.querySelector<HTMLInputElement>('#cardBackMode-picture')!.click()
    );
    const input = host.querySelector<HTMLInputElement>('#cardBackFileInput')!;
    const file = new File(['not a picture'], 'notes.txt', {
      type: 'text/plain',
    });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true }))
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "That file isn't a picture."
    );
  });

  it('cancels without choosing', async () => {
    const { host, onCancel, onChoose } = await mount();
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[data-dialog-action="cancel"]')!
        .click()
    );
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onChoose).not.toHaveBeenCalled();
  });
});
