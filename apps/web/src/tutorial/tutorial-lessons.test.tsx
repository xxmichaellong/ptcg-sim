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
import {
  activeStack,
  benchStacks,
  findCard,
  topCard,
  zoneCards,
  zoneId,
} from './tutorial-world.js';
import { tutorialCardKeyOf } from './tutorial-cards.js';
import type { TutorialScreen, TutorialWorld } from './tutorial-world.js';
import type { MatchViewState } from '@ptcgsim/game-core';
import { fakePracticeRoom, them, you } from './practice-room.test-support.js';
import { dealScenario } from './scenario-runner.js';
import { resolveCardZoneMoveAction } from '../board/resolveCardZoneMoveAction.js';

const SCREEN: TutorialScreen = {
  preview: false,
  cardMenu: null,
  markerControls: null,
  markerControlsCard: null,
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

/** What kind of card tops a Pokémon, if any. */
const topOf = (
  view: MatchViewState,
  stack: Parameters<typeof topCard>[0]
): string | undefined => {
  const card = topCard(stack);
  return card ? tutorialCardKeyOf(view, card) : undefined;
};

/** A table whose only cards are a hand of these. */
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
      [CONTROL_LABELS.setUp.id!]: 'Aufbauen',
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
      // A hand of no Basic: Set up again; none dealt: Set up.
      expect(
        text({
          text: () =>
            active.stuck!(
              world({ view: handOf(['charmeleon', 'charizardEx']) })
            ),
        })
      ).toContain('Neu aufbauen');
      expect(text({ text: () => active.stuck!(world()) })).toContain(
        'Aufbauen'
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
    // The first lesson's Bench: with no other Pokémon dealt, it goes on,
    // a Basic in the Active Spot.
    const bench = lessonById('start')!.steps[3]!;
    expect(bench.optional).toBe(true);
    const energyOnly = handOf(['fireEnergy']);
    const withActive = {
      ...energyOnly,
      definitions: {
        ...energyOnly.definitions,
        'def-charmander': {
          ...TUTORIAL_CARDS.charmander,
          id: 'def-charmander',
        },
      },
      boards: { you: { activeStackId: 'active-stack', benchStackIds: [] } },
      stacks: {
        'active-stack': {
          id: 'active-stack',
          evolutionCards: [
            {
              kind: 'known',
              id: 'active-card',
              definitionId: 'def-charmander',
            },
          ],
          attachmentCards: [],
        },
      },
    } as unknown as MatchViewState;
    expect(bench.done!(world({ view: withActive }))).toBe(true);
    // The Active gone meanwhile (an Undo, a deal again): not done, and it
    // says to put one there first, the drag to the Active Spot.
    const noActive = world({ view: handOf(['charmander']) });
    expect(bench.done!(noActive)).toBe(false);
    expect(text({ text: () => bench.stuck!(noActive) })).toContain(
      'Active Spot'
    );
    expect(bench.drag!(noActive)?.to).toEqual(
      expect.objectContaining({ zone: expect.stringContaining('active') })
    );
    // Not on a hand taken back (a Reset, an Undo of Set up): it says to set
    // up again.
    expect(bench.done!(world())).toBe(false);
    expect(text({ text: () => bench.stuck!(world()) })).toContain('Press');
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

  it('is not done by the card put somewhere other than the step asks', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const dealt = async (id: string) => {
      const room = fakePracticeRoom();
      await dealScenario(
        room.session,
        lessonById(id)!.scenario,
        new AbortController().signal
      );
      const now = () => room.session.getSnapshot().view!;
      const send = async (command: unknown) => {
        room.session.submit(command as never);
        await flush();
      };
      return { now, send, start: now() };
    };
    const stepOf = (lesson: string, step: string) =>
      lessonById(lesson)!.steps.find((entry) => entry.id === step)!;
    const inHand = (now: () => MatchViewState, key: 'pidgey' | 'charmeleon') =>
      findCard(now(), zoneCards(now(), you, 'hand'), key)!;
    // Pidgey into the Active Spot, Charmander pushed to the Bench: not
    // benched, in either lesson.
    for (const [lesson, step] of [
      ['attach', 'bench'],
      ['keys', 'bench-key'],
    ] as const) {
      const { now, send, start } = await dealt(lesson);
      await send({
        type: 'MoveCardToPlay',
        cardId: inHand(now, 'pidgey').id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        boardPlayerId: you,
        slot: 'active',
      });
      expect(topOf(now(), activeStack(now(), you))).toBe('pidgey');
      expect(
        stepOf(lesson, step).done!(world({ view: now(), start, you, them })),
        lesson
      ).toBe(false);
    }
    // The dealt Pidgey discarded, then the hand's benched: benched.
    {
      const { now, send, start } = await dealt('attach');
      const dealtPidgey = now()
        .boards[you]!.benchStackIds.map((id) => now().stacks[id]!)
        .find((stack) => topOf(now(), stack) === 'pidgey')!;
      await send({
        type: 'MovePlayStackToZone',
        stackId: dealtPidgey.id,
        expectedEvolutionCardIds: dealtPidgey.evolutionCards.map(
          (card) => card.id
        ),
        expectedAttachmentCardIds: dealtPidgey.attachmentCards.map(
          (card) => card.id
        ),
        destinationZoneId: zoneId(you, 'discard'),
      });
      await send({
        type: 'MoveCardToPlay',
        cardId: inHand(now, 'pidgey').id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        boardPlayerId: you,
        slot: 'bench',
      });
      expect(
        stepOf('attach', 'bench').done!(
          world({ view: now(), start, you, them })
        )
      ).toBe(true);
    }
    // Charmeleon put on the Bench by itself, or on Pidgey: Charmander isn't
    // evolved. Onto Charmander, it is.
    for (const onto of ['new', 'pidgey', 'charmander'] as const) {
      const { now, send, start } = await dealt('attach');
      const pidgey = now()
        .boards[you]!.benchStackIds.map((id) => now().stacks[id]!)
        .find((stack) => topOf(now(), stack) === 'pidgey')!;
      await send({
        type: 'MoveCardToPlay',
        cardId: inHand(now, 'charmeleon').id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        boardPlayerId: you,
        slot: onto === 'charmander' ? 'active' : 'bench',
        ...(onto === 'pidgey' ? { targetStackId: pidgey.id } : {}),
        ...(onto === 'charmander'
          ? { targetStackId: activeStack(now(), you)!.id }
          : {}),
      });
      expect(
        stepOf('attach', 'evolve').done!(
          world({ view: now(), start, you, them })
        ),
        onto
      ).toBe(onto === 'charmander');
    }
    // A Prize put in the discard: not taken into the hand.
    {
      const { now, send, start } = await dealt('knock-out');
      const prize = zoneCards(now(), you, 'prizes')[0]!;
      await send({
        type: 'MoveCard',
        cardId: prize.id,
        expectedSourceZoneId: zoneId(you, 'prizes'),
        destinationZoneId: zoneId(you, 'discard'),
      });
      expect(
        stepOf('knock-out', 'prize').done!(
          world({ view: now(), start, you, them })
        )
      ).toBe(false);
      const next = zoneCards(now(), you, 'prizes')[0]!;
      await send({
        type: 'MoveCard',
        cardId: next.id,
        expectedSourceZoneId: zoneId(you, 'prizes'),
        destinationZoneId: zoneId(you, 'hand'),
      });
      expect(
        stepOf('knock-out', 'prize').done!(
          world({ view: now(), start, you, them })
        )
      ).toBe(true);
    }
  });

  it('is done by the card it asks for, wherever else the player puts things', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const dealt = async (id: string) => {
      const room = fakePracticeRoom();
      await dealScenario(
        room.session,
        lessonById(id)!.scenario,
        new AbortController().signal
      );
      const now = () => room.session.getSnapshot().view!;
      const send = async (command: unknown) => {
        room.session.submit(command as never);
        await flush();
      };
      const toPlay = (
        cardId: string,
        slot: 'active' | 'bench',
        targetStackId?: string
      ) =>
        send({
          type: 'MoveCardToPlay',
          cardId,
          expectedSourceZoneId: zoneId(you, 'hand'),
          boardPlayerId: you,
          slot,
          ...(targetStackId ? { targetStackId } : {}),
        });
      const inHand = (key: Parameters<typeof findCard>[2]) =>
        findCard(now(), zoneCards(now(), you, 'hand'), key)!;
      return { room, now, send, toPlay, inHand, start: now() };
    };
    const stepOf = (lesson: string, step: string) =>
      lessonById(lesson)!.steps.find((entry) => entry.id === step)!;
    // Pidgey dropped on the dealt one, taken back to the hand, the dealt one
    // left in play from the attached cards' window: nothing benched.
    for (const [lesson, step] of [
      ['attach', 'bench'],
      ['keys', 'bench-key'],
    ] as const) {
      const { room, now, send, toPlay, inHand, start } = await dealt(lesson);
      const pidgey = now()
        .boards[you]!.benchStackIds.map((id) => now().stacks[id]!)
        .find((stack) => topOf(now(), stack) === 'pidgey')!;
      await toPlay(inHand('pidgey').id, 'bench', pidgey.id);
      const top = now().stacks[pidgey.id]!.evolutionCards.at(-1)!;
      await send({
        type: 'MoveCardFromStack',
        cardId: top.id,
        expectedStackId: pidgey.id,
        destinationZoneId: zoneId(you, 'hand'),
      });
      const area = (
        room as unknown as {
          match: () => {
            workAreas: Record<
              string,
              {
                attachmentResolution?: {
                  id: string;
                  suggestedSlot: 'active' | 'bench';
                };
              }
            >;
          };
        }
      ).match().workAreas[you]!.attachmentResolution!;
      const board = now().boards[you]!;
      await send({
        type: 'RestoreStagedStack',
        playerId: you,
        expectedWorkAreaId: area.id,
        expectedActiveStackId: board.activeStackId,
        expectedBenchStackIds: [...board.benchStackIds],
        destinationSlot: area.suggestedSlot,
      });
      const at = world({ view: now(), start, you, them });
      expect(inHand('pidgey'), lesson).toBeDefined();
      expect(stepOf(lesson, step).done!(at), lesson).toBe(false);
      // Pidgey into the Active Spot instead: not benched, and said.
      await toPlay(inHand('pidgey').id, 'active');
      const after = world({ view: now(), start, you, them });
      expect(stepOf(lesson, step).done!(after), lesson).toBe(false);
      expect(text({ text: stepOf(lesson, step).stuck! }, after)).toContain(
        'has left your hand'
      );
    }
    // A game's start: only a Basic in the Active Spot, and a Basic newly on
    // the Bench, not the Active pushed there.
    {
      const { now, send, toPlay, inHand, start } = await dealt('start');
      for (const key of ['charmander', 'charizardEx', 'fireEnergy'] as const) {
        const card = findCard(now(), zoneCards(now(), you, 'deck'), key)!;
        await send({
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: zoneId(you, 'deck'),
          destinationZoneId: zoneId(you, 'hand'),
        });
      }
      const active = stepOf('start', 'active');
      await toPlay(inHand('charizardEx').id, 'active');
      expect(
        active.done!(world({ view: now(), start, you, them })),
        'Charizard ex'
      ).toBe(false);
    }
    {
      const { now, send, toPlay, inHand } = await dealt('start');
      // Two Charmander and a Pidgey: a Basic is left to bench.
      for (const key of ['charmander', 'charmander', 'pidgey'] as const) {
        const card = findCard(now(), zoneCards(now(), you, 'deck'), key)!;
        await send({
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: zoneId(you, 'deck'),
          destinationZoneId: zoneId(you, 'hand'),
        });
      }
      await toPlay(inHand('charmander').id, 'active');
      expect(
        stepOf('start', 'active').done!(
          world({ view: now(), start: now(), you, them })
        )
      ).toBe(true);
      const start = now();
      // The second Charmander onto the Active Spot: the first is pushed to
      // the Bench, nothing benched.
      await toPlay(inHand('charmander').id, 'active');
      expect(benchStacks(now(), you)).toHaveLength(1);
      expect(
        stepOf('start', 'bench').done!(world({ view: now(), start, you, them }))
      ).toBe(false);
    }
    // A Prize taken after a card left the hand: taken.
    {
      const { now, send, toPlay, inHand, start } = await dealt('knock-out');
      await toPlay(
        inHand('fireEnergy').id,
        'active',
        now().boards[you]!.activeStackId!
      );
      const prize = zoneCards(now(), you, 'prizes')[0]!;
      await send({
        type: 'MoveCard',
        cardId: prize.id,
        expectedSourceZoneId: zoneId(you, 'prizes'),
        destinationZoneId: zoneId(you, 'hand'),
      });
      expect(
        stepOf('knock-out', 'prize').done!(
          world({ view: now(), start, you, them })
        )
      ).toBe(true);
    }
    // Damage controls opened on their Kirlia, not on your own Pokémon.
    {
      const { now, start } = await dealt('damage');
      const theirs = topCard(activeStack(now(), them))!.id;
      const mine = topCard(activeStack(now(), you))!.id;
      for (const [card, expected] of [
        [mine, false],
        [theirs, true],
      ] as const) {
        const screen = {
          ...SCREEN,
          markerControls: 'damage' as const,
          markerControlsCard: card,
        };
        for (const step of ['menu', 'counter']) {
          expect(
            stepOf('damage', step).done!(
              world({ view: now(), start, you, them, screen })
            ),
            `${step} ${String(expected)}`
          ).toBe(expected);
        }
      }
    }
  });

  it('takes a Pokémon whose card the room renamed for the one it was, and a Basic put on a card in the Active for the Active', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    // The room gives a card a new id when it turns face down, or an Undo
    // brings it back from a hidden zone: the Pokémon is still the one on
    // the Bench as the step began, not one benched.
    {
      const room = fakePracticeRoom();
      await dealScenario(
        room.session,
        lessonById('attach')!.scenario,
        new AbortController().signal
      );
      const start = room.session.getSnapshot().view!;
      const pidgey = start.boards[you]!.benchStackIds.map(
        (id) => start.stacks[id]!
      ).find((stack) => topOf(start, stack) === 'pidgey')!;
      const renamed = structuredClone(start) as typeof start & {
        stacks: Record<string, { evolutionCards: { id: string }[] }>;
      };
      renamed.stacks[pidgey.id]!.evolutionCards[0]!.id = 'renamed-pidgey';
      for (const [lesson, step] of [
        ['attach', 'bench'],
        ['keys', 'bench-key'],
      ] as const) {
        expect(
          lessonById(lesson)!.steps.find((entry) => entry.id === step)!.done!(
            world({ view: renamed, start, you, them })
          ),
          lesson
        ).toBe(false);
      }
    }
    // An Energy dropped in the Active Spot first, then Charmander on it:
    // the table shows Charmander there.
    {
      const room = fakePracticeRoom();
      await dealScenario(
        room.session,
        lessonById('start')!.scenario,
        new AbortController().signal
      );
      const now = () => room.session.getSnapshot().view!;
      const send = async (command: unknown) => {
        room.session.submit(command as never);
        await flush();
      };
      for (const key of ['charmander', 'fireEnergy'] as const) {
        const card = findCard(now(), zoneCards(now(), you, 'deck'), key)!;
        await send({
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: zoneId(you, 'deck'),
          destinationZoneId: zoneId(you, 'hand'),
        });
      }
      const start = now();
      const toActive = async (key: 'charmander' | 'fireEnergy') =>
        send({
          type: 'MoveCardToPlay',
          cardId: findCard(now(), zoneCards(now(), you, 'hand'), key)!.id,
          expectedSourceZoneId: zoneId(you, 'hand'),
          boardPlayerId: you,
          slot: 'active',
          ...(activeStack(now(), you)
            ? { targetStackId: activeStack(now(), you)!.id }
            : {}),
        });
      const active = lessonById('start')!.steps.find(
        (entry) => entry.id === 'active'
      )!;
      await toActive('fireEnergy');
      expect(active.done!(world({ view: now(), start, you, them }))).toBe(
        false
      );
      await toActive('charmander');
      expect(
        activeStack(now(), you)!.evolutionCards.map((card) =>
          tutorialCardKeyOf(now(), card)
        )
      ).toContain('charmander');
      expect(active.done!(world({ view: now(), start, you, them }))).toBe(true);
    }
  });

  it('starts a game with a Basic: says so with none, and points at one, whatever else is in play', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const room = fakePracticeRoom();
    await dealScenario(
      room.session,
      lessonById('start')!.scenario,
      new AbortController().signal
    );
    const now = () => room.session.getSnapshot().view!;
    const send = async (command: unknown) => {
      room.session.submit(command as never);
      await flush();
    };
    const draw = async (key: Parameters<typeof findCard>[2]) => {
      const card = findCard(now(), zoneCards(now(), you, 'deck'), key)!;
      await send({
        type: 'MoveCard',
        cardId: card.id,
        expectedSourceZoneId: zoneId(you, 'deck'),
        destinationZoneId: zoneId(you, 'hand'),
      });
    };
    const toPlay = (
      key: 'fireEnergy' | 'charmander',
      slot: 'active' | 'bench'
    ) =>
      send({
        type: 'MoveCardToPlay',
        cardId: findCard(now(), zoneCards(now(), you, 'hand'), key)!.id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        boardPlayerId: you,
        slot,
      });
    const active = lessonById('start')!.steps.find(
      (entry) => entry.id === 'active'
    )!;
    const at = () => world({ view: now(), start: now(), you, them });
    // A hand of Energy only: an Energy in the Active Spot is no Basic, and
    // the mulligan line stays.
    await draw('fireEnergy');
    await draw('fireEnergy');
    await draw('fireEnergy');
    await toPlay('fireEnergy', 'active');
    expect(active.done!(at())).toBe(false);
    expect(text({ text: active.stuck! }, at())).toContain('mulligan');
    // An Energy benched, then Charmander: the drag is Charmander's.
    await toPlay('fireEnergy', 'bench');
    await draw('charmander');
    await toPlay('charmander', 'bench');
    const charmander = benchStacks(now(), you).find(
      (stack) => topOf(now(), stack) === 'charmander'
    )!;
    expect(active.drag!(at())?.from).toEqual({
      card: topCard(charmander)!.id,
    });
    expect(active.stuck!(at())).toBeNull();
  });

  it('counts Set up pressed again, after Back, as set up', () => {
    const setup = lessonById('start')!.steps.find(
      (entry) => entry.id === 'setup'
    )!;
    // Back: the step starts from a table set up already.
    expect(setup.done!(world({ events: [] }))).toBe(false);
    expect(
      setup.done!(world({ events: [{ type: 'PlayerSetup', playerId: 'you' }] }))
    ).toBe(true);
    // The other side set up (flipped, or Set up again from More there):
    // not yours.
    expect(
      setup.done!(
        world({ events: [{ type: 'PlayerSetup', playerId: 'them' }] })
      )
    ).toBe(false);
  });

  it('says to press Set up, not to mulligan, once the hand is taken back', () => {
    const active = lessonById('start')!.steps.find(
      (entry) => entry.id === 'active'
    )!;
    // Nothing dealt: no hand, no Prize cards (an Undo of Set up, a Reset).
    const said = text({ text: active.stuck! }, world());
    expect(said).toContain('Press');
    expect(said).not.toContain('mulligan');
  });

  it('puts a Basic back in the Active before the Bench, as the step before does, and counts the Active sent to the hand then benched', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const room = fakePracticeRoom();
    await dealScenario(
      room.session,
      lessonById('start')!.scenario,
      new AbortController().signal
    );
    const now = () => room.session.getSnapshot().view!;
    const send = async (command: unknown) => {
      room.session.submit(command as never);
      await flush();
    };
    // A third Charmander kept in the hand: the step isn't done by the hand
    // running out of Basics.
    for (const key of [
      'charmander',
      'charmander',
      'charmander',
      'fireEnergy',
    ] as const) {
      const card = findCard(now(), zoneCards(now(), you, 'deck'), key)!;
      await send({
        type: 'MoveCard',
        cardId: card.id,
        expectedSourceZoneId: zoneId(you, 'deck'),
        destinationZoneId: zoneId(you, 'hand'),
      });
    }
    const toPlay = (cardId: string, slot: 'active' | 'bench') =>
      send({
        type: 'MoveCardToPlay',
        cardId,
        expectedSourceZoneId: zoneId(you, 'hand'),
        boardPlayerId: you,
        slot,
      });
    const charmanders = () =>
      zoneCards(now(), you, 'hand').filter(
        (card) => tutorialCardKeyOf(now(), card) === 'charmander'
      );
    const first = charmanders()[0]!;
    await toPlay(first.id, 'active');
    const bench = lessonById('start')!.steps.find(
      (entry) => entry.id === 'bench'
    )!;
    // The step begins; an Undo sends the Active back to the hand.
    const start = now();
    const active = activeStack(now(), you)!;
    await send({
      type: 'MovePlayStackToZone',
      stackId: active.id,
      expectedEvolutionCardIds: active.evolutionCards.map((card) => card.id),
      expectedAttachmentCardIds: active.attachmentCards.map((card) => card.id),
      destinationZoneId: zoneId(you, 'hand'),
    });
    const at = () => world({ view: now(), start, you, them });
    expect(bench.done!(at())).toBe(false);
    expect(bench.drag!(at())?.to).toEqual(
      expect.objectContaining({ zone: expect.stringContaining('active') })
    );
    // The other Charmander in the Active, the first benched from the hand:
    // benched.
    const second = charmanders().find((card) => card.id !== first.id)!;
    await toPlay(second.id, 'active');
    await toPlay(first.id, 'bench');
    expect(bench.done!(at())).toBe(true);
  });

  it('says what the step before says when the Active has gone and no Basic is in the hand', () => {
    const bench = lessonById('start')!.steps.find(
      (entry) => entry.id === 'bench'
    )!;
    // Dealt, no Basic anywhere: a mulligan, not "from your hand".
    const none = world({ view: handOf(['fireEnergy', 'charmeleon']) });
    expect(bench.done!(none)).toBe(false);
    expect(text({ text: () => bench.stuck!(none) })).toContain('mulligan');
    expect(bench.drag!(none)).toBeNull();
  });

  it('follows Charmander to the Bench for its Energy, and counts a Basic benched before Start asked', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const dealt = async (id: string) => {
      const room = fakePracticeRoom();
      await dealScenario(
        room.session,
        lessonById(id)!.scenario,
        new AbortController().signal
      );
      const now = () => room.session.getSnapshot().view!;
      const send = async (command: unknown) => {
        room.session.submit(command as never);
        await flush();
      };
      return { now, send };
    };
    // Attach: Pidgey swapped into the Active first, Charmander to the Bench.
    {
      const { now, send } = await dealt('attach');
      const board = now().boards[you]!;
      const pidgey = board.benchStackIds
        .map((id) => now().stacks[id]!)
        .find((stack) => topOf(now(), stack) === 'pidgey')!;
      await send({
        type: 'MovePlayStack',
        stackId: pidgey.id,
        expectedSourceBoardPlayerId: you,
        expectedSourceSlot: 'bench',
        expectedActiveStackId: board.activeStackId,
        expectedBenchStackIds: [...board.benchStackIds],
        destinationSlot: 'active',
        targetStackId: board.activeStackId,
      });
      expect(topOf(now(), activeStack(now(), you))).toBe('pidgey');
      const start = now();
      const energy = lessonById('attach')!.steps.find(
        (entry) => entry.id === 'energy'
      )!;
      const charmander = now()
        .boards[you]!.benchStackIds.map((id) => now().stacks[id]!)
        .find((stack) => topOf(now(), stack) === 'charmander')!;
      // The drag goes onto Charmander, on the Bench now.
      expect(
        energy.drag!(world({ view: now(), start, you, them }))?.to
      ).toEqual({ card: topCard(charmander)!.id });
      await send({
        type: 'MoveCardToPlay',
        cardId: findCard(now(), zoneCards(now(), you, 'hand'), 'fireEnergy')!
          .id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        boardPlayerId: you,
        slot: 'bench',
        targetStackId: charmander.id,
      });
      expect(energy.done!(world({ view: now(), start, you, them }))).toBe(true);
    }
    // Start: a Basic benched first, then another put in the Active.
    {
      const { now, send } = await dealt('start');
      for (const key of ['charmander', 'charmander', 'pidgey'] as const) {
        const card = findCard(now(), zoneCards(now(), you, 'deck'), key)!;
        await send({
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: zoneId(you, 'deck'),
          destinationZoneId: zoneId(you, 'hand'),
        });
      }
      const toPlay = (key: 'charmander', slot: 'active' | 'bench') =>
        send({
          type: 'MoveCardToPlay',
          cardId: findCard(now(), zoneCards(now(), you, 'hand'), key)!.id,
          expectedSourceZoneId: zoneId(you, 'hand'),
          boardPlayerId: you,
          slot,
        });
      await toPlay('charmander', 'bench');
      await toPlay('charmander', 'active');
      const bench = lessonById('start')!.steps.find(
        (entry) => entry.id === 'bench'
      )!;
      // The step begins over Active and Bench, a Pidgey still in the hand.
      expect(bench.done!(world({ view: now(), start: now(), you, them }))).toBe(
        true
      );
    }
  });

  it('says Charmander has left play, lights it for its menu, and takes a Basic benched early only while it stays', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const dealt = async (id: string) => {
      const room = fakePracticeRoom();
      await dealScenario(
        room.session,
        lessonById(id)!.scenario,
        new AbortController().signal
      );
      const now = () => room.session.getSnapshot().view!;
      const send = async (command: unknown) => {
        room.session.submit(command as never);
        await flush();
      };
      return { now, send };
    };
    // Attach: Charmander dragged to the discard pile.
    {
      const { now, send } = await dealt('attach');
      const start = now();
      const charmander = activeStack(now(), you)!;
      await send({
        type: 'MovePlayStackToZone',
        stackId: charmander.id,
        expectedEvolutionCardIds: charmander.evolutionCards.map(
          (card) => card.id
        ),
        expectedAttachmentCardIds: charmander.attachmentCards.map(
          (card) => card.id
        ),
        destinationZoneId: zoneId(you, 'discard'),
      });
      for (const step of ['energy', 'evolve']) {
        const lesson = lessonById('attach')!.steps.find(
          (entry) => entry.id === step
        )!;
        const at = world({ view: now(), start, you, them });
        expect(lesson.done!(at), step).toBe(false);
        expect(text({ text: lesson.stuck! }, at), step).toContain(
          'has left play'
        );
      }
    }
    // Look at cards: Pidgey swapped into the Active, Charmander still lit.
    {
      const { now, send } = await dealt('cards');
      const board = now().boards[you]!;
      const pidgey = board.benchStackIds
        .map((id) => now().stacks[id]!)
        .find((stack) => topOf(now(), stack) === 'pidgey')!;
      await send({
        type: 'MovePlayStack',
        stackId: pidgey.id,
        expectedSourceBoardPlayerId: you,
        expectedSourceSlot: 'bench',
        expectedActiveStackId: board.activeStackId,
        expectedBenchStackIds: [...board.benchStackIds],
        destinationSlot: 'active',
        targetStackId: board.activeStackId,
      });
      const menu = lessonById('cards')!.steps.find(
        (entry) => entry.id === 'menu'
      )!;
      const charmander = now()
        .boards[you]!.benchStackIds.map((id) => now().stacks[id]!)
        .find((stack) => topOf(now(), stack) === 'charmander')!;
      expect(
        menu.targets!(world({ view: now(), start: now(), you, them }))
      ).toEqual([{ card: topCard(charmander)!.id }]);
    }
    // Start: a Basic benched early, then taken off the Bench before the
    // Active is filled: not benched.
    {
      const { now, send } = await dealt('start');
      for (const key of ['charmander', 'charmander', 'pidgey'] as const) {
        const card = findCard(now(), zoneCards(now(), you, 'deck'), key)!;
        await send({
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: zoneId(you, 'deck'),
          destinationZoneId: zoneId(you, 'hand'),
        });
      }
      await send({
        type: 'MoveCardToPlay',
        cardId: findCard(now(), zoneCards(now(), you, 'hand'), 'charmander')!
          .id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        boardPlayerId: you,
        slot: 'bench',
      });
      const start = now();
      const benched = benchStacks(now(), you)[0]!;
      await send({
        type: 'MovePlayStackToZone',
        stackId: benched.id,
        expectedEvolutionCardIds: benched.evolutionCards.map((card) => card.id),
        expectedAttachmentCardIds: benched.attachmentCards.map(
          (card) => card.id
        ),
        destinationZoneId: zoneId(you, 'hand'),
      });
      await send({
        type: 'MoveCardToPlay',
        cardId: findCard(now(), zoneCards(now(), you, 'hand'), 'charmander')!
          .id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        boardPlayerId: you,
        slot: 'active',
      });
      const bench = lessonById('start')!.steps.find(
        (entry) => entry.id === 'bench'
      )!;
      expect(benchStacks(now(), you)).toHaveLength(0);
      expect(bench.done!(world({ view: now(), start, you, them }))).toBe(false);
    }
  });

  it('counts the Energy put on Charmander back in play, and says so at the menu step when it has left', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const dealt = async (id: string) => {
      const room = fakePracticeRoom();
      await dealScenario(
        room.session,
        lessonById(id)!.scenario,
        new AbortController().signal
      );
      const now = () => room.session.getSnapshot().view!;
      const send = async (command: unknown) => {
        room.session.submit(command as never);
        await flush();
      };
      const toHand = async () => {
        const charmander = [
          activeStack(now(), you),
          ...benchStacks(now(), you),
        ].find((stack) => topOf(now(), stack) === 'charmander')!;
        await send({
          type: 'MovePlayStackToZone',
          stackId: charmander.id,
          expectedEvolutionCardIds: charmander.evolutionCards.map(
            (card) => card.id
          ),
          expectedAttachmentCardIds: charmander.attachmentCards.map(
            (card) => card.id
          ),
          destinationZoneId: zoneId(you, 'hand'),
        });
      };
      return { now, send, toHand };
    };
    // Attach: Charmander (with its Energy) to the hand and back to the
    // Bench, a new Pokémon: one Energy put on it is the step done.
    {
      const { now, send, toHand } = await dealt('attach');
      const start = now();
      await toHand();
      await send({
        type: 'MoveCardToPlay',
        cardId: findCard(now(), zoneCards(now(), you, 'hand'), 'charmander')!
          .id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        boardPlayerId: you,
        slot: 'bench',
      });
      const charmander = [
        activeStack(now(), you),
        ...benchStacks(now(), you),
      ].find((stack) => topOf(now(), stack) === 'charmander')!;
      await send({
        type: 'MoveCardToPlay',
        cardId: findCard(now(), zoneCards(now(), you, 'hand'), 'fireEnergy')!
          .id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        boardPlayerId: you,
        slot: charmander.slot,
        targetStackId: charmander.id,
      });
      const energy = lessonById('attach')!.steps.find(
        (entry) => entry.id === 'energy'
      )!;
      expect(energy.done!(world({ view: now(), start, you, them }))).toBe(true);
    }
    // Look at cards: Charmander gone, the menu step says so.
    {
      const { now, toHand } = await dealt('cards');
      await toHand();
      const menu = lessonById('cards')!.steps.find(
        (entry) => entry.id === 'menu'
      )!;
      expect(
        text(
          { text: menu.stuck! },
          world({ view: now(), start: now(), you, them })
        )
      ).toContain('has left play');
    }
  });

  it('counts Energy on Charmander by its Pokémon: not a card the room renamed on an Undo, and Energy on it back from the discard', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const room = fakePracticeRoom();
    await dealScenario(
      room.session,
      lessonById('attach')!.scenario,
      new AbortController().signal
    );
    const now = () => room.session.getSnapshot().view!;
    const send = async (command: unknown) => {
      room.session.submit(command as never);
      await flush();
    };
    const energy = lessonById('attach')!.steps.find(
      (entry) => entry.id === 'energy'
    )!;
    const start = now();
    // An Undo gives the Energy already on Charmander a new id: still the
    // one it had.
    const charmander = activeStack(start, you)!;
    const renamed = structuredClone(start) as typeof start & {
      stacks: Record<string, { attachmentCards: { id: string }[] }>;
    };
    renamed.stacks[charmander.id]!.attachmentCards[0]!.id = 'renamed-energy';
    expect(energy.done!(world({ view: renamed, start, you, them }))).toBe(
      false
    );
    // Charmander to the discard with its Energy, back on the Bench from
    // there, and that Energy on it again: a new Pokémon, Energy on it.
    await send({
      type: 'MovePlayStackToZone',
      stackId: charmander.id,
      expectedEvolutionCardIds: charmander.evolutionCards.map(
        (card) => card.id
      ),
      expectedAttachmentCardIds: charmander.attachmentCards.map(
        (card) => card.id
      ),
      destinationZoneId: zoneId(you, 'discard'),
    });
    const fromDiscard = (key: 'charmander' | 'fireEnergy') =>
      findCard(now(), zoneCards(now(), you, 'discard'), key)!.id;
    await send({
      type: 'MoveCardToPlay',
      cardId: fromDiscard('charmander'),
      expectedSourceZoneId: zoneId(you, 'discard'),
      boardPlayerId: you,
      slot: 'bench',
    });
    const back = [activeStack(now(), you), ...benchStacks(now(), you)].find(
      (stack) => topOf(now(), stack) === 'charmander'
    )!;
    await send({
      type: 'MoveCardToPlay',
      cardId: fromDiscard('fireEnergy'),
      expectedSourceZoneId: zoneId(you, 'discard'),
      boardPlayerId: you,
      slot: back.slot,
      targetStackId: back.id,
    });
    expect(energy.done!(world({ view: now(), start, you, them }))).toBe(true);
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
    // Pidgey dropped anywhere but the Bench (the deal benches one already):
    // not benched.
    for (const destination of ['board', 'discard', 'deck']) {
      const { room, now } = await dealt('attach');
      const bench = lessonById('attach')!.steps.find(
        (step) => step.id === 'bench'
      )!;
      const start = now();
      const pidgey = findCard(now(), zoneCards(now(), you, 'hand'), 'pidgey')!;
      room.session.submit({
        type: 'MoveCard',
        cardId: pidgey.id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        destinationZoneId: zoneId(you, destination),
      } as never);
      await flush();
      expect(
        zoneCards(now(), you, 'hand').some((card) => card.id === pidgey.id),
        destination
      ).toBe(false);
      expect(
        bench.done!(world({ view: now(), start, you, them })),
        destination
      ).toBe(false);
    }
    // Back to the keys lesson's first step, Pidgey benched: done once more
    // after it goes back to the hand and is benched again.
    {
      const { room, now } = await dealt('keys');
      const benchKey = lessonById('keys')!.steps.find(
        (step) => step.id === 'bench-key'
      )!;
      const pidgey = findCard(now(), zoneCards(now(), you, 'hand'), 'pidgey')!;
      const toBench = () =>
        room.session.submit({
          type: 'MoveCardToPlay',
          cardId: pidgey.id,
          expectedSourceZoneId: zoneId(you, 'hand'),
          boardPlayerId: you,
          slot: 'bench',
        } as never);
      toBench();
      await flush();
      // Back: the step starts from now.
      const start = now();
      const at = () => world({ view: now(), start, you, them });
      expect(benchKey.done!(at())).toBe(true);
      const stack = now()
        .boards[you]!.benchStackIds.map((id) => now().stacks[id]!)
        .find((entry) =>
          entry.evolutionCards.some((card) => card.id === pidgey.id)
        )!;
      room.session.submit({
        type: 'MovePlayStackToZone',
        stackId: stack.id,
        expectedEvolutionCardIds: stack.evolutionCards.map((card) => card.id),
        expectedAttachmentCardIds: stack.attachmentCards.map((card) => card.id),
        destinationZoneId: zoneId(you, 'hand'),
      } as never);
      await flush();
      expect(benchKey.done!(at())).toBe(false);
      toBench();
      await flush();
      expect(benchKey.done!(at())).toBe(true);
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
