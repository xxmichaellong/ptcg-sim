// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TableRail } from '../../board/rail/TableRail.js';
import { preferences } from '../../preferences/preference-store.js';
import { AppMenu, type AppMenuModel } from './AppMenu.js';
import { closeHelpPage, HelpSheetHost, RELEASE_NAME } from './help-pages.js';
import { SHELL_PREFERENCES } from './shell-preferences.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Lets Base UI's menus open, close and move focus. */
const settle = async (rounds = 3): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

let touchOnly = false;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  touchOnly = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('hover: none') ? touchOnly : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  preferences().reset(SHELL_PREFERENCES);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  closeHelpPage();
  document.body.replaceChildren();
  preferences().reset(SHELL_PREFERENCES);
  vi.unstubAllGlobals();
});

const model = (overrides: Partial<AppMenuModel> = {}): AppMenuModel => ({
  heading: 'Solo table',
  onPlayOnline: vi.fn(),
  onDeck: vi.fn(),
  onSettings: vi.fn(),
  onFullscreen: vi.fn(),
  onReloadImages: vi.fn(),
  ...overrides,
});

/** The menu on a rail as wide as `width`, as the table draws it. */
const render = async (menu: AppMenuModel, width = 1200): Promise<void> => {
  await act(async () =>
    root.render(
      <>
        <TableRail
          anchor={{ x: 200, y: 400, height: 40 }}
          width={width}
          start={<AppMenu model={menu} />}
          actions={[]}
        />
        <HelpSheetHost />
      </>
    )
  );
  await settle(1);
};

const toolbarIds = (): string[] =>
  [
    ...document.querySelectorAll(
      '.ptcgsim-app-toolbar .ptcgsim-rail-button[id]'
    ),
  ].map((button) => button.id);

const press = async (selector: string): Promise<void> => {
  await act(async () =>
    document.querySelector<HTMLButtonElement>(selector)!.click()
  );
  await settle();
};

/** Opens a menu from its button and lists its entries. */
const openMenu = async (selector: string): Promise<string[]> => {
  await press(selector);
  return [
    ...document.querySelectorAll('[role="menu"] [role="menuitem"][id]'),
  ].map((item) => item.id);
};

const choose = async (id: string): Promise<void> => {
  await act(async () =>
    document.querySelector<HTMLElement>(`[role="menu"] #${id}`)!.click()
  );
  await settle();
};

const toggle = (): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>('#appMenuButton')!;

describe('AppMenu', () => {
  it('opens along the rail: the deck, where to play, the keys, Settings and More', async () => {
    const menu = model();
    await render(menu);
    expect(toolbarIds()).toEqual([
      'appMenuButton',
      'deckImportButton',
      'p2Button',
      'shortcutsButton',
      'settingsButton',
      'appMoreButton',
    ]);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe('appToolbarDrawer');
    // Icons only; their names are the buttons' labels.
    expect(
      document.querySelector('#deckImportButton')?.getAttribute('aria-label')
    ).toBe('Deck');
    await press('#settingsButton');
    expect(menu.onSettings).toHaveBeenCalledOnce();

    // The rest is behind More, and nothing is offered twice.
    const rest = await openMenu('#appMoreButton');
    expect(rest).toEqual([
      'fullscreenButton',
      'tutorialButton',
      'changelogButton',
      'donationsButton',
      'discordButton',
    ]);
    expect(
      document.querySelector('[role="menu"] #changelogButton')?.textContent
    ).toBe(RELEASE_NAME);
    await choose('changelogButton');
    expect(document.querySelector('#changelog')).not.toBeNull();
  });

  it('has no keys to offer on a touch screen', async () => {
    touchOnly = true;
    await render(model());
    expect(toolbarIds()).not.toContain('shortcutsButton');
    expect(await openMenu('#appMoreButton')).not.toContain('shortcutsButton');
  });

  it('closes into its first button and opens again from it, as the player leaves it', async () => {
    await render(model());
    const drawer = document.querySelector<HTMLElement>('#appToolbarDrawer')!;
    await press('#appMenuButton');
    expect(preferences().get(SHELL_PREFERENCES).toolbarCollapsed).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    // Closed, its buttons are out of reach: not focusable, not clickable.
    expect(drawer.inert).toBe(true);
    await press('#appMenuButton');
    expect(preferences().get(SHELL_PREFERENCES).toolbarCollapsed).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(drawer.inert).toBe(false);
  });

  it('starts as the player left it', async () => {
    preferences().patch(SHELL_PREFERENCES, { toolbarCollapsed: true });
    await render(model());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(
      document.querySelector<HTMLElement>('#appToolbarDrawer')?.style.width
    ).toBe('0px');
  });

  it('is one menu holding everything on a rail too narrow to open along', async () => {
    await render(model(), 600);
    // One rail button of its own, no toolbar to open.
    expect(document.querySelector('.ptcgsim-app-toolbar')).toBeNull();
    expect(document.querySelector('#appMenuButton')).not.toBeNull();
    const all = await openMenu('#appMenuButton');
    expect(all.slice(0, 4)).toEqual([
      'deckImportButton',
      'p2Button',
      'shortcutsButton',
      'settingsButton',
    ]);
    expect(all).toContain('changelogButton');
    expect(all).not.toContain('appMoreButton');
  });

  it('opens the community pages outside the table', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await render(model());
    await openMenu('#appMoreButton');
    await choose('discordButton');
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('discord.gg'),
      '_blank',
      'noopener,noreferrer'
    );
  });
});
