import { describe, expect, it } from 'vitest';

import { menuCommands, railCommands } from './ui-commands.js';

const noop = () => undefined;

describe('menuCommands', () => {
  it("keeps Play online's own name and words", () => {
    const [online] = menuCommands([
      { id: 'p2Button', label: 'Play online', onSelect: noop },
    ]);
    expect(online?.id).toBe('menu.p2');
    expect(online?.keywords).toEqual(
      expect.arrayContaining(['multiplayer', 'invite', 'friend'])
    );
  });

  it('leaves out the button that opens the palette', () => {
    expect(
      menuCommands([
        { id: 'commandsButton', label: 'Commands', onSelect: noop },
      ])
    ).toEqual([]);
  });
});

describe('railCommands', () => {
  it("gives either seat's button one id", () => {
    const [attack] = railCommands(
      {
        actions: [
          {
            id: 'p2AttackButton',
            label: 'Attack',
            icon: (() => null) as never,
            onSelect: noop,
          },
        ],
      },
      { replaying: false }
    );
    expect(attack?.id).toBe('rail.attack');
    expect(attack?.section).toBe('turn');
  });
});
