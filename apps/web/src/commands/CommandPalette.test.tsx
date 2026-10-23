// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandPaletteHost } from './CommandPalette.js';
import { closeCommandPalette, isCommandPaletteOpen } from './palette-state.js';
import { registerCommandSource } from './registry.js';
import type { PaletteCommand } from './types.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const press = async (init: KeyboardEventInit, target?: Element | null) => {
  await act(async () => {
    (target ?? document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    );
  });
};

const field = () =>
  document.querySelector<HTMLInputElement>('.ptcgsim-command-palette__field');

const type = async (value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(field(), value);
    field()!.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const selected = () =>
  document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
const crumbs = () =>
  [...document.querySelectorAll('.ptcgsim-command-palette__crumb')].map(
    (crumb) => crumb.textContent
  );
const asked = () =>
  document.querySelector('.ptcgsim-command-palette__asking')?.textContent;

describe('CommandPalette', () => {
  let host: HTMLDivElement;
  let root: Root;
  let unregister: () => void;
  const ran: string[] = [];
  const counted = vi.fn();
  const said = vi.fn();
  const commands: PaletteCommand[] = [
    {
      id: 'turn.attack',
      title: 'Attack',
      section: 'turn',
      run: () => ran.push('attack'),
    },
    {
      id: 'turn.pass',
      title: 'Pass the turn',
      section: 'turn',
      run: () => ran.push('pass'),
    },
    {
      id: 'turn.reset',
      title: 'Reset',
      section: 'turn',
      dangerous: true,
      run: () => ran.push('reset'),
    },
    {
      id: 'deck.drawOne',
      title: 'Draw a card',
      section: 'deck',
      keepOpen: true,
      run: () => ran.push('drawOne'),
    },
    {
      id: 'deck.draw',
      title: 'Draw cards…',
      section: 'deck',
      count: {
        label: 'How many?',
        min: 1,
        max: 9,
        initial: 1,
        title: (n) => `Draw ${n} cards`,
      },
      run: ({ count }) => counted(count),
    },
    {
      id: 'chat.say',
      title: 'Say…',
      section: 'room',
      text: { label: 'Message' },
      run: ({ text }) => said(text),
    },
    {
      id: 'settings.condition',
      title: 'Special Condition…',
      section: 'settings',
      submenu: () => ({
        breadcrumb: 'Special Condition',
        commands: [
          {
            id: 'settings.condition.burned',
            title: 'Burned',
            section: 'settings',
            run: () => ran.push('burned'),
          },
          {
            id: 'settings.condition.asleep',
            title: 'Asleep',
            section: 'settings',
            run: () => ran.push('asleep'),
          },
        ],
      }),
    },
  ];

  beforeEach(async () => {
    localStorage.clear();
    ran.length = 0;
    counted.mockClear();
    said.mockClear();
    unregister = registerCommandSource({ commands: () => commands });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<CommandPaletteHost />));
  });

  afterEach(async () => {
    closeCommandPalette();
    await act(async () => root.unmount());
    host.remove();
    unregister();
  });

  const open = async () => {
    await press({ key: '`', code: 'Backquote' }, document.body);
    expect(isCommandPaletteOpen()).toBe(true);
  };

  it('opens on ` and Ctrl+K, but not while typing elsewhere, and ` closes it', async () => {
    const input = document.createElement('input');
    document.body.append(input);
    await press({ key: '`', code: 'Backquote' }, input);
    expect(isCommandPaletteOpen()).toBe(false);
    input.remove();
    await press({ key: 'k', code: 'KeyK', ctrlKey: true }, document.body);
    expect(isCommandPaletteOpen()).toBe(true);
    expect(document.activeElement).toBe(field());
    await press({ key: '`', code: 'Backquote' });
    expect(isCommandPaletteOpen()).toBe(false);
  });

  it('opens from the deck screen, though not from a dialog', async () => {
    const deckScreen = document.createElement('div');
    deckScreen.className = 'ptcgsim-deck-layer';
    deckScreen.setAttribute('data-ptcgsim-overlay', 'dialog');
    const deckButton = document.createElement('button');
    deckScreen.append(deckButton);
    const dialog = document.createElement('div');
    dialog.setAttribute('data-ptcgsim-overlay', 'dialog');
    const dialogButton = document.createElement('button');
    dialog.append(dialogButton);
    document.body.append(deckScreen, dialog);
    await press({ key: '`', code: 'Backquote' }, dialogButton);
    expect(isCommandPaletteOpen()).toBe(false);
    await press({ key: '`', code: 'Backquote' }, deckButton);
    expect(isCommandPaletteOpen()).toBe(true);
    deckScreen.remove();
    dialog.remove();
  });

  it("stays shut over the table's own windows, which keep their keys", async () => {
    const overlays = document.createElement('div');
    overlays.setAttribute('data-legacy-board-overlays', '');
    const preview = document.createElement('button');
    overlays.append(preview);
    document.body.append(overlays);
    await press({ key: '`', code: 'Backquote' }, preview);
    expect(isCommandPaletteOpen()).toBe(false);
    overlays.remove();
  });

  it('types ~ (Shift+`) rather than closing', async () => {
    await open();
    await press({ key: '~', code: 'Backquote', shiftKey: true });
    expect(isCommandPaletteOpen()).toBe(true);
  });

  it('takes Escape before anything under it listening on the document', async () => {
    const underneath = vi.fn((event: KeyboardEvent) => {
      if (event.key === 'Escape') event.stopPropagation();
    });
    document.addEventListener('keydown', underneath, true);
    await open();
    await type('attack');
    await press({ key: 'Escape' });
    document.removeEventListener('keydown', underneath, true);
    expect(field()?.value).toBe('');
    expect(isCommandPaletteOpen()).toBe(true);
    expect(
      underneath.mock.calls.some(([event]) => event.key === 'Escape')
    ).toBe(false);
  });

  it('runs the chosen command with Enter, after moving with the arrows', async () => {
    await open();
    expect(selected()?.textContent).toContain('Attack');
    await press({ key: 'ArrowDown' });
    expect(selected()?.textContent).toContain('Pass the turn');
    await press({ key: 'ArrowUp' });
    await press({ key: 'ArrowUp' });
    // It wraps round to the last.
    const options = document.querySelectorAll('[role="option"]');
    expect(selected()).toBe(options[options.length - 1]);
    await type('pass');
    await press({ key: 'Enter' });
    expect(ran).toEqual(['pass']);
    expect(isCommandPaletteOpen()).toBe(false);
    // And remembers it, first on an empty search next time.
    await open();
    expect(
      document.querySelector('.ptcgsim-command-palette__heading')?.textContent
    ).toBe('Recent');
    expect(selected()?.textContent).toContain('Pass the turn');
  });

  it('keeps a repeated step chosen while Recent takes it in', async () => {
    await open();
    for (
      let step = 0;
      step < 20 && !selected()?.textContent?.includes('Draw a card');
      step += 1
    )
      await press({ key: 'ArrowDown' });
    expect(selected()?.textContent).toContain('Draw a card');
    expect(
      selected()
        ?.closest('[role="group"]')
        ?.querySelector('.ptcgsim-command-palette__heading')?.textContent
    ).toBe('Deck and hand');
    await press({ key: 'Enter' });
    // Now under Recent as well; the same row stays chosen.
    expect(selected()?.textContent).toContain('Draw a card');
    await press({ key: 'Enter' });
    expect(ran).toEqual(['drawOne', 'drawOne']);
  });

  it('keeps open for a step taken again', async () => {
    await open();
    await type('draw a card');
    await press({ key: 'Enter' });
    await press({ key: 'Enter' });
    expect(ran).toEqual(['drawOne', 'drawOne']);
    expect(isCommandPaletteOpen()).toBe(true);
  });

  it('asks a dangerous command twice', async () => {
    await open();
    await type('reset');
    await press({ key: 'Enter' });
    expect(ran).toEqual([]);
    expect(selected()?.hasAttribute('data-armed')).toBe(true);
    await press({ key: 'Enter' });
    expect(ran).toEqual(['reset']);
  });

  it('takes a count inline, or asks for it and checks it', async () => {
    await open();
    await type('draw 4');
    expect(selected()?.textContent).toContain('Draw 4 cards');
    await press({ key: 'Enter' });
    expect(counted).toHaveBeenCalledWith(4);
    await open();
    await type('draw cards');
    await press({ key: 'Enter' });
    expect(crumbs()).toEqual(['Draw cards']);
    expect(field()?.value).toBe('1');
    // The number hides the field's placeholder, so the question is said
    // under it.
    expect(asked()).toBe('How many?');
    await type('12');
    await press({ key: 'Enter' });
    expect(field()?.getAttribute('aria-invalid')).toBe('true');
    expect(counted).toHaveBeenCalledTimes(1);
    await type('3');
    await press({ key: 'Enter' });
    expect(counted).toHaveBeenLastCalledWith(3);
    expect(isCommandPaletteOpen()).toBe(false);
  });

  it('runs the command as it is when the number is given, not as it was asked', async () => {
    await open();
    await type('draw cards');
    await press({ key: 'Enter' });
    const later = vi.fn();
    const replace = registerCommandSource({
      commands: () => [
        {
          id: 'deck.draw',
          title: 'Draw cards…',
          section: 'deck',
          count: {
            label: 'How many?',
            min: 1,
            max: 9,
            title: (n) => `Draw ${n}`,
          },
          run: ({ count }) => later(count),
        },
      ],
    });
    unregister();
    await act(async () => undefined);
    await type('2');
    await press({ key: 'Enter' });
    replace();
    unregister = registerCommandSource({ commands: () => commands });
    expect(later).toHaveBeenCalledWith(2);
    expect(counted).not.toHaveBeenCalled();
  });

  it('answers with its button too, for a number pad with no Enter', async () => {
    await open();
    await type('draw cards');
    await press({ key: 'Enter' });
    await type('5');
    const done = document.querySelector<HTMLButtonElement>(
      '.ptcgsim-command-palette__submit'
    )!;
    expect(done.textContent).toBe('Done');
    await act(async () => done.click());
    expect(counted).toHaveBeenCalledWith(5);
    expect(isCommandPaletteOpen()).toBe(false);
  });

  it('asks for text, and sends nothing empty', async () => {
    await open();
    await type('say');
    await press({ key: 'Enter' });
    // The empty field shows its own placeholder; nothing repeats it.
    expect(asked()).toBe('');
    await press({ key: 'Enter' });
    expect(said).not.toHaveBeenCalled();
    await type('good game');
    await press({ key: 'Enter' });
    expect(said).toHaveBeenCalledWith('good game');
  });

  it('opens a screen of choices, and Backspace and Escape step back', async () => {
    await open();
    await type('special');
    await press({ key: 'Enter' });
    expect(crumbs()).toEqual(['Special Condition']);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    await press({ key: 'Backspace' });
    expect(crumbs()).toEqual([]);
    // Found from the root, a choice runs at once.
    await type('asleep');
    expect(selected()?.textContent).toContain('Special Condition');
    expect(selected()?.textContent).toContain('Asleep');
    await press({ key: 'Escape' });
    expect(field()?.value).toBe('');
    expect(isCommandPaletteOpen()).toBe(true);
    await press({ key: 'Escape' });
    expect(isCommandPaletteOpen()).toBe(false);
  });

  it('keeps the focus in its field, whatever is pressed or focused behind it', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    await open();
    const heading = document.querySelector(
      '.ptcgsim-command-palette__heading'
    )!;
    const mousedown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      heading.dispatchEvent(mousedown);
    });
    expect(mousedown.defaultPrevented).toBe(true);
    await act(async () => outside.focus());
    expect(document.activeElement).toBe(field());
    await press({ key: 'Escape' });
    expect(isCommandPaletteOpen()).toBe(false);
    // Closed, it lets the focus go.
    await act(async () => outside.focus());
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('keeps the table from hearing what is typed', async () => {
    await open();
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    await press({ key: '2' });
    document.removeEventListener('keydown', heard);
    expect(heard).not.toHaveBeenCalled();
  });
});
