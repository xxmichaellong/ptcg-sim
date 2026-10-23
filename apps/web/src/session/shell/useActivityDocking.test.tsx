// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preferences } from '../../preferences/preference-store.js';
import { SHELL_PREFERENCES } from './shell-preferences.js';
import {
  ACTIVITY_DOCK_QUERY,
  useActivityDocking,
} from './useActivityDocking.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let wide = true;
const listeners = new Set<() => void>();

const resize = async (nextWide: boolean): Promise<void> => {
  wide = nextWide;
  await act(async () => {
    for (const listener of listeners) listener();
  });
};

let host: HTMLDivElement;
let root: Root;
let docking: ReturnType<typeof useActivityDocking>;

const Probe = () => {
  docking = useActivityDocking();
  return null;
};

beforeEach(async () => {
  wide = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === ACTIVITY_DOCK_QUERY ? wide : false,
    media: query,
    addEventListener: (_type: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  preferences().reset(SHELL_PREFERENCES);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  preferences().reset(SHELL_PREFERENCES);
  listeners.clear();
  vi.unstubAllGlobals();
});

describe('useActivityDocking', () => {
  it('asks for a window wide and tall enough to keep the table playable beside the log', () => {
    expect(ACTIVITY_DOCK_QUERY).toBe(
      '(min-width: 1025px) and (min-height: 500px)'
    );
  });

  it('docks on a wide screen and keeps the log as the player left it', async () => {
    expect(docking).toMatchObject({ docked: true, open: false });
    await act(async () => docking.setOpen(true));
    expect(docking.open).toBe(true);
    expect(preferences().get(SHELL_PREFERENCES).activityDocked).toBe(true);

    // Another visit (a remount) finds it open again.
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<Probe />));
    expect(docking).toMatchObject({ docked: true, open: true });

    await act(async () => docking.setOpen(false));
    expect(preferences().get(SHELL_PREFERENCES).activityDocked).toBe(false);
  });

  it('opens over the table on a smaller screen, closed each time and never remembered', async () => {
    await act(async () => docking.setOpen(true));
    await resize(false);
    // A docked log left open does not cover a small table on its own.
    expect(docking).toMatchObject({ docked: false, open: false });
    await act(async () => docking.setOpen(true));
    expect(docking.open).toBe(true);
    await act(async () => docking.setOpen(false));
    expect(docking.open).toBe(false);
    expect(preferences().get(SHELL_PREFERENCES).activityDocked).toBe(true);

    await resize(true);
    expect(docking).toMatchObject({ docked: true, open: true });
  });
});
