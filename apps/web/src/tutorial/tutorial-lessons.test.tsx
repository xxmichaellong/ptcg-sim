import { i18n } from '@lingui/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  lessonById,
  lessonsFor,
  TUTORIAL_LESSONS,
} from './tutorial-lessons.js';
import { TUTORIAL_CARDS } from './tutorial-cards.js';
import { CONTROL_LABELS } from './tutorial-labels.js';
import { activeStack, findCard, zoneCards, zoneId } from './tutorial-world.js';
import type { TutorialScreen, TutorialWorld } from './tutorial-world.js';
import type { MatchViewState } from '@ptcgsim/game-core';
import { fakePracticeRoom, them, you } from './practice-room.test-support.js';
import { dealScenario } from './scenario-runner.js';
import { resolveCardZoneMoveAction } from '../board/resolveCardZoneMoveAction.js';

const SCREEN: TutorialScreen = {
  preview: false,
  cardMenu: null,
  markerControls: null,
  pile: null,
  palette: false,
  deckScreen: false,
  sheet: false,
};

const EMPTY_VIEW = {
  viewer: { kind: 'player', playerId: 'you' },
  playerOrder: ['you', 'them'],
  definitions: {},
  zones: {},
  boards: {},
  stacks: {},
} as unknown as MatchViewState;

const world = (overrides: Partial<TutorialWorld> = {}): TutorialWorld => ({
  view: EMPTY_VIEW,
  start: EMPTY_VIEW,
  you: 'you',
  them: 'them',
  mode: 'mouse',
  events: [],
  flipped: false,
  screen: SCREEN,
  keys: (action) =>
    ({ 'card.toBench': 'B', 'table.commands': '`', 'table.shortcuts': '?' })[
      action as string
    ],
  ...overrides,
});

const text = (step: { text: (world: TutorialWorld) => unknown }, w = world()) =>
  renderToStaticMarkup(<>{step.text(w)}</>);

describe('the tutorial’s lessons', () => {
  it('are short: two to five steps each, every id its own', () => {
    for (const lesson of TUTORIAL_LESSONS) {
      expect(lesson.steps.length, lesson.id).toBeGreaterThanOrEqual(2);
      expect(lesson.steps.length, lesson.id).toBeLessThanOrEqual(5);
      const ids = lesson.steps.map((step) => step.id);
      expect(new Set(ids).size, lesson.id).toBe(ids.length);
      expect(lesson.version).toBeGreaterThanOrEqual(1);
      expect(i18n._(lesson.title)).not.toBe('');
      expect(i18n._(lesson.summary)).not.toBe('');
    }
    const ids = TUTORIAL_LESSONS.map((lesson) => lesson.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z-]{1,40}$/u);
  });

  it('offer the keys to a keyboard and Commands to a finger', () => {
    const mouse = lessonsFor('mouse').map((lesson) => lesson.id);
    const touch = lessonsFor('touch').map((lesson) => lesson.id);
    expect(mouse).toContain('keys');
    expect(mouse).not.toContain('commands');
    expect(touch).toContain('commands');
    expect(touch).not.toContain('keys');
    expect(mouse[0]).toBe('start');
    expect(touch[0]).toBe('start');
  });

  it('word each step for the hand that does it, in a line or two', () => {
    const cards = lessonById('cards')!;
    const read = cards.steps[0]!;
    expect(text(read)).toContain('Double-click');
    expect(text(read, world({ mode: 'touch' }))).toContain('Tap');
    expect(text(read, world({ mode: 'touch' }))).not.toContain('click');
    for (const lesson of TUTORIAL_LESSONS) {
      for (const step of lesson.steps) {
        for (const mode of ['mouse', 'touch'] as const) {
          const words = text(step, world({ mode }))
            .replaceAll(/<[^>]+>/gu, '')
            .split(/\s+/u)
            .filter(Boolean);
          // About twenty words at most: one thing to do at a time.
          expect(words.length, `${lesson.id}:${step.id}`).toBeLessThanOrEqual(
            22
          );
        }
      }
    }
  });

  it('are done by what the screen and the log show, not by a click', () => {
    const cards = lessonById('cards')!;
    const [read, close, menu, menuClose] = cards.steps;
    expect(read!.done!(world())).toBe(false);
    expect(read!.done!(world({ screen: { ...SCREEN, preview: true } }))).toBe(
      true
    );
    expect(close!.done!(world({ screen: { ...SCREEN, preview: true } }))).toBe(
      false
    );
    expect(close!.done!(world())).toBe(true);
    expect(
      menu!.done!(world({ screen: { ...SCREEN, cardMenu: 'card' } }))
    ).toBe(true);
    expect(menuClose!.done!(world())).toBe(true);

    const turns = lessonById('turns')!;
    expect(turns.steps[0]!.done!(world())).toBe(false);
    expect(
      turns.steps[0]!.done!(world({ events: [{ type: 'TurnStarted' }] }))
    ).toBe(true);
    // Attack or Pass both end it.
    expect(
      turns.steps[2]!.done!(world({ events: [{ type: 'PassDeclared' }] }))
    ).toBe(true);

    const both = lessonById('both-sides')!;
    expect(both.steps[0]!.done!(world({ flipped: true }))).toBe(true);
    // Their turn, not yours.
    expect(
      both.steps[1]!.done!(
        world({ events: [{ type: 'TurnStarted', playerId: 'you' }] })
      )
    ).toBe(false);
    expect(
      both.steps[1]!.done!(
        world({ events: [{ type: 'TurnStarted', playerId: 'them' }] })
      )
    ).toBe(true);
    expect(both.steps[2]!.done!(world({ flipped: false }))).toBe(true);
  });

  it('name the keys the player has set, and do without one turned off', () => {
    const keys = lessonById('keys')!;
    const bench = keys.steps[0]!;
    expect(text(bench)).toContain('<kbd>B</kbd>');
    expect(
      text(
        bench,
        world({
          keys: (action) =>
            action === 'card.toBench' ? 'Ctrl+Shift+B' : undefined,
        })
      )
    ).toContain('<kbd>Ctrl+Shift+B</kbd>');
    const off = world({ keys: () => undefined });
    expect(text(bench, off)).not.toContain('<kbd>');
    expect(text(keys.steps.at(-1)!, off)).toContain('Keyboard shortcuts');
    // Commands: its default key, `, is a dead key or missing on many
    // keyboards, so Ctrl+K, which opens it on all, unless the player set
    // their own.
    const palette = keys.steps[1]!;
    expect(text(palette)).toContain('<kbd>Ctrl+K</kbd>');
    expect(text(palette, off)).toContain('<kbd>Ctrl+K</kbd>');
    expect(
      text(
        palette,
        world({
          keys: (action) => (action === 'table.commands' ? 'P' : undefined),
        })
      )
    ).toContain('<kbd>P</kbd>');
  });

  it('point a game’s start at a Basic Pokémon, never a Stage', () => {
    const handOf = (keys: readonly (keyof typeof TUTORIAL_CARDS)[]) =>
      ({
        ...EMPTY_VIEW,
        definitions: Object.fromEntries(
          keys.map((key) => [
            `def-${key}`,
            { ...TUTORIAL_CARDS[key], id: `def-${key}` },
          ])
        ),
        zones: {
          'zone:you:hand': {
            id: 'zone:you:hand',
            kind: 'hand',
            ownerId: 'you',
            cards: keys.map((key, index) => ({
              kind: 'known',
              id: `card-${String(index)}`,
              definitionId: `def-${key}`,
            })),
          },
        },
      }) as unknown as MatchViewState;
    const active = lessonById('start')!.steps.find(
      (step) => step.id === 'active'
    )!;
    const mixed = world({ view: handOf(['charmeleon', 'charmander']) });
    expect(active.drag!(mixed)?.from).toEqual({ card: 'card-1' });
    expect(active.stuck!(mixed)).toBeNull();
    // Stages and Energy only: a mulligan, not a drag.
    const stages = world({ view: handOf(['charmeleon', 'charizardEx']) });
    expect(active.drag!(stages)).toBeNull();
    expect(text({ text: () => active.stuck!(stages) })).toContain(
      'No Basic Pokémon'
    );
    // Its only Basic put on the Bench first: up from there, no mulligan.
    const benched = {
      ...handOf(['fireEnergy']),
      definitions: {
        ...handOf(['fireEnergy']).definitions,
        'def-charmander': {
          ...TUTORIAL_CARDS.charmander,
          id: 'def-charmander',
        },
      },
      boards: { you: { activeStackId: null, benchStackIds: ['bench-stack'] } },
      stacks: {
        'bench-stack': {
          id: 'bench-stack',
          evolutionCards: [
            { kind: 'known', id: 'bench-card', definitionId: 'def-charmander' },
          ],
          attachmentCards: [],
        },
      },
    } as unknown as MatchViewState;
    const onBench = world({ view: benched });
    expect(active.stuck!(onBench)).toBeNull();
    expect(active.drag!(onBench)?.from).toEqual({ card: 'bench-card' });
  });

  it('name the controls as the controls name themselves, in any language', () => {
    const locale = i18n.locale;
    i18n.load('xx', {
      [CONTROL_LABELS.commands.id!]: 'Befehle',
      [CONTROL_LABELS.setUpAgain.id!]: 'Neu aufbauen',
      [CONTROL_LABELS.damageCounter.id!]: 'Schadensmarke',
      [CONTROL_LABELS.deck.id!]: 'Decks',
    });
    i18n.activate('xx');
    try {
      const commands = lessonById('commands')!.steps[0]!;
      expect(text(commands, world({ mode: 'touch' }))).toContain('Befehle');
      const active = lessonById('start')!.steps.find(
        (step) => step.id === 'active'
      )!;
      expect(text({ text: () => active.stuck!(world()) })).toContain(
        'Neu aufbauen'
      );
      const step = (id: string) =>
        TUTORIAL_LESSONS.flatMap((lesson) => lesson.steps).find(
          (candidate) => candidate.id === id
        )!;
      expect(text(step('counter'))).toContain('Schadensmarke');
      expect(text(step('deck'))).toContain('Decks');
    } finally {
      i18n.activate(locale);
    }
  });

  it('keep reading steps to read, and passes nothing to do over', () => {
    const around = lessonById('around')!;
    for (const step of around.steps) expect(step.done).toBeUndefined();
    // The first lesson's Bench: with no other Pokémon dealt, it goes on.
    const bench = lessonById('start')!.steps[3]!;
    expect(bench.optional).toBe(true);
    expect(bench.done!(world())).toBe(true);
  });
});

describe('a lesson step on the practice table', () => {
  it('knocks out the whole Pokémon, not Kirlia moved alone off it', async () => {
    const lesson = lessonById('knock-out')!;
    const [discard] = lesson.steps;
    const dealt = async () => {
      const room = fakePracticeRoom();
      await dealScenario(
        room.session,
        lesson.scenario,
        new AbortController().signal
      );
      const start = room.session.getSnapshot().view!;
      const atNow = (): TutorialWorld =>
        world({ view: room.session.getSnapshot().view!, start, you, them });
      return { room, start, atNow };
    };
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    // Kirlia alone (a key, the menu, a long press): Ralts and its Energy
    // are left by the table, and the step says so.
    {
      const { room, start, atNow } = await dealt();
      const kirlia = activeStack(start, them)!.evolutionCards.at(-1)!;
      // As the D key resolves it.
      const move = resolveCardZoneMoveAction(start, kirlia.id, 'discard', you);
      if (!move.ok) throw new Error('the move was refused');
      expect(move.command.type).toBe('MoveCardFromStack');
      room.session.submit(move.command);
      await flush();
      expect(activeStack(atNow().view, them)).toBeUndefined();
      expect(discard!.done!(atNow())).toBe(false);
      expect(text({ text: discard!.stuck! }, atNow())).toContain('Ralts');
      // Put back in play from its window: still said, still not done.
      const view = atNow().view;
      const area = (
        room as unknown as {
          match: () => {
            workAreas: Record<
              string,
              { attachmentResolution?: { id: string } }
            >;
          };
        }
      ).match().workAreas[them]!.attachmentResolution!;
      room.session.submit({
        type: 'RestoreStagedStack',
        playerId: them,
        expectedWorkAreaId: area.id,
        expectedActiveStackId: null,
        expectedBenchStackIds: view.boards[them]!.benchStackIds,
        destinationSlot: 'active',
      } as never);
      await flush();
      expect(activeStack(atNow().view, them)).toBeDefined();
      expect(discard!.done!(atNow())).toBe(false);
      expect(text({ text: discard!.stuck! }, atNow())).toContain('Ralts');
    }
    // The whole of it, as a drag takes it.
    {
      const { room, start, atNow } = await dealt();
      const stack = activeStack(start, them)!;
      room.session.submit({
        type: 'MovePlayStackToZone',
        stackId: stack.id,
        expectedEvolutionCardIds: stack.evolutionCards.map((card) => card.id),
        expectedAttachmentCardIds: stack.attachmentCards.map((card) => card.id),
        destinationZoneId: zoneId(them, 'discard'),
      } as never);
      await flush();
      expect(discard!.done!(atNow())).toBe(true);
    }
  });

  it('is done when the player did it before it was asked', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const dealt = async (id: string) => {
      const room = fakePracticeRoom();
      await dealScenario(
        room.session,
        lessonById(id)!.scenario,
        new AbortController().signal
      );
      const now = () => room.session.getSnapshot().view!;
      return { room, now };
    };
    // Pidgey benched during an earlier step of its lesson.
    {
      const { room, now } = await dealt('attach');
      const bench = lessonById('attach')!.steps.find(
        (step) => step.id === 'bench'
      )!;
      const pidgey = findCard(now(), zoneCards(now(), you, 'hand'), 'pidgey')!;
      room.session.submit({
        type: 'MoveCardToPlay',
        cardId: pidgey.id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        boardPlayerId: you,
        slot: 'bench',
      } as never);
      await flush();
      const start = now();
      expect(bench.done!(world({ view: now(), start, you, them }))).toBe(true);
    }
    // Rare Candy taken from the open deck at the draw step.
    {
      const { room, now } = await dealt('deck');
      const take = lessonById('deck')!.steps.find(
        (step) => step.id === 'take'
      )!;
      const candy = findCard(
        now(),
        zoneCards(now(), you, 'deck'),
        'rareCandy'
      )!;
      room.session.submit({
        type: 'MoveCard',
        cardId: candy.id,
        expectedSourceZoneId: zoneId(you, 'deck'),
        destinationZoneId: zoneId(you, 'hand'),
      } as never);
      await flush();
      const start = now();
      const screen = { ...SCREEN, pile: 'deck' };
      expect(take.done!(world({ view: now(), start, you, them, screen }))).toBe(
        true
      );
    }
  });
});
