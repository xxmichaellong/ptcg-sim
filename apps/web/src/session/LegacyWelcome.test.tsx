// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { LegacyWelcome } from './LegacyWelcome.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mount = async (onLoadDeck?: () => void) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <LegacyWelcome buildId="v2" {...(onLoadDeck ? { onLoadDeck } : {})} />
    )
  );
  return { host, root };
};

const pressEscape = async () =>
  act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
  });

describe('LegacyWelcome', () => {
  it('toggles the shipped changelog from the version link, like v1', async () => {
    const { host, root } = await mount();
    const link = host.querySelector<HTMLElement>('#changelogLink')!;
    expect(link.textContent).toContain('v2');
    expect(host.querySelector('#changelog')).toBeNull();

    await act(async () => link.click());
    const changelog = host.querySelector<HTMLElement>('#changelog')!;
    expect(changelog).not.toBeNull();
    // v1's release notes, newest first.
    expect(changelog.querySelector('h2')?.textContent).toBe(
      'v1.6 Update 03/25/26'
    );
    expect(changelog.querySelectorAll('h2').length).toBeGreaterThan(10);

    // Opening Sponsors & Donations closes the changelog, and vice versa.
    await act(async () =>
      host.querySelector<HTMLElement>('#donationsLink')!.click()
    );
    expect(host.querySelector('#changelog')).toBeNull();
    expect(host.querySelector('#donationsPage')).not.toBeNull();
    await act(async () => link.click());
    expect(host.querySelector('#donationsPage')).toBeNull();
    expect(host.querySelector('#changelog')).not.toBeNull();

    // Clicking the page closes it.
    await act(async () =>
      host.querySelector<HTMLElement>('#changelog')!.click()
    );
    expect(host.querySelector('#changelog')).toBeNull();

    await act(async () => root.unmount());
    host.remove();
  });

  it('names every control in plain text and shows Load a deck only when it can open the Deck tab', async () => {
    const withoutDeck = await mount();
    const version = withoutDeck.host.querySelector('#changelogLink')!;
    expect(version.tagName).toBe('BUTTON');
    // The version link used to carry hieroglyphs that render as boxes.
    expect(version.textContent).toBe("v2What's new");
    expect(withoutDeck.host.querySelector('#donationsLink')?.tagName).toBe(
      'BUTTON'
    );
    expect(withoutDeck.host.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(
      [...withoutDeck.host.querySelectorAll('button')].map(
        (button) => button.textContent
      )
    ).not.toContain('Load a deck');
    for (const icon of withoutDeck.host.querySelectorAll('svg')) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
    await act(async () => withoutDeck.root.unmount());
    withoutDeck.host.remove();

    const onLoadDeck = vi.fn();
    const { host, root } = await mount(onLoadDeck);
    const load = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Load a deck'
    )!;
    await act(async () => load.click());
    expect(onLoadDeck).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    host.remove();
  });

  it('opens each page as a labelled dialog, focuses its close button, and returns focus on Escape', async () => {
    const { host, root } = await mount();
    // The tutorial page embeds YouTube, so it is not opened here.
    expect(
      host.querySelector('#tutorialButton')?.getAttribute('aria-haspopup')
    ).toBe('dialog');
    const version = host.querySelector<HTMLButtonElement>('#changelogLink')!;
    version.focus();
    await act(async () => version.click());

    const changelog = host.querySelector<HTMLElement>('#changelog')!;
    expect(changelog.getAttribute('role')).toBe('dialog');
    expect(changelog.getAttribute('aria-modal')).toBe('true');
    expect(changelog.getAttribute('aria-labelledby')).toBe('changelogTitle');
    expect(host.querySelector('#changelogTitle')?.textContent).toBe(
      'Release notes'
    );
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');

    await pressEscape();
    expect(host.querySelector('#changelog')).toBeNull();
    expect(document.activeElement).toBe(version);

    const donations = host.querySelector<HTMLButtonElement>('#donationsLink')!;
    donations.focus();
    await act(async () => donations.click());
    const page = host.querySelector<HTMLElement>('#donationsPage')!;
    expect(page.getAttribute('aria-labelledby')).toBe('donationsTitle');
    expect(host.querySelector('#donationsTitle')?.textContent).toBe(
      'Sponsors & Donations'
    );
    await act(async () =>
      page.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click()
    );
    expect(host.querySelector('#donationsPage')).toBeNull();
    expect(document.activeElement).toBe(donations);

    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps Tab inside an open page, as a modal dialog must', async () => {
    const { host, root } = await mount();
    const donations = host.querySelector<HTMLButtonElement>('#donationsLink')!;
    donations.focus();
    await act(async () => donations.click());
    const page = host.querySelector<HTMLElement>('#donationsPage')!;
    const tabbable = [
      ...page.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)'),
    ];
    expect(tabbable.length).toBeGreaterThan(1);
    const tab = async (shiftKey: boolean) =>
      act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey,
            bubbles: true,
            cancelable: true,
          })
        );
      });
    // Close is focused first; Shift+Tab wraps to the last control.
    expect(document.activeElement).toBe(tabbable[0]);
    await tab(true);
    expect(document.activeElement).toBe(tabbable.at(-1));
    await tab(false);
    expect(document.activeElement).toBe(tabbable[0]);
    await act(async () => root.unmount());
    host.remove();
  });

  it('closes an open page on Escape, but not on an Escape that closes a dialog', async () => {
    const { host, root } = await mount();
    await act(async () =>
      host.querySelector<HTMLElement>('#changelogLink')!.click()
    );
    const escape = () =>
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });

    const dialog = document.createElement('div');
    dialog.setAttribute('data-ptcgsim-overlay', 'alert');
    const cancel = document.createElement('button');
    dialog.append(cancel);
    document.body.append(dialog);
    await act(async () => cancel.dispatchEvent(escape()));
    expect(host.querySelector('#changelog')).not.toBeNull();
    dialog.remove();

    await act(async () => document.body.dispatchEvent(escape()));
    expect(host.querySelector('#changelog')).toBeNull();
    await act(async () => root.unmount());
  });
});
