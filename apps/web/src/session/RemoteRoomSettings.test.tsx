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
          hideOpponentHand={false}
          onDarkModeChange={vi.fn()}
          onZoneOutlinesChange={vi.fn()}
          onHideOpponentHandChange={vi.fn()}
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
