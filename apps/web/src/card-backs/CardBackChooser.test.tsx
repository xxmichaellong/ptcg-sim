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

  it('takes a picture link pasted while a back or a mode has the focus', async () => {
    const { host, fetchPicture } = await mount();
    const preset = host.querySelector<HTMLInputElement>(
      '#standardCardBackChoice'
    )!;
    preset.focus();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        files: [],
        getData: (type: string) =>
          type === 'text/plain' ? 'https://pictures.example/back.png' : '',
      },
    });
    await act(async () => {
      preset.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(true);
    expect(fetchPicture).toHaveBeenCalledWith(
      'https://pictures.example/back.png',
      expect.any(AbortSignal)
    );
  });

  it('lets go of a link still on its way when another way is chosen', async () => {
    let arrive: (blob: Blob) => void = () => undefined;
    const fetchPicture = vi.fn(
      () =>
        new Promise<Blob | null>((resolve) => {
          arrive = resolve;
        })
    );
    const { host, onChoose } = await mount({ fetchPicture });
    await act(async () =>
      host.querySelector<HTMLInputElement>('#cardBackMode-picture')!.click()
    );
    const field = host.querySelector<HTMLInputElement>('#cardBackLinkInput')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(field, 'https://pictures.example/back.png');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      field.form!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    );
    expect(use(host).disabled).toBe(true);
    await act(async () =>
      host.querySelector<HTMLInputElement>('#cardBackMode-design')!.click()
    );
    expect(use(host).disabled).toBe(false);
    // The picture arriving late leaves the chooser where it is.
    await act(async () => arrive(new Blob(['back'], { type: 'image/png' })));
    expect(
      host.querySelector('.card-back-chooser')?.getAttribute('data-mode')
    ).toBe('design');
    await act(async () => use(host).click());
    expect(onChoose).toHaveBeenCalledWith(expect.stringMatching(/^design:/));
  });

  it('keeps the browser from opening a file dropped while a link is on its way', async () => {
    const fetchPicture = vi.fn(() => new Promise<Blob | null>(() => {}));
    const { host } = await mount({ fetchPicture });
    await act(async () =>
      host.querySelector<HTMLInputElement>('#cardBackMode-picture')!.click()
    );
    const field = host.querySelector<HTMLInputElement>('#cardBackLinkInput')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(field, 'https://pictures.example/back.png');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      field.form!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    );
    const target = host.querySelector('.card-back-chooser')!;
    const file = new File(['x'], 'other.png', { type: 'image/png' });
    const drag = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: {
          files: [file],
          types: ['Files'],
          dropEffect: 'none',
          getData: () => '',
        },
      });
      target.dispatchEvent(event);
      return event;
    };
    let over!: Event;
    let dropped!: Event;
    await act(async () => {
      over = drag('dragover');
      dropped = drag('drop');
    });
    expect(over.defaultPrevented).toBe(true);
    expect(dropped.defaultPrevented).toBe(true);
    // Busy, the drop is let go: the link is still the one on its way.
    expect(fetchPicture).toHaveBeenCalledOnce();
    expect(use(host).disabled).toBe(true);
  });

  it('shows and saves the picture taken last, though an earlier one is read after it', async () => {
    // Each picture is read when the test says so, in any order.
    const reads: (() => void)[] = [];
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          reads.push(resolve);
        })
    );
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(
      504
    );
    vi.spyOn(
      HTMLImageElement.prototype,
      'naturalHeight',
      'get'
    ).mockReturnValue(704);
    const savePicture = vi.fn(async () => STORED);
    const { host, onChoose } = await mount({ savePicture });
    const paste = async (file: File): Promise<void> => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { files: [file], getData: () => '' },
      });
      await act(async () => {
        host.firstElementChild!.dispatchEvent(event);
      });
    };
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });
    await paste(first);
    await paste(second);
    expect(reads).toHaveLength(2);
    // Nothing to use while a picture is being read.
    expect(use(host).disabled).toBe(true);
    await act(async () => reads[1]!());
    await act(async () => reads[0]!());
    expect(use(host).disabled).toBe(false);
    await act(async () => use(host).click());
    expect(savePicture).toHaveBeenCalledOnce();
    expect(savePicture.mock.calls[0]![0]).toBe(second);
    expect(onChoose).toHaveBeenCalledWith(STORED);
    vi.restoreAllMocks();
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
