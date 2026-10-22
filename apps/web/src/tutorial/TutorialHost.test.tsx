// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preferences } from '../preferences/preference-store.js';
import { fakePracticeRoom, you } from './practice-room.test-support.js';
import { tutorialCardKeyOf } from './tutorial-cards.js';
import { zoneCards, zoneId } from './tutorial-world.js';
import { lessonById, lessonsFor } from './tutorial-lessons.js';
import { TUTORIAL_PREFERENCES } from './tutorial-state.js';
import { TutorialHost } from './TutorialHost.js';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Box = { x: number; y: number; width: number; height: number };

const domRect = ({ x, y, width, height }: Box): DOMRect =>
  ({
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  }) as DOMRect;

/** Lays out the given elements where a test puts them. */
const placed = new Map<Element, Box>();
const originalRect = Element.prototype.getBoundingClientRect;

const phone = (narrow: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow && /max-width: 599px|coarse/u.test(query),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
};

let root: Root | undefined;
let exits = 0;

let room = fakePracticeRoom();

const render = async (lesson?: string) => {
  room = fakePracticeRoom();
  let setFlipped: (flipped: boolean) => void = () => undefined;
  const Harness = () => {
    const [flipped, set] = useState(false);
    setFlipped = set;
    return (
      <TutorialHost
        room={room as never}
        {...(lesson ? { lesson } : {})}
        serial={1}
        flipped={flipped}
        flipBoard={() => set((current) => !current)}
        onExit={() => {
          exits += 1;
        }}
      />
    );
  };
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness />));
  return { flip: (flipped: boolean) => act(async () => setFlipped(flipped)) };
};

const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
const coach = () =>
  document.querySelector<HTMLElement>('.tutorial-coach[data-tutorial-step]');
const stepOf = () => coach()?.getAttribute('data-tutorial-step');
const button = (scope: Element | null, name: string) =>
  [...(scope?.querySelectorAll('button') ?? [])].find(
    (candidate) =>
      candidate.textContent === name ||
      candidate.getAttribute('aria-label') === name
  ) as HTMLButtonElement | undefined;

// happy-dom reports a cancelled animation's `finished` as an unhandled
// rejection (browsers don't, unobserved): the drag hand, which skips its
// animation without the API, goes without it here.
const originalAnimate = Element.prototype.animate;

beforeEach(() => {
  exits = 0;
  (Element.prototype as { animate?: unknown }).animate = undefined;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const box = placed.get(this);
    return box ? domRect(box) : originalRect.call(this);
  };
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  placed.clear();
  Element.prototype.getBoundingClientRect = originalRect;
  Element.prototype.animate = originalAnimate;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('the tutorial’s coach', () => {
  it('waits on a step Back went to until the table shows it again', async () => {
    phone(false);
    const table = await render('both-sides');
    await wait(1200);
    expect(stepOf()).toBe('both-sides:flip');
    await table.flip(true);
    await wait(900);
    expect(stepOf()).toBe('both-sides:their-turn');
    await act(async () => button(coach(), 'Back')!.click());
    await wait(900);
    // The table is still turned: Back stays where it went.
    expect(stepOf()).toBe('both-sides:flip');
    expect(coach()?.getAttribute('data-done')).toBeNull();
    // Turned back and round again, the step is done once more.
    await table.flip(false);
    await wait(50);
    await table.flip(true);
    await wait(900);
    expect(stepOf()).toBe('both-sides:their-turn');
  });

  it('stays in its corner through a step’s done moment', async () => {
    phone(false);
    // The Flip button sits where the coach would go first.
    const rail = document.createElement('div');
    rail.id = 'boardButtonContainer';
    const flip = document.createElement('button');
    flip.id = 'flipBoardButton';
    rail.append(flip);
    document.body.append(rail);
    placed.set(flip, { x: 0, y: 0, width: 400, height: 400 });
    const table = await render('both-sides');
    await wait(1200);
    expect(stepOf()).toBe('both-sides:flip');
    const corner = coach()?.getAttribute('data-corner');
    expect(corner).not.toBe('top-left');
    await table.flip(true);
    await wait(50);
    expect(coach()?.getAttribute('data-done')).toBe('true');
    expect(coach()?.getAttribute('data-corner')).toBe(corner);
  });

  it('keeps clear of the open command palette on a phone', async () => {
    phone(true);
    const bar = document.createElement('div');
    bar.className = 'ptcgsim-app-bar';
    const palette = document.createElement('div');
    palette.setAttribute('data-command-palette', '');
    document.body.append(bar, palette);
    placed.set(bar, { x: 236, y: 8, width: 146, height: 50 });
    placed.set(palette, { x: 8, y: 8, width: 374, height: 400 });
    await render('commands');
    await wait(1200);
    await wait(900);
    expect(stepOf()).toBe('commands:palette-draw');
    const top = Number.parseFloat(coach()!.style.top);
    // Below the palette's rows, not over its first one.
    expect(top).toBeGreaterThanOrEqual(408);
    expect(coach()?.getAttribute('data-corner')).toBe('bottom-left');
  });

  it('reads out the first step, and has the focus once a lesson starts', async () => {
    phone(false);
    await render();
    const list = document.querySelector('[data-tutorial-lessons]');
    const lesson = list!.querySelector<HTMLButtonElement>(
      '[data-lesson="both-sides"]'
    )!;
    lesson.focus();
    await act(async () => lesson.click());
    await wait(1200);
    expect(stepOf()).toBe('both-sides:flip');
    const status = document.querySelector('.ds-visually-hidden[role="status"]');
    expect(status?.textContent).toBe(coach()!.querySelector('p')!.textContent);
    expect(status?.textContent).not.toBe('');
    expect(document.activeElement).toBe(coach());
  });
});

describe('the coach, round two', () => {
  it('stays in its corner through the done moment of a drag step', async () => {
    phone(false);
    await render('attach');
    await wait(1200);
    expect(stepOf()).toBe('attach:energy');
    await act(async () => button(coach(), 'Skip')!.click());
    await act(async () => button(coach(), 'Skip')!.click());
    expect(stepOf()).toBe('attach:trainer');
    // The drag's ends in the top-left corner, where the coach goes first.
    const view = room.session.getSnapshot().view!;
    const research = zoneCards(view, you, 'hand').find(
      (card) => tutorialCardKeyOf(view, card) === 'research'
    )!;
    const card = document.createElement('div');
    card.className = 'ptcgsim-card';
    card.dataset.cardId = research.id;
    const mat = document.createElement('div');
    mat.className = 'ptcgsim-zone';
    mat.dataset.zoneId = zoneId(you, 'board');
    document.body.append(card, mat);
    placed.set(card, { x: 0, y: 0, width: 300, height: 300 });
    placed.set(mat, { x: 0, y: 0, width: 300, height: 300 });
    await wait(100);
    const before = coach()?.getAttribute('data-corner');
    expect(before).not.toBe('top-left');
    // Played: the card leaves the hand, and the step is done.
    await act(async () => {
      room.session.submit({
        type: 'MoveCard',
        cardId: research.id,
        expectedSourceZoneId: zoneId(you, 'hand'),
        destinationZoneId: zoneId(you, 'discard'),
      } as never);
    });
    card.remove();
    await wait(50);
    expect(coach()?.getAttribute('data-done')).toBe('true');
    expect(coach()?.getAttribute('data-corner')).toBe(before);
  });

  it('moves off the palette that opening ends a step with, in its done moment', async () => {
    phone(true);
    const bar = document.createElement('div');
    bar.className = 'ptcgsim-app-bar';
    document.body.append(bar);
    placed.set(bar, { x: 236, y: 8, width: 146, height: 50 });
    await render('commands');
    await wait(1200);
    expect(stepOf()).toBe('commands:palette');
    expect(Number.parseFloat(coach()!.style.top)).toBeLessThan(100);
    // Opening the palette is the step: it is done, and the coach is over
    // the palette's field unless it moves.
    const palette = document.createElement('div');
    palette.setAttribute('data-command-palette', '');
    placed.set(palette, { x: 8, y: 8, width: 374, height: 400 });
    await act(async () => document.body.append(palette));
    await wait(100);
    expect(coach()?.getAttribute('data-done')).toBe('true');
    expect(Number.parseFloat(coach()!.style.top)).toBeGreaterThanOrEqual(408);
  });

  it('keeps the focus when Back goes to the first step', async () => {
    phone(false);
    await render('cards');
    await wait(1200);
    expect(stepOf()).toBe('cards:read');
    await act(async () => button(coach(), 'Skip')!.click());
    const back = button(coach(), 'Back')!;
    back.focus();
    await act(async () => back.click());
    expect(stepOf()).toBe('cards:read');
    expect(document.activeElement).toBe(coach());
  });

  it('says the tutorial is complete whichever lesson finishes it', async () => {
    phone(false);
    const completed: Record<string, number> = {};
    for (const lesson of lessonsFor('mouse')) {
      if (lesson.id !== 'both-sides') completed[lesson.id] = lesson.version;
    }
    preferences().patch(TUTORIAL_PREFERENCES, { completed });
    await render('both-sides');
    await wait(1200);
    for (
      let step = 0;
      step < 6 && !document.querySelector('[data-tutorial-done]');
      step += 1
    ) {
      const next =
        button(coach(), 'Skip') ??
        button(coach(), 'Next') ??
        button(coach(), 'Done');
      await act(async () => next?.click());
      // A step the table already shows ticks done a moment first.
      await wait(700);
    }
    const done = document.querySelector('[data-tutorial-done]');
    expect(done?.querySelector('#tutorialDoneTitle')?.textContent).toContain(
      'Tutorial complete'
    );
    expect([...done!.querySelectorAll('button')].at(-1)?.textContent).toBe(
      'Back to my table'
    );
    preferences().patch(TUTORIAL_PREFERENCES, { completed: {} });
  });

  it('steps the lesson list aside while the practice table is down', async () => {
    phone(false);
    await render();
    expect(document.querySelector('[data-tutorial-lessons]')).not.toBeNull();
    await act(async () => room.setPhase('failed'));
    await wait(50);
    expect(document.querySelector('[data-tutorial-lessons]')).toBeNull();
    await act(async () => room.setPhase('ready'));
    await wait(50);
    expect(document.querySelector('[data-tutorial-lessons]')).not.toBeNull();
  });
});

describe('a step done', () => {
  it('counts what the player does in its done moment toward the next step', async () => {
    phone(false);
    await render('deck');
    await wait(1200);
    expect(stepOf()).toBe('deck:draw');
    await act(async () => button(coach(), 'Skip')!.click());
    expect(stepOf()).toBe('deck:search');
    // The deck opens: the step is done...
    const pile = document.createElement('div');
    pile.dataset.legacyZoneBrowser = 'true';
    pile.dataset.zoneBrowserKind = 'deck';
    await act(async () => document.body.append(pile));
    await wait(50);
    expect(coach()?.getAttribute('data-done')).toBe('true');
    // ...and Rare Candy goes to the hand before the next step shows.
    const view = room.session.getSnapshot().view!;
    const candy = zoneCards(view, you, 'deck').find(
      (card) => tutorialCardKeyOf(view, card) === 'rareCandy'
    )!;
    await act(async () => {
      room.session.submit({
        type: 'MoveCard',
        cardId: candy.id,
        expectedSourceZoneId: zoneId(you, 'deck'),
        destinationZoneId: zoneId(you, 'hand'),
      } as never);
    });
    // Taking it was the next step: it is done too, and the lesson goes on.
    for (let tries = 0; tries < 30 && stepOf() !== 'deck:shuffle'; tries += 1) {
      await wait(100);
    }
    expect(stepOf()).toBe('deck:shuffle');
  });
});

describe('the tutorial’s cards', () => {
  it('step aside for the command palette, and come back after', async () => {
    phone(false);
    await render();
    const list = () => document.querySelector('[data-tutorial-lessons]');
    expect(list()).not.toBeNull();
    const palette = document.createElement('div');
    palette.setAttribute('data-command-palette', '');
    await act(async () => document.body.append(palette));
    await wait(50);
    expect(list()).toBeNull();
    await act(async () => palette.remove());
    await wait(50);
    expect(list()).not.toBeNull();
  });

  it('put a lesson’s done card below the app bar where they would meet', async () => {
    phone(true);
    const bar = document.createElement('div');
    bar.className = 'ptcgsim-app-bar';
    document.body.append(bar);
    placed.set(bar, { x: 200, y: 8, width: 400, height: 50 });
    await render('around');
    await wait(1200);
    for (let step = 0; step < 5; step += 1) {
      const next = button(coach(), 'Next') ?? button(coach(), 'Done');
      await act(async () => next!.click());
    }
    const done = document.querySelector<HTMLElement>('[data-tutorial-done]');
    expect(done).not.toBeNull();
    expect(Number.parseFloat(done!.style.top)).toBeGreaterThanOrEqual(58);
    // And it can be left from there.
    await act(async () => button(done, 'Leave tutorial')!.click());
    expect(exits).toBe(1);
  });

  it('keep a finished lesson as done, written outside any render', async () => {
    phone(false);
    const errors = vi.spyOn(console, 'error');
    await render('around');
    await wait(1200);
    for (let step = 0; step < 5; step += 1) {
      const next = button(coach(), 'Next') ?? button(coach(), 'Done');
      await act(async () => next!.click());
    }
    expect(document.querySelector('[data-tutorial-done]')).not.toBeNull();
    expect(preferences().get(TUTORIAL_PREFERENCES).completed.around).toBe(
      lessonById('around')!.version
    );
    expect(
      errors.mock.calls.filter((call) =>
        String(call[0]).includes('Cannot update a component')
      )
    ).toEqual([]);
  });

  it('offer a way out while a lesson is dealt', async () => {
    phone(false);
    await render('both-sides');
    const dealing = document.querySelector('[data-tutorial-dealing]');
    expect(dealing).not.toBeNull();
    await act(async () => button(dealing, 'Leave tutorial')!.click());
    expect(exits).toBe(1);
  });
});
