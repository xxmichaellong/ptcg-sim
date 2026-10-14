// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ActivityFeedItem,
  ActivityFeedSnapshot,
} from '../../presentation/ActivityFeedModel.js';
import type { LegacyActivityPerspective } from '../../presentation/LegacyPresentationSurface.js';
import type { LiveRoomControls } from '../RemoteRoomLiveControls.js';
import {
  ActivityLauncher,
  ActivityPanel,
  type ActivityPanelProps,
} from './ActivitySheet.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OWN = 'player-own';
const OTHER = 'player-other';

const perspective = {
  viewer: { kind: 'player', playerId: OWN },
  playerOrder: [OWN, OTHER],
} as unknown as LegacyActivityPerspective;

/** A feed the test appends to, as the presentation runtime would. */
const feedSource = (initial: readonly ActivityFeedItem[] = []) => {
  let snapshot: ActivityFeedSnapshot = {
    items: initial,
    newestItemId: initial.at(-1)?.id ?? null,
  };
  const listeners = new Set<() => void>();
  return {
    activityFeed: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => snapshot,
    },
    liveRegion: {
      subscribe: () => () => undefined,
      getSnapshot: () => ({ announcement: null }),
    },
    push: (...items: ActivityFeedItem[]) => {
      const next = [...snapshot.items, ...items];
      snapshot = { items: next, newestItemId: next.at(-1)!.id };
      for (const listener of listeners) listener();
    },
  };
};

let nextId = 1;
const item = (
  eventType: string,
  category: ActivityFeedItem['category'],
  message: string,
  playerId?: string
): ActivityFeedItem =>
  ({
    id: nextId++,
    revision: 1,
    eventType,
    category,
    message,
    ...(playerId ? { playerId } : {}),
  }) as ActivityFeedItem;

const chat = (playerId: string, message: string) =>
  item('ChatMessage', 'message', message, playerId);
const presence = (message: string) => item('Presence', 'announcement', message);
const move = (playerId: string, message: string) =>
  item('CardMoved', 'player', message, playerId);

/** Lets Base UI's menus and drawers open, close and move focus. */
const settle = async (rounds = 3): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

/** A media query answered by width and height, like a real window. */
const mockWindow = (width: number, height: number): void => {
  vi.stubGlobal('matchMedia', (query: string) => {
    const matches = query.split(',').some((part) =>
      [...part.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/gu)].every(
        ([, bound, axis, value]) => {
          const size = axis === 'width' ? width : height;
          return bound === 'min'
            ? size >= Number(value)
            : size <= Number(value);
        }
      )
    );
    return {
      matches: matches && !query.includes('pointer'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mockWindow(1440, 900);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const badge = (): string | null =>
  host.querySelector('.ptcgsim-rail-button__badge')?.textContent ?? null;

const tickerLines = (): string[] =>
  [...host.querySelectorAll('.ptcgsim-activity-ticker__line')].map(
    (line) => line.textContent ?? ''
  );

describe('ActivityLauncher', () => {
  const renderLauncher = async (
    source: ReturnType<typeof feedSource>,
    options: { open?: boolean; solo?: boolean; onToggle?: () => void } = {}
  ) =>
    act(async () =>
      root.render(
        <ActivityLauncher
          presentation={source}
          perspective={perspective}
          open={options.open ?? false}
          onToggle={options.onToggle ?? (() => undefined)}
          ownSeat={OWN}
          solo={options.solo ?? false}
        />
      )
    );

  it('counts what others said and who came since the log was last open', async () => {
    const source = feedSource([chat(OTHER, 'already read')]);
    const onToggle = vi.fn();
    await renderLauncher(source, { onToggle });
    // Whatever was in the log when the table appeared counts as read.
    expect(badge()).toBeNull();

    await act(async () =>
      source.push(
        chat(OTHER, 'gl hf'),
        chat(OWN, 'you too'),
        move(OTHER, 'Red drew a card'),
        presence('Red joined')
      )
    );
    expect(badge()).toBe('2');
    const button = host.querySelector<HTMLButtonElement>('#activityButton')!;
    expect(button.getAttribute('aria-label')).toBe('Activity, 2 new');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await act(async () => button.click());
    expect(onToggle).toHaveBeenCalledOnce();

    await renderLauncher(source, { open: true });
    expect(badge()).toBeNull();
    expect(button.getAttribute('aria-controls')).toBe('activitySheet');
    await renderLauncher(source, { open: false });
    expect(badge()).toBeNull();
    await act(async () => source.push(chat(OTHER, 'your turn')));
    expect(badge()).toBe('1');
  });

  it('counts only arrivals at a Solo table, where every word is the player own', async () => {
    const source = feedSource();
    await renderLauncher(source, { solo: true });
    await act(async () =>
      source.push(chat(OTHER, 'a note'), chat(OWN, 'another'))
    );
    expect(badge()).toBeNull();
    await act(async () => source.push(presence('Spectator joined')));
    expect(badge()).toBe('1');
  });

  it("flashes the other side's lines over the table while the log is closed", async () => {
    vi.useFakeTimers();
    const source = feedSource();
    await renderLauncher(source);
    await act(async () =>
      source.push(
        move(OWN, 'Blue drew a card'),
        move(OTHER, 'Red played Boss'),
        chat(OTHER, 'gg'),
        presence('Red reconnected!')
      )
    );
    // The player's own moves are already in front of them.
    expect(tickerLines()).toEqual([
      'Red played Boss',
      'gg',
      'Red reconnected!',
    ]);
    const ticker = host.querySelector('.ptcgsim-activity-ticker')!;
    expect(ticker.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.opp-text')?.textContent).toBe(
      'Red played Boss'
    );
    // Never more than three at once.
    await act(async () => source.push(move(OTHER, 'Red attached Energy')));
    expect(tickerLines()).toEqual([
      'gg',
      'Red reconnected!',
      'Red attached Energy',
    ]);

    await act(async () => {
      vi.advanceTimersByTime(5_100);
    });
    expect(tickerLines()).toEqual([]);

    await act(async () => source.push(move(OTHER, 'Red retreated')));
    expect(tickerLines()).toEqual(['Red retreated']);
    // Opening the log clears it, and nothing flashes while it is open.
    await renderLauncher(source, { open: true });
    expect(tickerLines()).toEqual([]);
    await act(async () => source.push(move(OTHER, 'Red passed')));
    expect(tickerLines()).toEqual([]);
  });

  it('flashes only announcements at a Solo table', async () => {
    const source = feedSource();
    await renderLauncher(source, { solo: true });
    await act(async () =>
      source.push(
        move(OTHER, 'Red drew a card'),
        item('DeckLoaded', 'announcement', 'Blue loaded deck')
      )
    );
    expect(tickerLines()).toEqual(['Blue loaded deck']);
  });
});

describe('ActivityPanel', () => {
  const controls = {
    solo: true,
    ready: true,
    message: '',
    setMessage: vi.fn(),
    handleMessageKeyDown: vi.fn(),
    sendFlower: vi.fn(),
    sendMessage: vi.fn(),
  } as unknown as LiveRoomControls;

  const renderPanel = async (props: Partial<ActivityPanelProps>) => {
    const source = feedSource([move(OWN, 'Blue drew a card')]);
    const full: ActivityPanelProps = {
      open: true,
      onOpenChange: vi.fn(),
      docked: true,
      presentation: source,
      perspective,
      feedId: 'chatbox',
      status: 'Solo table',
      ...props,
    };
    await act(async () => root.render(<ActivityPanel {...full} />));
    await settle();
    return full;
  };

  it('docks beside the table on a wide screen, with the feed and chat', async () => {
    const onOpenChange = vi.fn();
    await renderPanel({ onOpenChange, controls });
    const dock = document.querySelector<HTMLElement>('aside#activitySheet')!;
    expect(dock.classList.contains('ptcgsim-activity-dock')).toBe(true);
    expect(dock.textContent).toContain('Activity');
    expect(dock.textContent).toContain('Solo table');
    // Keys typed in the log are never the table's.
    expect(dock.hasAttribute('data-ptcgsim-overlay')).toBe(true);
    expect(dock.querySelector('#chatbox')?.textContent).toContain(
      'Blue drew a card'
    );
    expect(dock.querySelector('#messageInput')).not.toBeNull();
    // The page-wide announcer speaks; a log that can close does not.
    expect(dock.querySelector('[role="status"]')).toBeNull();

    await act(async () =>
      dock
        .querySelector<HTMLButtonElement>('[aria-label="Close activity"]')!
        .click()
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await renderPanel({ open: false });
    expect(document.querySelector('#activitySheet')).toBeNull();
  });

  it('opens over the table as a sheet where there is no room beside it', async () => {
    mockWindow(900, 700);
    await renderPanel({
      docked: false,
      controls: undefined,
      feedId: 'p2Chatbox',
    });
    const sheet = document.querySelector<HTMLElement>('#activitySheet')!;
    expect(sheet.tagName).not.toBe('ASIDE');
    expect(sheet.classList.contains('ptcgsim-activity-sheet')).toBe(true);
    expect(sheet.dataset.variant).toBe('side');
    expect(sheet.querySelector('#p2Chatbox')).not.toBeNull();
    // Replay has no chat field.
    expect(sheet.querySelector('#p2MessageInput')).toBeNull();

    mockWindow(390, 844);
    await renderPanel({ docked: false });
    expect(
      document.querySelector<HTMLElement>('#activitySheet')!.dataset.variant
    ).toBe('bottom');
  });

  it("keeps the log's own actions beside its title", async () => {
    const onExportLog = vi.fn();
    const onClearLog = vi.fn();
    await renderPanel({ onExportLog, onClearLog });
    const open = async () => {
      await act(async () =>
        document
          .querySelector<HTMLButtonElement>('#activityLogMenuButton')!
          .click()
      );
      await settle();
    };
    await open();
    await act(async () =>
      document.querySelector<HTMLElement>('#exportLog')!.click()
    );
    await settle();
    expect(onExportLog).toHaveBeenCalledOnce();
    await open();
    await act(async () =>
      document.querySelector<HTMLElement>('#clearLog')!.click()
    );
    expect(onClearLog).toHaveBeenCalledOnce();

    // A replay can be saved but not cleared; with neither, no button.
    await renderPanel({ onExportLog });
    await open();
    expect(document.querySelector('#clearLog')).toBeNull();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('#activityLogMenuButton')!
        .click()
    );
    await settle();
    await renderPanel({});
    expect(document.querySelector('#activityLogMenuButton')).toBeNull();
  });
});
