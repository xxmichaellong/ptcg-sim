// @vitest-environment happy-dom

import { DEFAULT_BOARD_PREFERENCES } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { motionSettings } from '../motion/motion-settings.js';
import { RemoteRoomSettings } from './RemoteRoomSettings.js';

const choose = (select: HTMLSelectElement, value: string) => {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

afterEach(() => {
  motionSettings().update({ reduceMotion: 'system', animationSpeed: 'normal' });
});

describe('RemoteRoomSettings motion controls', () => {
  it('lets the player choose reduced motion and the animation speed', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <RemoteRoomSettings
          hidden={false}
          preferences={DEFAULT_BOARD_PREFERENCES}
          onDarkModeChange={vi.fn()}
          onChangeBackground={vi.fn()}
        />
      )
    );
    const reduce = host.querySelector<HTMLSelectElement>(
      '#reduceMotionSelect'
    )!;
    const speed = host.querySelector<HTMLSelectElement>(
      '#animationSpeedSelect'
    )!;
    expect(reduce.value).toBe('system');
    expect(speed.value).toBe('normal');
    expect(
      host.querySelector('label[for="animationSpeedSelect"]')?.textContent
    ).toBe('Animation speed');

    await act(async () => choose(speed, 'fast'));
    expect(motionSettings().getSnapshot()).toMatchObject({
      animationSpeed: 'fast',
      durationScale: 0.6,
    });
    expect(speed.value).toBe('fast');

    await act(async () => choose(reduce, 'reduce'));
    expect(motionSettings().getSnapshot().reduced).toBe(true);
    expect(reduce.value).toBe('reduce');

    await act(async () => root.unmount());
  });
});

describe('RemoteRoomSettings board view link', () => {
  it('sends the table choices to the Board view panel when there is a table', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const settings = (onOpenBoardView?: () => void) => (
      <RemoteRoomSettings
        hidden={false}
        preferences={DEFAULT_BOARD_PREFERENCES}
        onDarkModeChange={vi.fn()}
        {...(onOpenBoardView ? { onOpenBoardView } : {})}
        onChangeBackground={vi.fn()}
      />
    );
    await act(async () => root.render(settings()));
    expect(host.querySelector('#openBoardViewButton')).toBeNull();
    // The old table switches live in the panel now.
    expect(host.querySelector('#showZonesCheckbox')).toBeNull();
    expect(host.querySelector('#hideHandCheckbox')).toBeNull();
    expect(host.querySelector('#tableViewSelect')).toBeNull();

    const open = vi.fn();
    await act(async () => root.render(settings(open)));
    const button = host.querySelector<HTMLButtonElement>(
      '#openBoardViewButton'
    )!;
    expect(button.textContent).toBe('Open board view');
    // A press on it is not an outside press that would close the panel.
    expect(button.hasAttribute('data-board-view-trigger')).toBe(true);
    await act(async () => button.click());
    expect(open).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
