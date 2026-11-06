// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The loading screen's bar is paced by an inline script in index.html,
 * which runs before any of the app's code (table-curtain.ts). These run
 * that script as the page does, on a clock and marks of their own.
 */

// Paths, not URLs: happy-dom puts its own URL in place of Node's.
const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(here, '../../../index.html'), 'utf8');
const tableArtCss = readFileSync(
  resolve(here, '../../design/table-art.css'),
  'utf8'
);
const progressScript = (() => {
  const match = /<script id="tableCurtainProgress">([\s\S]*?)<\/script>/u.exec(
    indexHtml
  );
  if (!match?.[1]) throw new Error('index.html has no progress script');
  return match[1];
})();

let nowMs = 0;
const marks = new Map<string, number>();

const mount = () => {
  document.body.innerHTML = `
    <div id="tableCurtain" data-state="covering" data-mode="boot">
      <div id="tableCurtainBar" role="progressbar" aria-valuenow="0"></div>
    </div>`;
  // As the page runs it: a classic script, at once.
  new Function(progressScript)();
  const curtain = document.getElementById('tableCurtain')!;
  const bar = document.getElementById('tableCurtainBar')!;
  return {
    curtain,
    percent: () => Number(bar.getAttribute('aria-valuenow')),
    aimed: () =>
      Number(curtain.style.getPropertyValue('--table-curtain-progress')),
  };
};

/** Lets `ms` of the page's life pass, a tick of the bar at a time. */
const pass = (ms: number) => {
  for (let step = 0; step < ms; step += 250) {
    nowMs += 250;
    vi.advanceTimersByTime(250);
  }
};

describe("the loading screen's bar", () => {
  beforeEach(() => {
    nowMs = 0;
    marks.clear();
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    vi.spyOn(performance, 'getEntriesByName').mockImplementation(
      (name: string) => {
        const at = marks.get(name);
        return (at === undefined
          ? []
          : [{ startTime: at }]) as unknown as PerformanceEntryList;
      }
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('moves on from the first frame toward its ceiling, never reaching it, and keeps moving on a slow load', () => {
    const bar = mount();
    const seen: number[] = [];
    const aimed: number[] = [];
    for (let second = 0; second < 30; second += 1) {
      pass(1000);
      seen.push(bar.percent());
      aimed.push(bar.aimed());
    }
    // Never back, and never full before the table is there.
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1]!);
    }
    expect(Math.max(...seen)).toBeLessThan(97);
    // A typical load is well on its way by its median...
    expect(seen[2]).toBeGreaterThan(35);
    expect(seen[2]).toBeLessThan(85);
    // ...and a slow one still moves, if by less than a whole percent.
    expect(aimed[29]).toBeGreaterThan(aimed[19]!);
    expect(aimed[29]).toBeLessThan(0.97);
    // Each tick aims the bar a second ahead of where it is.
    expect(bar.aimed() * 100).toBeGreaterThan(bar.percent());
  });

  it('goes faster once the app says the room is connected', () => {
    const plain = mount();
    pass(1500);
    const without = plain.percent();
    document.body.replaceChildren();

    nowMs = 0;
    const marked = mount();
    pass(1000);
    marks.set('ptcgsim:load:app', 300);
    marks.set('ptcgsim:load:lobby', 600);
    marks.set('ptcgsim:load:room', 1000);
    pass(500);
    expect(marked.percent()).toBeGreaterThan(without);
  });

  it('stops once the table is there, or the curtain is a trade of tables', () => {
    const done = mount();
    pass(1000);
    done.curtain.dataset.complete = '';
    done.curtain.style.setProperty('--table-curtain-progress', '1');
    const at = done.percent();
    pass(2000);
    expect(done.percent()).toBe(at);
    expect(done.aimed()).toBe(1);

    document.body.replaceChildren();
    const traded = mount();
    pass(500);
    traded.curtain.dataset.mode = 'travel';
    const before = traded.percent();
    pass(2000);
    expect(traded.percent()).toBe(before);
  });
});

describe('the loading screen before the app’s styles', () => {
  /** Each artwork's desk colors, by name, from a stylesheet's rules. */
  const desks = (css: string, selector: (art: string) => string) => {
    const found = new Map<string, Record<string, string>>();
    const rule = new RegExp(`${selector('([a-z]+)')}[^{]*\\{([^}]*)\\}`, 'gu');
    for (const [, art, body] of css.matchAll(rule)) {
      const values: Record<string, string> = {};
      for (const [, name, value] of body!.matchAll(
        /--([a-z-]+):\s*([^;]+);/gu
      )) {
        values[name!] = value!.trim();
      }
      found.set(art!, values);
    }
    return found;
  };

  it('opens on each artwork’s own desk, as table-art.css paints it', () => {
    const art = desks(
      tableArtCss,
      (name) => `:root\\[data-table-art='${name}'\\]`
    );
    const curtain = desks(
      indexHtml,
      (name) => `:root\\[data-table-art='${name}'\\] #tableCurtain`
    );
    // Cream is the curtain's own default.
    const cream = /#tableCurtain \{([^}]*)\}/u.exec(indexHtml)![1]!;
    curtain.set('cream', {
      'curtain-desk': /--curtain-desk: ([^;]+);/u.exec(cream)![1]!,
      'curtain-desk-hi': /--curtain-desk-hi: ([^;]+);/u.exec(cream)![1]!,
      'curtain-shade': /--curtain-shade: ([^;]+);/u.exec(cream)![1]!,
      'curtain-ink': /--curtain-ink: ([^;]+);/u.exec(cream)![1]!,
    });
    expect([...curtain.keys()].sort()).toEqual([...art.keys()].sort());
    for (const [name, values] of art) {
      const shown = curtain.get(name)!;
      expect(shown, name).toEqual({
        'curtain-desk': `var(--color-desk, ${values['color-desk']})`,
        'curtain-desk-hi': `var(--color-desk-hi, ${values['color-desk-hi']})`,
        'curtain-shade': `var(--color-desk-vignette, ${values['color-desk-vignette']})`,
        'curtain-ink': `var(--color-desk-ink, ${values['color-desk-ink']})`,
      });
    }
  });
});
