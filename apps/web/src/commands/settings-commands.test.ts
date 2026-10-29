import { afterEach, describe, expect, it, vi } from 'vitest';

import { boardViewSettings } from '../board/view/board-view-settings.js';
import {
  DEFAULT_TABLE_DEPTH,
  depthSettings,
} from '../motion/depth-settings.js';
import {
  appSettingCommands,
  boardViewCommands,
  settingsSheetCommands,
} from './settings-commands.js';

afterEach(() => {
  boardViewSettings().reset();
  depthSettings().update(DEFAULT_TABLE_DEPTH);
});

describe('the palette’s settings', () => {
  it('names each row as Settings does, under its section', () => {
    const commands = appSettingCommands();
    expect(commands.map((command) => [command.title, command.detail])).toEqual([
      ['Style…', 'Table'],
      ['Depth…', 'Table'],
      ['Angle…', 'Table'],
      ['Thickness…', 'Table'],
      ['Halves…', 'Table'],
      ['Split…', 'Table'],
      ['Zone outlines', 'Table'],
      ['Reset table settings', 'Table'],
      ["Opponent's cards face me", 'Cards'],
      ['Preview on hover', 'Cards'],
      ['Natural placement', 'Cards'],
      ["Opponents' custom backs", 'Cards'],
      ['Reduce motion…', 'Motion'],
      ['Speed…', 'Motion'],
      ['Lift while dragging', 'Motion'],
      ['Animate stacks', 'Motion'],
      ['Parallax', 'Motion'],
      ['Language…', 'Language'],
      ['Card images…', 'Language'],
    ]);
    expect(new Set(commands.map((command) => command.section))).toEqual(
      new Set(['settings'])
    );
  });

  it('sets the split and the angle by number, and resets the table', () => {
    const byId = (id: string) =>
      appSettingCommands().find((command) => command.id === id)!;
    byId('settings.tableSplit').run!({ count: 60 });
    expect(boardViewSettings().getSnapshot().split).toBe(0.6);
    byId('settings.tableAngle').run!({ count: 12 });
    expect(depthSettings().getSnapshot().tilt).toBe(12);
    byId('settings.resetTable').run!({});
    expect(depthSettings().getSnapshot()).toEqual(DEFAULT_TABLE_DEPTH);
  });

  it('leaves the pointer’s rows out on a touch screen', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse) and (hover: none)',
    }));
    try {
      const titles = appSettingCommands().map((command) => command.title);
      expect(titles).not.toContain('Preview on hover');
      expect(titles).not.toContain('Parallax');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens Settings, or at one of its sections, and turns dark mode', () => {
    const open = vi.fn();
    const onDarkModeChange = vi.fn();
    const commands = settingsSheetCommands({
      sections: ['table', 'cards', 'motion', 'language'],
      open,
      hint: ',',
      darkMode: true,
      onDarkModeChange,
      background: {
        current: undefined,
        onChange: vi.fn(),
        onRequestLink: vi.fn(),
      },
    });
    expect(commands.map((command) => command.title)).toEqual([
      'Settings',
      'Settings: Table',
      'Settings: Cards',
      'Settings: Motion',
      'Settings: Language',
      'Background…',
      'Dark mode',
    ]);
    expect(commands[0]!.hint).toBe(',');
    commands[2]!.run!({});
    expect(open).toHaveBeenCalledWith('cards');
    commands.at(-1)!.run!({});
    expect(onDarkModeChange).toHaveBeenCalledWith(false);
  });

  it('chooses the background as the tiles do: no words to type', () => {
    const open = vi.fn();
    const onChange = vi.fn();
    const onRequestLink = vi.fn();
    const background = settingsSheetCommands({
      sections: [],
      open,
      darkMode: false,
      onDarkModeChange: vi.fn(),
      background: {
        current: { kind: 'image', url: '/v2/assets/background1.jpg' },
        onChange,
        onRequestLink,
      },
    }).find((command) => command.id === 'settings.background')!;
    expect(background.status).toBe('Wallpaper 1');
    const choices = background.submenu!().commands;
    expect(
      choices.map((command) => [command.title, command.active ?? false])
    ).toEqual([
      ['Desk', false],
      ['None', false],
      ['Wallpaper 1', true],
      ['Wallpaper 2', false],
      ['Custom image…', false],
      ['From a link…', false],
    ]);
    choices[0]!.run!({});
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    choices[1]!.run!({});
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'blank' });
    // A picture is picked or dropped in Settings, at the table's section.
    choices[4]!.run!({});
    expect(open).toHaveBeenCalledWith('table');
    choices[5]!.run!({});
    expect(onRequestLink).toHaveBeenCalledOnce();
  });

  it('keeps the table’s pieces and the Solo cover with the table', () => {
    expect(
      boardViewCommands({ solo: true }).map((command) => [
        command.id,
        command.section,
      ])
    ).toEqual([
      ['table.lostZone', 'table'],
      ['table.vstarMarker', 'table'],
      ['table.gxMarker', 'table'],
      ['table.hideOpponentHand', 'table'],
    ]);
  });
});
