// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preferences } from '../preferences/preference-store.js';
import { fakePracticeRoom } from './practice-room.test-support.js';
import { lessonById } from './tutorial-lessons.js';
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

const render = async (lesson?: string) => {
  const room = fakePracticeRoom();
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

beforeEach(() => {
  exits = 0;
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
