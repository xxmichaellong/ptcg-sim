// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { LegacyWelcome } from './LegacyWelcome.js';

const mount = async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<LegacyWelcome buildId="v2" />));
  return { host, root };
};

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
  });
});
