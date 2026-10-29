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
  helpEntries,
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
  it('shows the deck, where to play, Commands, the log and the menu, in groups', async () => {
    const menu = model();
    await render(menu);
    expect(barIds()).toEqual([
      'deckImportButton',
      'p2Button',
      'commandsButton',
      'activityButton',
      'appMenuButton',
    ]);
    expect(
      [...document.querySelectorAll('.ptcgsim-app-bar__group')].map(
        (group) => group.querySelectorAll('button[id]').length
      )
    ).toEqual([2, 2, 1]);
    // Icons only; their names are the buttons' labels.
    expect(
      document.querySelector('#deckImportButton')?.getAttribute('aria-label')
    ).toBe('Deck');

    // The menu: Settings first, with its key, and nothing offered twice.
    // The keys and the help links are in Settings, not here.
    const rest = await openMenu('#appMenuButton');
    expect(rest).toEqual([
      'settingsButton',
      'fullscreenButton',
      'tutorialButton',
    ]);
    expect(
      document.querySelector('[role="menu"] #settingsButton kbd')?.textContent
    ).toBe(',');
    await choose('settingsButton');
    expect(menu.onSettings).toHaveBeenCalledOnce();
  });

  it("lists a Solo table's replays after Settings, a room's invites and saves before it, and a replay's way out first", async () => {
    const game = {
      onImportReplay: vi.fn(),
      onResumeSaved: vi.fn(),
      onExportState: vi.fn(),
    };
    await render(model({ game }));
    expect(await openMenu('#appMenuButton')).toEqual([
      'settingsButton',
      'fullscreenButton',
      'tutorialButton',
      'importReplay',
      'resumeSavedGame',
      'exportState',
    ]);
    expect(
      document.querySelector('[role="menu"] #importReplay')?.textContent
    ).toBe('Watch replay…');
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    await settle();

    await render({
      heading: 'Room K7PQ2M',
      onDeck: vi.fn(),
      onSettings: vi.fn(),
      onFullscreen: vi.fn(),
      invites: {
        roles: ['player', 'spectator'],
        seatTaken: false,
        onInvite: vi.fn(),
      },
      game: { onSaveOnline: vi.fn(), onExportState: vi.fn() },
      onLeave: vi.fn(),
    });
    expect(await openMenu('#appMenuButton')).toEqual([
      'inviteOpponentMenuItem',
      'inviteSpectatorMenuItem',
      'saveOnlineGame',
      'exportState',
      'settingsButton',
      'fullscreenButton',
      'leaveRoomButton',
    ]);
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    await settle();

    await render(
      model({ game: { onExitReplay: vi.fn(), onExportState: vi.fn() } })
    );
    expect((await openMenu('#appMenuButton'))[0]).toBe('exitReplayMenuItem');
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
    // Left focused by a click, a button hands the arrows on (to the table):
    // not keyboard focus as it arrives, whatever the browser says at the
    // keypress.
    const commands = document.querySelector<HTMLElement>('#commandsButton')!;
    const matches = commands.matches.bind(commands);
    commands.matches = (selector: string) =>
      selector === ':focus-visible' ? false : matches(selector);
    await act(async () => commands.focus());
    commands.matches = matches;
    expect((await arrow('ArrowRight')).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(commands);
  });

  it('turns the way out round in a right-to-left language, and nothing else', async () => {
    await render(
      model({
        onLeave: vi.fn(),
        invites: {
          roles: ['player', 'spectator'],
          seatTaken: false,
          onInvite: vi.fn(),
        },
      })
    );
    await openMenu('#appMenuButton');
    // Leaving points the way the line reads (ds-mirror-rtl: it turns round
    // only under dir="rtl"); an invite, a screen or a heart has no
    // direction.
    const mirrored = [
      ...document.querySelectorAll('[role="menu"] [role="menuitem"][id]'),
    ]
      .filter((item) => item.querySelector('svg.ds-mirror-rtl'))
      .map((item) => item.id);
    expect(mirrored).toEqual(['leaveRoomButton']);
  });

  it("offers both invites, and says why the opponent's is off once their seat is taken", async () => {
    const onInvite = vi.fn();
    await render(
      model({
        invites: { roles: ['player', 'spectator'], seatTaken: false, onInvite },
      })
    );
    expect(await openMenu('#appMenuButton')).toEqual(
      expect.arrayContaining([
        'inviteOpponentMenuItem',
        'inviteSpectatorMenuItem',
      ])
    );
    await act(async () => {
      document.querySelector<HTMLElement>('#inviteSpectatorMenuItem')!.click();
    });
    expect(onInvite).toHaveBeenCalledWith('spectator');
    await settle();

    await render(
      model({
        invites: { roles: ['player', 'spectator'], seatTaken: true, onInvite },
      })
    );
    await openMenu('#appMenuButton');
    const opponent = document.querySelector<HTMLElement>(
      '#inviteOpponentMenuItem'
    )!;
    expect(opponent.getAttribute('aria-disabled')).toBe('true');
    expect(opponent.textContent).toContain('Seat taken');
  });

  it('keeps the palette, the log and the menu on a phone; the menu leads with the rest', async () => {
    compact = true;
    touchOnly = true;
    await render(model());
    expect(barIds()).toEqual([
      'commandsButton',
      'activityButton',
      'appMenuButton',
    ]);
    expect(await openMenu('#appMenuButton')).toEqual([
      'deckImportButton',
      'p2Button',
      'settingsButton',
      'fullscreenButton',
      'tutorialButton',
    ]);
  });

  it('is as wide as the corner the table keeps for it', () => {
    // Five 36px buttons 4px apart in 3px of padding and border a side.
    expect(appBarSize(APP_BAR_SLOTS.full, false)).toEqual({
      width: 5 * 36 + 4 * APP_BAR_GAP_PX + 2 * APP_BAR_PAD_PX,
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
    // Last, after Settings; no second tutorial to open.
    expect(await openMenu('#appMenuButton')).toEqual([
      'settingsButton',
      'fullscreenButton',
      'leaveTutorialButton',
    ]);
    expect(
      document.querySelector('[role="menu"] #leaveTutorialButton')?.textContent
    ).toBe('Leave tutorial');
    await choose('leaveTutorialButton');
    expect(onExitTutorial).toHaveBeenCalledOnce();

    // A room's menu: no tutorial, the other player would be left waiting.
    await render({ onSettings: vi.fn() });
    expect(await openMenu('#appMenuButton')).not.toContain('tutorialButton');
  });

  it('keeps the keys and the help for the palette, the community outside the table', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const help = helpEntries('?');
    expect(help.map((entry) => entry.id)).toEqual([
      'shortcutsButton',
      'changelogButton',
      'donationsButton',
      'discordButton',
    ]);
    expect(help[0]!.hint).toBe('?');
    expect(help[1]!.label).toBe(RELEASE_NAME);
    help.find((entry) => entry.id === 'discordButton')!.onSelect();
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('discord.gg'),
      '_blank',
      'noopener,noreferrer'
    );
  });
});
