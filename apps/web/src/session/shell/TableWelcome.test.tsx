// @vitest-environment happy-dom

import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeShortcutsDialog,
  useShortcutsDialogState,
} from '../../hotkeys/shortcuts-dialog-state.js';
import { closeHelpPage, HelpSheetHost, RELEASE_NAME } from './help-pages.js';
import { TableWelcome } from './TableWelcome.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockPointer = (coarse: boolean): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
};

/** Lets Base UI's sheets open and close. */
const settle = async (rounds = 3): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

let shortcutsOpen = false;
const ShortcutsProbe = () => {
  shortcutsOpen = useShortcutsDialogState().open;
  return null;
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mockPointer(false);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    closeHelpPage();
    closeShortcutsDialog();
  });
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const render = async (props: Parameters<typeof TableWelcome>[0]) => {
  await act(async () =>
    root.render(
      <>
        <TableWelcome {...props} />
        <HelpSheetHost />
        <ShortcutsProbe />
      </>
    )
  );
};

const button = (selector: string): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>(selector)!;

describe('TableWelcome', () => {
  it('offers the ways in, the tutorial among them, and puts itself away', async () => {
    const onLoadDeck = vi.fn();
    const onTutorial = vi.fn();
    const onPlayOnline = vi.fn();
    const onDismiss = vi.fn();
    await render({ onLoadDeck, onTutorial, onPlayOnline, onDismiss });
    const card = host.querySelector('[data-table-welcome="true"]')!;
    expect(card.getAttribute('aria-labelledby')).toBe('tableWelcomeTitle');
    expect(host.querySelector('#tableWelcomeTitle')?.textContent).toBe(
      'Welcome to PTCG-sim'
    );
    // The release notes go by the release they lead with.
    expect(host.querySelector('#changelogLink')?.textContent).toBe(
      RELEASE_NAME
    );
    expect(RELEASE_NAME).toMatch(/^v\d+(\.\d+)+$/u);

    await act(async () => button('#welcomeLoadDeckButton').click());
    expect(onLoadDeck).toHaveBeenCalledOnce();
    await act(async () => button('#welcomeTutorialButton').click());
    expect(onTutorial).toHaveBeenCalledOnce();
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => candidate.textContent === 'Play online')!
        .click()
    );
    expect(onPlayOnline).toHaveBeenCalledOnce();
    await act(async () => button('[aria-label="Hide welcome"]').click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('names Set up as the rail’s button names itself, in any language', async () => {
    const locale = i18n.locale;
    const setUp = msg({ message: 'Set up', context: 'set up the game' });
    i18n.load('xx', { [setUp.id!]: 'Vorbereiten' });
    i18n.activate('xx');
    try {
      await render({});
      expect(
        host.querySelector('.table-welcome__steps')?.textContent
      ).toContain('Vorbereiten');
    } finally {
      i18n.activate(locale);
    }
  });

  it('leaves out what its table cannot do', async () => {
    await render({});
    expect(host.querySelector('#welcomeLoadDeckButton')).toBeNull();
    expect(host.querySelector('#welcomeTutorialButton')).toBeNull();
    expect(host.textContent).not.toContain('Play online');
    expect(host.querySelector('[aria-label="Hide welcome"]')).toBeNull();
  });

  it('opens the help pages from its links', async () => {
    await render({});
    for (const [trigger, page] of [
      ['#changelogLink', '#changelog'],
      ['#donationsLink', '#donationsPage'],
    ] as const) {
      await act(async () => button(trigger).click());
      await settle();
      expect(document.querySelector(page), page).not.toBeNull();
      await act(async () => closeHelpPage());
      await settle();
    }
    expect(host.querySelector<HTMLAnchorElement>('#discordLink')!.target).toBe(
      '_blank'
    );
    const twitter = host.querySelector<HTMLAnchorElement>('#twitterLink')!;
    expect(twitter.href).toBe('https://x.com/xxmichaellong');
    expect(twitter.target).toBe('_blank');
    expect(twitter.textContent).toBe('@xxmichaellong');
  });

  it('explains play for a mouse, with the shortcuts a key away', async () => {
    await render({});
    expect(host.textContent).toContain('Right-click a card for actions.');
    // Dragging and double-clicking are what anyone tries first.
    expect(host.textContent).not.toContain('Double-click');
    expect(host.textContent).not.toContain('Drag to play');
    expect(
      [...host.querySelectorAll('.ds-kbd')].map((key) => key.textContent)
    ).toEqual(['?']);
    expect(shortcutsOpen).toBe(false);
    await act(async () => button('.welcome-shortcuts-link').click());
    expect(shortcutsOpen).toBe(true);
  });

  it('explains play for a finger, which has no right-click or keys', async () => {
    mockPointer(true);
    await render({});
    expect(host.textContent).toContain(
      'Tap a card for actions; tap again to read it.'
    );
    expect(host.querySelector('.welcome-shortcuts-link')).toBeNull();
    expect(host.textContent).not.toContain('Right-click');
  });
});
