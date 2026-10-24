import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { describe, expect, it } from 'vitest';

import { flattenCommands } from './command-tree.js';
import { rankCommands } from './rank-commands.js';
import { roomCommands } from './room-commands.js';
import type { PaletteCommand } from './types.js';
import {
  menuCommands,
  railCommands,
  tutorialLessonCommands,
} from './ui-commands.js';

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
  it('is found by the button’s own label, which the lessons name it by', () => {
    // German Pass: its label "Passen", its tooltip "Zug beenden".
    const commands = railCommands(
      {
        actions: [
          {
            id: 'passButton',
            label: 'Passen',
            title: 'Zug beenden',
            icon: (() => null) as never,
            onSelect: noop,
          },
          {
            id: 'flipBoardButton',
            label: 'Flip',
            title: 'Flip the table',
            icon: (() => null) as never,
            onSelect: noop,
          },
        ],
      },
      { replaying: false }
    );
    const found = (query: string) =>
      rankCommands(flattenCommands(commands), query, []).flatMap((section) =>
        section.entries.map((entry) => entry.entry.command.id)
      );
    expect(found('Passen')[0]).toBe('rail.pass');
    // Its palette title is "Turn the table around"; the label and the
    // tooltip still find it.
    expect(found('Flip')[0]).toBe('rail.flipBoard');
    expect(found('Flip the table')[0]).toBe('rail.flipBoard');
  });

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

  it('leaves out a button with nothing to do now, as the rail dims it', () => {
    const commands = railCommands(
      {
        actions: [
          {
            id: 'undoButton',
            label: 'Undo',
            icon: (() => null) as never,
            disabled: true,
            onSelect: noop,
          },
          {
            id: 'passButton',
            label: 'Pass',
            icon: (() => null) as never,
            onSelect: noop,
          },
        ],
      },
      { replaying: false }
    );
    expect(commands.map((command) => command.id)).toEqual(['rail.pass']);
  });
});

describe('the app bar by its buttons’ labels', () => {
  it('finds Settings and the Log by the words on their buttons', () => {
    // Filipino Settings; Dutch Log, whose command says "Log openen".
    const menu = menuCommands([
      { id: 'settingsButton', label: 'Mga setting', onSelect: noop },
    ]);
    const label = msg`Log`;
    const open = msg`Open log`;
    i18n.load('xx', { [label.id!]: 'Logboek', [open.id!]: 'Log openen' });
    i18n.activate('xx');
    let log: readonly PaletteCommand[];
    try {
      log = roomCommands({
        menu: { onSettings: noop },
        log: { open: false, setOpen: noop },
        deckOpen: false,
        closeDeck: noop,
      }).filter((command) => command.id === 'log.toggle');
    } finally {
      i18n.activate('en');
    }
    const first = (query: string) =>
      rankCommands(flattenCommands([...menu, ...log]), query, [])[0]?.entries[0]
        ?.entry.command.id;
    expect(first('Mga setting')).toBe('menu.settings');
    expect(first('Logboek')).toBe('log.toggle');
  });
});

describe('a button and a lesson by one name', () => {
  it('runs the button first: its label counts as its title, and a lesson ranks below', () => {
    const icon = (() => null) as never;
    const rail = railCommands(
      {
        actions: [
          // Chinese: the Turn button's label is the Turns lesson's title.
          {
            id: 'turnButton',
            label: '回合',
            title: '开始回合',
            icon,
            onSelect: noop,
          },
          {
            id: 'flipBoardButton',
            label: 'Flip',
            title: 'Flip the table',
            icon,
            onSelect: noop,
          },
        ],
      },
      { replaying: false }
    );
    const lessons = tutorialLessonCommands(
      [{ id: 'turns', title: '回合' }],
      noop
    );
    const coin = {
      id: 'coin.flip',
      title: 'Flip a coin',
      section: 'table' as const,
      run: noop,
    };
    const first = (query: string) =>
      rankCommands(flattenCommands([...lessons, coin, ...rail]), query, [])[0]
        ?.entries[0]?.entry.command.id;
    expect(first('回合')).toBe('rail.turn');
    expect(first('Flip')).toBe('rail.flipBoard');
  });
});

describe('tutorial lessons in the palette', () => {
  const found = (query: string): string[] => {
    const lessons = tutorialLessonCommands(
      [
        { id: 'damage', title: i18n._(msg`Damage and conditions`) },
        { id: 'deck', title: i18n._(msg`Your deck`) },
      ],
      () => undefined
    );
    return rankCommands(flattenCommands(lessons), query, []).flatMap(
      (section) => section.entries.map((entry) => entry.entry.command.id)
    );
  };

  it('goes to a lesson by "tutorial" and its name, in the page’s language too', () => {
    expect(found('tutorial damage')[0]).toBe('tutorial.damage');
    const tutorial = msg`Tutorial`;
    const damage = msg`Damage and conditions`;
    i18n.load('xx', { [tutorial.id!]: 'Tutoriel', [damage.id!]: 'Dégâts' });
    i18n.activate('xx');
    try {
      expect(found('Tutoriel dég')[0]).toBe('tutorial.damage');
      expect(found('tutoriel')).toEqual(
        expect.arrayContaining(['tutorial.damage', 'tutorial.deck'])
      );
    } finally {
      i18n.activate('en');
    }
  });

  it('goes to a lesson by "lesson" or "help" on the practice table, not out of it', () => {
    const commands = [
      ...roomCommands({
        menu: { onExitTutorial: noop, onSettings: noop },
        log: { open: false, setOpen: noop },
        deckOpen: false,
        closeDeck: noop,
      }),
      // A table action whose title spells out "help" (sHuffle … pLaybo…).
      {
        id: 'board.shuffleAll',
        title: 'Shuffle all on playboard into deck',
        section: 'table' as const,
        run: noop,
      },
      ...tutorialLessonCommands(
        [
          { id: 'damage', title: 'Damage and conditions' },
          { id: 'deck', title: 'Your deck' },
        ],
        noop,
        { practice: true }
      ),
    ];
    const first = (query: string) =>
      rankCommands(flattenCommands(commands), query, [])[0]?.entries[0]?.entry
        .command.id;
    for (const query of ['lesson', 'lessons', 'learn', 'help'])
      expect(String(first(query)), query).toMatch(/^tutorial\./u);
    // Leaving still has its own name and words, and asks for a second
    // Enter: it drops the table and the lesson.
    expect(first('Leave tutorial')).toBe('menu.leaveTutorial');
    expect(first('exit')).toBe('menu.leaveTutorial');
    expect(
      commands.find((command) => command.id === 'menu.leaveTutorial')?.dangerous
    ).toBe(true);
  });
});
