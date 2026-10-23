// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preferences } from '../../preferences/preference-store.js';
import {
  APP_BAR_GAP_PX,
  APP_BAR_PAD_PX,
  APP_BAR_SLOTS,
  AppBar,
  appBarSize,
  type AppMenuModel,
} from './AppMenu.js';
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
let compact = false;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  touchOnly = false;
  compact = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width')
      ? compact
      : query.includes('pointer: coarse')
        ? touchOnly
        : false,
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
  onTutorial: vi.fn(),
  ...overrides,
});

/** The bar as a room draws it, with a stand-in for the log's button. */
const render = async (menu: AppMenuModel): Promise<void> => {
  await act(async () =>
    root.render(
      <>
        <AppBar
          model={menu}
          log={<button id="activityButton" type="button" />}
        />
        <HelpSheetHost />
      </>
    )
  );
  await settle(1);
};

const barIds = (): string[] =>
  [...document.querySelectorAll('.ptcgsim-app-bar button[id]')].map(
    (button) => button.id
  );

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

describe('AppBar', () => {
  it('shows the deck, where to play, Commands, the log, Settings and the menu, in groups', async () => {
    const menu = model();
    await render(menu);
    expect(barIds()).toEqual([
      'deckImportButton',
      'p2Button',
      'commandsButton',
      'activityButton',
      'settingsButton',
      'appMenuButton',
    ]);
    expect(
      [...document.querySelectorAll('.ptcgsim-app-bar__group')].map(
        (group) => group.querySelectorAll('button[id]').length
      )
    ).toEqual([2, 3, 1]);
    // Icons only; their names are the buttons' labels.
    expect(
      document.querySelector('#deckImportButton')?.getAttribute('aria-label')
    ).toBe('Deck');
    await press('#settingsButton');
    expect(menu.onSettings).toHaveBeenCalledOnce();

    // The rest is in the menu, the keys first, and nothing is offered twice.
    const rest = await openMenu('#appMenuButton');
    expect(rest).toEqual([
      'shortcutsButton',
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

  it('moves between its buttons on the arrow keys, which the table never sees', async () => {
    await render(model());
    const deck =
      document.querySelector<HTMLButtonElement>('#deckImportButton')!;
    deck.focus();
    const arrow = async (key: string) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        document.activeElement!.dispatchEvent(event);
      });
      return event;
    };
    expect((await arrow('ArrowRight')).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('p2Button');
    await arrow('ArrowLeft');
    await arrow('ArrowLeft');
    // Round from the first to the last.
    expect(document.activeElement?.id).toBe('appMenuButton');
  });

  it('turns the way out round in a right-to-left language, and nothing else', async () => {
    await render(model({ onLeave: vi.fn(), onCopyInvitation: vi.fn() }));
    await openMenu('#appMenuButton');
    // Leaving points the way the line reads (ds-mirror-rtl: it turns round
    // only under dir="rtl"); a copy, a screen or a heart has no direction.
    const mirrored = [
      ...document.querySelectorAll('[role="menu"] [role="menuitem"][id]'),
    ]
      .filter((item) => item.querySelector('svg.ds-mirror-rtl'))
      .map((item) => item.id);
    expect(mirrored).toEqual(['leaveRoomButton']);
  });

  it('has no keys to offer on a touch screen', async () => {
    touchOnly = true;
    await render(model());
    expect(barIds()).not.toContain('shortcutsButton');
    expect(await openMenu('#appMenuButton')).not.toContain('shortcutsButton');
  });

  it('keeps the palette, the log and the menu on a phone; the menu leads with the rest', async () => {
    compact = true;
    await render(model());
    expect(barIds()).toEqual([
      'commandsButton',
      'activityButton',
      'appMenuButton',
    ]);
    const all = await openMenu('#appMenuButton');
    expect(all.slice(0, 4)).toEqual([
      'deckImportButton',
      'p2Button',
      'shortcutsButton',
      'settingsButton',
    ]);
    expect(all).toContain('changelogButton');
  });

  it('is as wide as the corner the table keeps for it', () => {
    // Six 36px buttons 4px apart in 3px of padding and border a side.
    expect(appBarSize(APP_BAR_SLOTS.full, false)).toEqual({
      width: 6 * 36 + 5 * APP_BAR_GAP_PX + 2 * APP_BAR_PAD_PX,
      height: 36 + 2 * APP_BAR_PAD_PX,
    });
    expect(appBarSize(APP_BAR_SLOTS.compact, true)).toEqual({
      width: 3 * 44 + 2 * APP_BAR_GAP_PX + 2 * APP_BAR_PAD_PX,
      height: 44 + 2 * APP_BAR_PAD_PX,
    });
  });

  it('opens the tutorial, or leaves it on the practice table, and has none where it is not offered', async () => {
    const onTutorial = vi.fn();
    await render(model({ onTutorial }));
    await openMenu('#appMenuButton');
    expect(
      document.querySelector('[role="menu"] #tutorialButton')?.textContent
    ).toBe('Tutorial');
    await choose('tutorialButton');
    expect(onTutorial).toHaveBeenCalledOnce();

    const onExitTutorial = vi.fn();
    await render(model({ onExitTutorial }));
    await openMenu('#appMenuButton');
    expect(
      document.querySelector('[role="menu"] #tutorialButton')?.textContent
    ).toBe('Leave tutorial');
    await choose('tutorialButton');
    expect(onExitTutorial).toHaveBeenCalledOnce();

    // A room's menu: no tutorial, the other player would be left waiting.
    await render({ onSettings: vi.fn() });
    expect(await openMenu('#appMenuButton')).not.toContain('tutorialButton');
  });

  it('opens the community pages outside the table', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await render(model());
    await openMenu('#appMenuButton');
    await choose('discordButton');
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('discord.gg'),
      '_blank',
      'noopener,noreferrer'
    );
  });
});
