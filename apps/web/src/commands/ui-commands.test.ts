import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { describe, expect, it } from 'vitest';

import { flattenCommands } from './command-tree.js';
import { rankCommands } from './rank-commands.js';
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
});
