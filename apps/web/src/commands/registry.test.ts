import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectCommands,
  commandSourcesVersion,
  registerCommandSource,
  subscribeCommandSources,
} from './registry.js';
import { COMMAND_PREFERENCES, recordCommandRun } from './recent-commands.js';
import { PreferenceStore } from '../preferences/preference-store.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('command registry', () => {
  it('lists what its sources list, and tells listeners when one comes or goes', () => {
    const listener = vi.fn();
    cleanups.push(subscribeCommandSources(listener));
    const before = commandSourcesVersion();
    const remove = registerCommandSource({
      commands: () => [
        { id: 'a', title: 'A', section: 'turn', run: () => undefined },
      ],
    });
    expect(collectCommands().map((command) => command.id)).toContain('a');
    remove();
    expect(collectCommands().map((command) => command.id)).not.toContain('a');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(commandSourcesVersion()).toBe(before + 2);
  });

  it('keeps a failing source from taking the others down', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    cleanups.push(
      registerCommandSource({
        commands: () => {
          throw new Error('broken');
        },
      }),
      registerCommandSource({
        commands: () => [
          { id: 'b', title: 'B', section: 'turn', run: () => undefined },
        ],
      }),
      () => error.mockRestore()
    );
    expect(collectCommands().map((command) => command.id)).toEqual(['b']);
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('recent commands', () => {
  it('keeps the latest first, once each, ten at most', () => {
    const store = new PreferenceStore({ storage: null });
    for (let index = 0; index < 12; index += 1)
      recordCommandRun(`c${index}`, store);
    recordCommandRun('c5', store);
    const { recent } = store.get(COMMAND_PREFERENCES);
    expect(recent[0]).toBe('c5');
    expect(recent).toHaveLength(10);
    expect(new Set(recent).size).toBe(10);
  });
});
