// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preferences } from '../../preferences/preference-store.js';
import {
  APP_BAR_GAP_PX,
  APP_BAR_MODE_PX,
  APP_BAR_PAD_PX,
  APP_BAR_SLOTS,
  AppBar,
  appBarSize,
  helpEntries,
  menuActions,
  restEntries,
  useAppBarPlacement,
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
  mode: { kind: 'solo' },
  onPlayOnline: vi.fn(),
  onDeck: vi.fn(),
  onSettings: vi.fn(),
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

/** The ids of what the room lets the player do, as Settings groups them. */
const actionIds = (menu: AppMenuModel) => {
  const { room, saves, tutorial, leave } = menuActions(menu);
  return {
    room: room.map((action) => action.id),
    saves: saves.map((action) => action.id),
    tutorial: tutorial.map((action) => action.id),
    leave: leave.map((action) => action.id),
  };
};

/** What the bar leaves to Settings, as a component sees it. */
const inSettingsIds = async (menu: AppMenuModel): Promise<string[]> => {
  let ids: string[] = [];
  const Probe = () => {
    ids = useAppBarPlacement(menu).inSettings.map((entry) => entry.id);
    return null;
  };
  await act(async () => root.render(<Probe />));
  return ids;
};

describe('AppBar', () => {
  it('shows where the table is played as a switch, the deck, Commands, the log and Settings, in groups', async () => {
    const menu = model();
    await render(menu);
    expect(barIds()).toEqual([
      'p1Button',
      'p2Button',
      'deckImportButton',
      'commandsButton',
      'activityButton',
      'settingsButton',
    ]);
    expect(
      [...document.querySelectorAll('.ptcgsim-app-bar__group')].map(
        (group) => group.querySelectorAll('button[id]').length
      )
    ).toEqual([2, 1, 2, 1]);
    // Solo is pressed; Online is the way to Play online.
    expect(
      document.querySelector('#p1Button')?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      document.querySelector('#p2Button')?.getAttribute('aria-pressed')
    ).toBe('false');
    await press('#p1Button');
    expect(menu.onPlayOnline).not.toHaveBeenCalled();
    await press('#p2Button');
    expect(menu.onPlayOnline).toHaveBeenCalledOnce();
    // Icons only; their names are the buttons' labels.
    expect(
      document.querySelector('#deckImportButton')?.getAttribute('aria-label')
    ).toBe('Deck');

    // No menu: the last button is Settings itself, which holds the rest,
    // with no key of its own.
    expect(document.querySelector('#appMenuButton')).toBeNull();
    expect(document.querySelector('[aria-haspopup="menu"]')).toBeNull();
    const settings = document.querySelector('#settingsButton')!;
    expect(settings.getAttribute('aria-label')).toBe('Settings');
    expect(settings.getAttribute('aria-expanded')).toBe('false');
    expect(settings.querySelector('kbd')).toBeNull();
    await press('#settingsButton');
    expect(menu.onSettings).toHaveBeenCalledOnce();
    // Open, it shows pressed, and names what it opened.
    await render(model({ settingsOpen: true }));
    expect(
      document.querySelector('#settingsButton')?.getAttribute('aria-expanded')
    ).toBe('true');
    expect(
      document.querySelector('#settingsButton')?.getAttribute('aria-controls')
    ).toBe('settings');
  });

  it("groups the saves and replays, the tutorial, a room's invites, and the ways out", () => {
    const game = {
      onImportReplay: vi.fn(),
      onResumeSaved: vi.fn(),
      onExportState: vi.fn(),
    };
    expect(actionIds(model({ game }))).toEqual({
      room: [],
      saves: ['importReplay', 'resumeSavedGame', 'exportState'],
      tutorial: ['tutorialButton'],
      leave: [],
    });
    expect(
      menuActions(model({ game })).saves.find(
        (action) => action.id === 'importReplay'
      )?.label
    ).toBe('Watch replay…');

    const room: AppMenuModel = {
      heading: 'Room K7PQ',
      onDeck: vi.fn(),
      onSettings: vi.fn(),
      invites: { code: 'K7PQ', onInvite: vi.fn(), onCopyCode: vi.fn() },
      onRoom: vi.fn(),
      game: { onSaveOnline: vi.fn(), onExportState: vi.fn() },
      onLeave: vi.fn(),
    };
    expect(actionIds(room)).toEqual({
      room: ['roomMenuItem', 'inviteMenuItem'],
      saves: ['saveOnlineGame', 'exportState'],
      tutorial: [],
      leave: ['leaveRoomButton'],
    });
    // The palette offers the same, Settings itself first.
    expect(
      restEntries(room).map((entry) => ('id' in entry ? entry.id : undefined))
    ).toEqual([
      'settingsButton',
      'roomMenuItem',
      'inviteMenuItem',
      'saveOnlineGame',
      'exportState',
      'leaveRoomButton',
    ]);

    // A replay's way out is at the foot, with the others.
    const replay = actionIds(
      model({ game: { onExitReplay: vi.fn(), onExportState: vi.fn() } })
    );
    expect(replay.leave).toEqual(['exitReplayMenuItem']);
    expect(replay.saves).toEqual(['exportState']);
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
    expect(document.activeElement?.id).toBe('commandsButton');
    await arrow('ArrowLeft');
    await arrow('ArrowLeft');
    // The mode's switch is on the way too.
    expect(document.activeElement?.id).toBe('p2Button');
    await arrow('ArrowLeft');
    await arrow('ArrowLeft');
    // Round from the first to the last.
    expect(document.activeElement?.id).toBe('settingsButton');
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

  it('turns only the way out round in a right-to-left language', () => {
    const { room, saves, leave } = menuActions(
      model({
        onLeave: vi.fn(),
        invites: {
          roles: ['player', 'spectator'],
          seatTaken: false,
          onInvite: vi.fn(),
        },
        game: { onExportState: vi.fn() },
      })
    );
    // Leaving points the way the line reads; an invite or a save has no
    // direction.
    expect(
      [...room, ...saves, ...leave]
        .filter((action) => action.mirrored)
        .map((action) => action.id)
    ).toEqual(['leaveRoomButton']);
    expect(leave[0]?.danger).toBe(true);
  });

  it('offers the room (its code beside it) and one invite link for everyone (ADR-047)', () => {
    const onInvite = vi.fn();
    const onCopyCode = vi.fn();
    const onRoom = vi.fn();
    const room = menuActions(
      model({ invites: { code: 'K7PQ', onInvite, onCopyCode }, onRoom })
    ).room;
    expect(room.map((action) => action.id)).toEqual([
      'roomMenuItem',
      'inviteMenuItem',
    ]);
    expect(room[0]!.detail).toBe('K7PQ');
    room[0]!.onSelect();
    expect(onRoom).toHaveBeenCalledOnce();
    room[1]!.onSelect();
    expect(onInvite).toHaveBeenCalledOnce();
    // Without the room's sheet, its row copies the code.
    const bare = menuActions(
      model({ invites: { code: 'K7PQ', onInvite, onCopyCode } })
    ).room[0]!;
    expect(bare.id).toBe('roomCodeMenuItem');
    bare.onSelect();
    expect(onCopyCode).toHaveBeenCalledOnce();
  });

  it('offers the room before its code has come, to show it is loading and ask again (ADR-047)', () => {
    const onRoom = vi.fn();
    const room = menuActions(model({ onRoom })).room;
    expect(room.map((action) => action.id)).toEqual(['roomMenuItem']);
    expect(room[0]!.detail).toBeUndefined();
    room[0]!.onSelect();
    expect(onRoom).toHaveBeenCalledOnce();
  });

  it('keeps the palette, the log and Settings on a phone; Settings leads with the rest', async () => {
    compact = true;
    touchOnly = true;
    await render(model());
    expect(barIds()).toEqual([
      'commandsButton',
      'activityButton',
      'settingsButton',
    ]);
    expect(await inSettingsIds(model())).toEqual([
      'deckImportButton',
      'p2Button',
    ]);
    compact = false;
    // With room for them, none.
    expect(await inSettingsIds(model())).toEqual([]);
  });

  it('is as wide as the corner the table keeps for it', () => {
    // The mode's switch and four 36px buttons 4px apart in 3px of padding
    // and border a side.
    expect(appBarSize(APP_BAR_SLOTS.full, false)).toEqual({
      width: APP_BAR_MODE_PX + 4 * 36 + 4 * APP_BAR_GAP_PX + 2 * APP_BAR_PAD_PX,
      height: 36 + 2 * APP_BAR_PAD_PX,
    });
    expect(appBarSize(APP_BAR_SLOTS.compact, true)).toEqual({
      width: APP_BAR_MODE_PX + 3 * 44 + 3 * APP_BAR_GAP_PX + 2 * APP_BAR_PAD_PX,
      height: 44 + 2 * APP_BAR_PAD_PX,
    });
  });

  it('switches between Solo and Online where the table is played, online with its room and whether it is connected', async () => {
    const option = (id: string) =>
      document.querySelector<HTMLElement>(`.ptcgsim-app-bar__switch #${id}`);
    const label = () =>
      document.querySelector<HTMLElement>('.ptcgsim-app-bar__mode');
    await render(model());
    // First in the bar.
    expect(
      document.querySelector('.ptcgsim-app-bar__group')?.firstElementChild
    ).toBe(document.querySelector('.ptcgsim-app-bar__switch'));
    expect(option('p1Button')?.textContent).toBe('Solo');
    expect(option('p2Button')?.textContent).toBe('Online');
    // The side in play first.
    const first = () =>
      document.querySelector('.ptcgsim-app-bar__switch-option')?.id;
    expect(first()).toBe('p1Button');

    // In a room: Online pressed and lit, amber until connected; Solo is the
    // way out of it (which asks first).
    const onLeave = vi.fn();
    await render(
      model({
        onPlayOnline: undefined,
        onLeave,
        mode: { kind: 'online', detail: 'Room K7PQ2M', connecting: true },
      })
    );
    expect(option('p2Button')?.getAttribute('aria-pressed')).toBe('true');
    expect(first()).toBe('p2Button');
    expect(option('p2Button')?.dataset.connecting).toBe('true');
    expect(
      option('p2Button')?.querySelector('.ptcgsim-app-bar__mode-light')
    ).not.toBe(null);
    await press('#p1Button');
    expect(onLeave).toHaveBeenCalledOnce();
    await render(
      model({
        onPlayOnline: undefined,
        mode: { kind: 'online', detail: 'Room K7PQ2M' },
      })
    );
    expect(option('p2Button')?.hasAttribute('data-connecting')).toBe(false);
    // With no way out, Solo takes no press.
    expect(option('p1Button')?.getAttribute('aria-disabled')).toBe('true');

    await render(model({ mode: { kind: 'watching', detail: 'Room K7PQ2M' } }));
    expect(option('p2Button')?.textContent).toBe('Watching');
    // A replay keeps its name, not a switch.
    await render(model({ mode: { kind: 'replay' } }));
    expect(label()?.textContent).toBe('Replay');
    expect(document.querySelector('.ptcgsim-app-bar__switch')).toBe(null);

    // Play online's page: Online pressed, Solo the way back.
    const onPlaySolo = vi.fn();
    await render(
      model({ mode: undefined, onPlayOnline: undefined, onPlaySolo })
    );
    expect(option('p2Button')?.getAttribute('aria-pressed')).toBe('true');
    await press('#p1Button');
    expect(onPlaySolo).toHaveBeenCalledOnce();

    // No mode and no way to play (the lobby joining a room): nothing.
    await render(model({ mode: undefined, onPlayOnline: undefined }));
    expect(document.querySelector('.ptcgsim-app-bar__switch')).toBe(null);
    expect(label()).toBe(null);

    // A phone held upright has no room for the switch: online, a light in
    // the bar's corner, the name left to screen readers; at a Solo table
    // nothing to see (where to play leads the menu). The bar is no wider
    // than its buttons.
    compact = true;
    await render(model({ mode: { kind: 'online', detail: 'Room K7PQ2M' } }));
    expect(label()?.dataset.lightOnly).toBe('true');
    expect(label()?.querySelector('.ptcgsim-app-bar__mode-light')).not.toBe(
      null
    );
    expect(label()?.querySelector('.ds-visually-hidden')?.textContent).toBe(
      'Online'
    );
    await render(model({ mode: { kind: 'solo' } }));
    expect(label()?.querySelector('svg, .ptcgsim-app-bar__mode-light')).toBe(
      null
    );
    expect(appBarSize(APP_BAR_SLOTS.compact, true, false)).toEqual({
      width: 3 * 44 + 2 * APP_BAR_GAP_PX + 2 * APP_BAR_PAD_PX,
      height: 44 + 2 * APP_BAR_PAD_PX,
    });
  });

  it('opens the tutorial, or leaves it on the practice table, and has none where it is not offered', () => {
    const onTutorial = vi.fn();
    const tutorial = menuActions(model({ onTutorial })).tutorial.find(
      (action) => action.id === 'tutorialButton'
    )!;
    expect(tutorial.label).toBe('Tutorial');
    tutorial.onSelect();
    expect(onTutorial).toHaveBeenCalledOnce();

    const onExitTutorial = vi.fn();
    // On the practice table: its way out, at the foot; no second tutorial.
    expect(actionIds(model({ onExitTutorial }))).toEqual({
      room: [],
      saves: [],
      tutorial: [],
      leave: ['leaveTutorialButton'],
    });
    const leave = menuActions(model({ onExitTutorial })).leave[0]!;
    expect(leave.label).toBe('Leave tutorial');
    leave.onSelect();
    expect(onExitTutorial).toHaveBeenCalledOnce();

    // A room: no tutorial, the other player would be left waiting.
    expect(actionIds({ onSettings: vi.fn() }).tutorial).toEqual([]);
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
