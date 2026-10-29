// @vitest-environment happy-dom

import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BACKGROUND_SOURCE_BYTES,
  backgroundSize,
  encodeBackgroundImage,
  resetLocalBackgroundForTests,
  saveLocalBackground,
  useLocalBackgroundUrl,
} from './local-room-background.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetLocalBackgroundForTests();
});

describe('the player’s own background', () => {
  it('is drawn within a desktop screen, never enlarged', () => {
    expect(backgroundSize(4000, 3000)).toEqual({ width: 2133, height: 1600 });
    expect(backgroundSize(5120, 1440)).toEqual({ width: 2560, height: 720 });
    expect(backgroundSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('refuses a picture too large to read, and what is not a picture', async () => {
    const huge = new Blob([new Uint8Array(BACKGROUND_SOURCE_BYTES + 1)], {
      type: 'image/png',
    });
    await expect(encodeBackgroundImage(huge)).resolves.toBeNull();
    await expect(
      encodeBackgroundImage(new Blob(['not a picture'], { type: 'image/png' }))
    ).resolves.toBeNull();
  });

  it('is kept on this device and comes back on the next page', async () => {
    const picture = new Blob(['picture'], { type: 'image/webp' });
    await expect(saveLocalBackground(picture)).resolves.toBe(true);
    // A new page: nothing in memory, the picture read back from IndexedDB.
    resetLocalBackgroundForTests();
    const host = document.createElement('div');
    const root = createRoot(host);
    const seen: (string | undefined)[] = [];
    const Probe = () => {
      seen.push(useLocalBackgroundUrl());
      return null;
    };
    await act(async () => root.render(<Probe />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(seen[0]).toBeUndefined();
    expect(seen.at(-1)).toMatch(/^blob:/u);
    await act(async () => root.unmount());
  });
});
