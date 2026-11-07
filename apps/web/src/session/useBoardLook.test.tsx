// @vitest-environment happy-dom

import {
  DEFAULT_BOARD_PREFERENCES,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { boardViewSettings } from '../board/view/board-view-settings.js';
import { useBoardLook } from './useBoardLook.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let worn: BoardPreferences | undefined;

const Probe = ({ stored }: { readonly stored: BoardPreferences }) => {
  worn = useBoardLook(stored);
  return null;
};

beforeEach(() => {
  boardViewSettings().reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  boardViewSettings().reset();
});

it('follows the outline choice over a look stored while it was otherwise', async () => {
  // Codex review round 7: Night/Day stores the look as worn, outlines and
  // all; the outline choice must still win once it changes.
  boardViewSettings().update({ zoneOutlines: 'always' });
  await act(async () =>
    root.render(<Probe stored={DEFAULT_BOARD_PREFERENCES} />)
  );
  expect(worn?.outlineFilledZones).toBe(true);
  const storedWhileAlways = { ...worn!, darkMode: false };
  boardViewSettings().update({ zoneOutlines: 'empty' });
  await act(async () => root.render(<Probe stored={storedWhileAlways} />));
  expect(worn?.outlineFilledZones).toBeUndefined();
  expect(worn?.showZoneOutlines).toBe(true);
  boardViewSettings().update({ zoneOutlines: 'never' });
  await act(async () => root.render(<Probe stored={storedWhileAlways} />));
  expect(worn?.outlineFilledZones).toBeUndefined();
  expect(worn?.showZoneOutlines).toBe(false);
});
