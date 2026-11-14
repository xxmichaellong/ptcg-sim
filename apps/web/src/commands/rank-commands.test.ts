import { describe, expect, it } from 'vitest';

import { flattenCommands } from './command-tree.js';
import {
  rankCommands,
  rankScreen,
  splitTrailingCount,
} from './rank-commands.js';
import type { PaletteCommand } from './types.js';

const run = () => undefined;
const command = (
  id: string,
  title: string,
  extra: Partial<PaletteCommand> = {}
): PaletteCommand => ({ id, title, section: 'turn', run, ...extra });

const titles = (sections: ReturnType<typeof rankCommands>) =>
  sections.map((section) => [
    section.section,
    section.entries.map(({ entry, count }) =>
      count === undefined
        ? entry.command.title
        : `${entry.command.title} ×${count}`
    ),
  ]);

describe('rankCommands', () => {
  const language: PaletteCommand = {
    id: 'settings.language',
    title: 'Language…',
    section: 'settings',
    submenu: () => ({
      breadcrumb: 'Language',
      commands: [
        command('settings.language.fr', 'Français', { section: 'settings' }),
        command('settings.language.pt', 'Português', { section: 'settings' }),
      ],
    }),
  };
  const commands: PaletteCommand[] = [
    command('turn.attack', 'Attack'),
    command('deck.draw', 'Draw cards…', {
      section: 'deck',
      count: {
        label: 'How many?',
        min: 1,
        max: 60,
        title: (n) => `Draw ${n} cards`,
      },
    }),
    command('hand.discard', 'Discard your hand and draw…', {
      section: 'deck',
      keywords: ['draw', 'professor'],
    }),
    command('cards.secret', 'Every card', {
      section: 'cards',
      requiresQuery: true,
    }),
    language,
  ];
  const entries = flattenCommands(commands);

  it('lists Recent, then each section in order, on an empty search', () => {
    expect(
      titles(rankCommands(entries, '', ['settings.language.fr', 'gone']))
    ).toEqual([
      ['recent', ['Français']],
      ['turn', ['Attack']],
      ['deck', ['Draw cards…', 'Discard your hand and draw…']],
      ['settings', ['Language…']],
    ]);
  });

  it('puts a title starting with the search above a keyword that equals it', () => {
    const [first] = rankCommands(entries, 'draw', []);
    expect(first!.entries.map(({ entry }) => entry.command.id)).toEqual([
      'deck.draw',
      'hand.discard',
    ]);
  });

  it('takes a number after the words as the count', () => {
    // Only a command that takes a number takes it; the others would need
    // the "3" in their names.
    expect(titles(rankCommands(entries, 'draw 3', []))).toEqual([
      ['deck', ['Draw cards… ×3']],
    ]);
    // Beyond its range, the count is held to it.
    expect(rankCommands(entries, 'draw 99', [])[0]!.entries[0]!.count).toBe(60);
  });

  it('finds nested choices by name or by their path, but not every child of a matching parent', () => {
    expect(
      rankCommands(entries, 'portu', []).flatMap((section) =>
        section.entries.map(({ entry }) => entry.command.id)
      )
    ).toEqual(['settings.language.pt']);
    expect(
      rankCommands(entries, 'language', []).flatMap((section) =>
        section.entries.map(({ entry }) => entry.command.id)
      )
    ).toEqual(['settings.language']);
  });

  it('caps a search at eight per section', () => {
    const many = flattenCommands(
      Array.from({ length: 12 }, (_, index) =>
        command(`turn.thing${index}`, `Thing ${index}`)
      )
    );
    const [only] = rankCommands(many, 'thing', []);
    expect(only!.entries).toHaveLength(8);
    // Ties keep the sources' order.
    expect(only!.entries[0]!.entry.command.id).toBe('turn.thing0');
  });

  it('leaves out what keeps its choices to itself', () => {
    const card: PaletteCommand = {
      id: 'cards.card.1',
      title: 'Pikachu',
      section: 'cards',
      nestedSearch: false,
      submenu: () => ({
        breadcrumb: 'Pikachu',
        commands: [command('cards.card.1.toHand', 'To hand')],
      }),
    };
    const flat = flattenCommands(
      [card],
      (entry) => entry.nestedSearch !== false
    );
    expect(flat.map((entry) => entry.command.id)).toEqual(['cards.card.1']);
  });
});

describe('rankScreen', () => {
  it('lists a screen in its order, or ranked when searched', () => {
    const screen = flattenCommands([
      command('a', 'Burned'),
      command('b', 'Asleep'),
      command('c', 'Poisoned'),
    ]);
    expect(rankScreen(screen, '').map(({ entry }) => entry.command.id)).toEqual(
      ['a', 'b', 'c']
    );
    expect(
      rankScreen(screen, 'pois').map(({ entry }) => entry.command.id)
    ).toEqual(['c']);
  });
});

describe('splitTrailingCount', () => {
  it('splits words from a trailing number', () => {
    expect(splitTrailingCount('draw 3')).toEqual({ text: 'draw', count: 3 });
    expect(splitTrailingCount(' look at top 12 ')).toEqual({
      text: 'look at top',
      count: 12,
    });
    expect(splitTrailingCount('3')).toEqual({ text: '3' });
    expect(splitTrailingCount('draw')).toEqual({ text: 'draw' });
    // Damage runs to four digits.
    expect(splitTrailingCount('set damage 9990')).toEqual({
      text: 'set damage',
      count: 9990,
    });
    // As said: the number before one last word.
    expect(splitTrailingCount('flip 3 coins')).toEqual({
      text: 'flip coins',
      count: 3,
    });
    expect(splitTrailingCount('draw 2 cards')).toEqual({
      text: 'draw cards',
      count: 2,
    });
    expect(splitTrailingCount('3 coins')).toEqual({ text: '3 coins' });
  });
});
