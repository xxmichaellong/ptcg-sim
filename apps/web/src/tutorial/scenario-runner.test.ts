import type { MatchViewState } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  fakePracticeRoom as fakeRoom,
  them,
  you,
} from './practice-room.test-support.js';
import { dealScenario, ScenarioError } from './scenario-runner.js';
import { tutorialCardKeyOf } from './tutorial-cards.js';
import { MIDGAME_SCENARIO, START_SCENARIO } from './tutorial-scenarios.js';
import {
  activeStack,
  benchStacks,
  topCard,
  zoneCards,
} from './tutorial-world.js';

const names = (view: MatchViewState, cards: ReturnType<typeof zoneCards>) =>
  cards.map((card) => tutorialCardKeyOf(view, card));

describe('dealing a lesson onto the practice table', () => {
  it('lays out the mid-game position with the room’s own commands', async () => {
    const room = fakeRoom();
    await dealScenario(
      room.session,
      MIDGAME_SCENARIO,
      new AbortController().signal
    );
    const view = room.session.getSnapshot().view!;
    // Your side: the hand, six face-down Prizes, Charmander Active with its
    // Energy, Pidgey Benched, the discard, and the deck's top card known.
    expect(names(view, zoneCards(view, you, 'hand')).sort()).toEqual(
      [
        'charmeleon',
        'fireEnergy',
        'fireEnergy',
        'pidgey',
        'research',
        'ultraBall',
      ].sort()
    );
    expect(zoneCards(view, you, 'prizes')).toHaveLength(6);
    const active = activeStack(view, you)!;
    expect(tutorialCardKeyOf(view, topCard(active))).toBe('charmander');
    expect(names(view, active.attachmentCards)).toEqual(['fireEnergy']);
    expect(
      benchStacks(view, you).map((stack) =>
        tutorialCardKeyOf(view, topCard(stack))
      )
    ).toEqual(['pidgey']);
    expect(names(view, zoneCards(view, you, 'discard'))).toEqual(['ultraBall']);
    expect(tutorialCardKeyOf(view, zoneCards(view, you, 'deck')[0])).toBe(
      'charizardEx'
    );
    expect(zoneCards(view, you, 'deck')).toHaveLength(44);
    // Theirs: Kirlia evolved from Ralts with an Energy, two Ralts Benched.
    const theirs = activeStack(view, them)!;
    expect(names(view, theirs.evolutionCards)).toEqual(['ralts', 'kirlia']);
    expect(names(view, theirs.attachmentCards)).toEqual(['psychicEnergy']);
    expect(benchStacks(view, them)).toHaveLength(2);
    expect(zoneCards(view, them, 'prizes')).toHaveLength(6);
    expect(zoneCards(view, them, 'hand')).toHaveLength(5);
    // Every move is one play makes; nothing else is sent.
    expect(new Set(room.sent.map((command) => command.type))).toEqual(
      new Set([
        'LoadDeck',
        'DrawCards',
        'MoveCard',
        'MoveCardToPlay',
        'PlaceCardOnPlayStack',
      ])
    );
  });

  it('leaves the first lesson’s deck loaded and not set up', async () => {
    const room = fakeRoom();
    await dealScenario(
      room.session,
      START_SCENARIO,
      new AbortController().signal
    );
    const view = room.session.getSnapshot().view!;
    expect(zoneCards(view, you, 'deck')).toHaveLength(60);
    expect(zoneCards(view, you, 'hand')).toHaveLength(0);
    expect(activeStack(view, them)).toBeDefined();
  });

  it('deals again over a table already played on', async () => {
    const room = fakeRoom();
    const signal = new AbortController().signal;
    await dealScenario(room.session, MIDGAME_SCENARIO, signal);
    await dealScenario(room.session, MIDGAME_SCENARIO, signal);
    const view = room.session.getSnapshot().view!;
    expect(zoneCards(view, you, 'hand')).toHaveLength(6);
    expect(Object.keys(room.match().stacks)).toHaveLength(5);
  });

  it('gives up when the room refuses a move, or the deal is stopped', async () => {
    await expect(
      dealScenario(
        fakeRoom({ refuse: 'DrawCards' }).session,
        MIDGAME_SCENARIO,
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(ScenarioError);
    const abort = new AbortController();
    const dealing = dealScenario(
      fakeRoom().session,
      MIDGAME_SCENARIO,
      abort.signal
    );
    abort.abort();
    await expect(dealing).rejects.toBeInstanceOf(ScenarioError);
  });
});
