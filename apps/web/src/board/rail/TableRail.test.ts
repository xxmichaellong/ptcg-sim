// @vitest-environment happy-dom

import { CoinIcon } from '@phosphor-icons/react/dist/csr/Coin';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ActionMenuEntry } from '../../ui/ActionMenu.js';
import {
  fitRailActions,
  railButtonPx,
  placeRailActions,
  type RailAction,
  TableRail,
  type TableRailProps,
} from './TableRail.js';

const action = (
  id: string,
  priority?: number,
  extra: Partial<RailAction> = {}
): RailAction => ({
  id,
  label: id,
  icon: CoinIcon,
  onSelect: vi.fn(),
  ...(priority === undefined ? {} : { priority }),
  ...extra,
});

const ids = (entries: readonly ActionMenuEntry[]): (string | undefined)[] =>
  entries.map((entry) =>
    entry.kind === 'separator'
      ? '--'
      : entry.kind === 'label'
        ? entry.label
        : entry.id
  );

describe("the rail's room in the seam", () => {
  it('keeps clear room above and below its buttons where the seam has it', () => {
    // A mouse's seam (40px): 32px buttons, 4px clear either side.
    expect(railButtonPx(40)).toBe(32);
    // A finger's (52px): the 44px targets, with the same room.
    expect(railButtonPx(52)).toBe(44);
    // A tight seam gives up the room before the buttons go below 28px.
    expect(railButtonPx(32)).toBe(28);
    expect(railButtonPx(24)).toBe(24);
  });
});

describe('fitting the rail', () => {
  it('keeps every action when they fit as icons', () => {
    const actions = [action('turn'), action('coin'), action('undo')];
    const fitted = fitRailActions(actions, undefined, 3 * 46 + 2 * 10, 46);
    expect(fitted.shown).toBe(actions);
    expect(fitted.more).toEqual([]);
  });

  it('moves the least important into More, keeping the rest in order', () => {
    const actions = [
      action('turn', 1),
      action('attack', 4),
      action('pass', 5),
      action('coin', 2),
      action('undo', 3),
      action('switch', 6, { title: 'Flip the table' }),
    ];
    const reset: ActionMenuEntry = {
      id: 'reset',
      label: 'Reset',
      onSelect: vi.fn(),
    };
    // Room for four buttons: three actions and More.
    const fitted = fitRailActions(actions, [reset], 4 * 46 + 3 * 10, 46);
    expect(fitted.shown.map((shown) => shown.id)).toEqual([
      'turn',
      'coin',
      'undo',
    ]);
    expect(ids(fitted.more)).toEqual([
      'attack',
      'pass',
      'switch',
      '--',
      'reset',
    ]);
    // A moved action keeps its full name and what it does.
    const moved = fitted.more[2];
    expect(
      moved?.kind !== 'separator' && moved?.kind !== 'label' && moved?.label
    ).toBe('Flip the table');
  });

  it('keeps an action with nothing to do now dimmed, in More too', () => {
    const actions = [
      action('turn', 1),
      action('undo', 3, { disabled: true }),
      action('pass', 5),
    ];
    // Room for two buttons: Turn and More.
    const fitted = fitRailActions(actions, undefined, 2 * 46 + 10, 46);
    expect(fitted.shown.map((shown) => shown.id)).toEqual(['turn']);
    expect(fitted.more).toEqual([
      expect.objectContaining({ id: 'undo', disabled: true }),
      expect.not.objectContaining({ disabled: true }),
    ]);
  });

  it('falls back to positions when no priorities are given', () => {
    const actions = [action('a'), action('b'), action('c')];
    const fitted = fitRailActions(actions, undefined, 2 * 46 + 10, 46);
    expect(fitted.shown.map((shown) => shown.id)).toEqual(['a']);
    expect(ids(fitted.more)).toEqual(['b', 'c']);
  });

  it('puts one or two rarer actions on the rail instead of a menu for them', () => {
    const actions = [action('turn'), action('coin')];
    const both: ActionMenuEntry[] = [
      {
        id: 'setupBothButton',
        label: 'Set up both sides',
        icon: CoinIcon,
        onSelect: vi.fn(),
      },
      {
        id: 'resetBothButton',
        label: 'Reset both sides',
        icon: CoinIcon,
        onSelect: vi.fn(),
      },
    ];
    const roomy = fitRailActions(actions, both, 6 * 46 + 5 * 10, 46);
    expect(roomy.shown.map((shown) => shown.id)).toEqual([
      'turn',
      'coin',
      'setupBothButton',
      'resetBothButton',
    ]);
    expect(roomy.shown[2]?.title).toBe('Set up both sides');
    expect(roomy.more).toEqual([]);
    // Three or more stay a menu.
    const three = fitRailActions(
      actions,
      [
        ...both,
        { id: 'reset', label: 'Reset', icon: CoinIcon, onSelect: vi.fn() },
      ],
      9 * 46 + 8 * 10,
      46
    );
    expect(three.shown.map((shown) => shown.id)).toEqual(['turn', 'coin']);
    expect(ids(three.more)).toEqual([
      'setupBothButton',
      'resetBothButton',
      'reset',
    ]);
    // Short of room, they are the first back into More.
    const short = fitRailActions(actions, both, 3 * 46 + 2 * 10, 46);
    expect(short.shown.map((shown) => shown.id)).toEqual(['turn', 'coin']);
    expect(ids(short.more)).toEqual(['setupBothButton', 'resetBothButton']);
  });
});

describe('placing the rail', () => {
  const playing = [1, 2, 3, 4, 5, 6].map((n) => action(`a${String(n)}`, n));
  const rarer: ActionMenuEntry[] = ['x', 'y', 'z'].map((id) => ({
    id,
    label: id,
    onSelect: vi.fn(),
  }));
  const shown = (markup: string): number =>
    markup.match(/class="ptcgsim-rail-button[ "]/gu)?.length ?? 0;
  const render = (props: Partial<TableRailProps>): string =>
    renderToStaticMarkup(
      createElement(TableRail, {
        anchor: { x: 8, y: 40, height: 36 },
        width: 1000,
        avoid: { x: 500, y: 0, width: 200, height: 100 },
        actions: playing,
        more: rarer,
        ...props,
      })
    );

  it('goes past the Stadium when every action fits there', () => {
    const markup = render({ width: 1400 });
    expect(markup).toContain('data-align="end"');
    // Six actions and More.
    expect(shown(markup)).toBe(7);
  });

  it('stays before the Stadium where past it would hide actions that fit before it', () => {
    // Room past the Stadium for five buttons, before it for eleven.
    const markup = render({ end: 920 });
    expect(markup).toContain('data-align="start"');
    expect(shown(markup)).toBe(7);
  });

  it('keeps its side as the game moves on, whatever the stage shows', () => {
    // Room past the Stadium for five buttons, before it for eleven: set-up's
    // one action would fit past it, but a turn's would not.
    const setUp = render({
      end: 920,
      actions: [action('setup')],
      more: [{ id: 'reset', label: 'reset', onSelect: vi.fn() }],
    });
    expect(setUp).toContain('data-align="start"');
    expect(render({ end: 920 })).toContain('data-align="start"');
  });

  it('starts before the Stadium past what sits at the seam’s left', () => {
    const markup = render({ end: 920, start: 120 });
    expect(markup).toContain('data-align="start"');
    expect(markup).toMatch(/left:\s*120px/u);
  });

  it('starts past what sits at the seam’s left with no Stadium in its row', () => {
    // One half shown: the Stadium lies in the Active's row, not the seam's,
    // and the near half's + sits at the seam's left end.
    const markup = render({
      width: 400,
      avoid: { x: 150, y: 120, width: 100, height: 60 },
      start: 120,
    });
    expect(markup).toMatch(/left:\s*120px/u);
  });

  it('goes past the Stadium in a room whose table can’t be turned, where its turn fits there', () => {
    // Room past the Stadium for five buttons: Turn, Attack, Pass, Undo and
    // More, the coin on the table; Solo's Switch side would be a sixth.
    const turn = { end: 920, coinOnTable: true, actions: playing.slice(0, 4) };
    expect(render(turn)).toContain('data-align="start"');
    const room = render({ ...turn, canSwitchSide: false });
    expect(room).toContain('data-align="end"');
    expect(shown(room)).toBe(5);
  });

  it('crosses the Stadium at most once while the table slides, where more of it shows, and chooses again once there', async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const draw = (props: Partial<TableRailProps>) =>
      act(async () =>
        root.render(
          createElement(TableRail, {
            anchor: { x: 8, y: 40, height: 36 },
            width: 1400,
            avoid: { x: 500, y: 0, width: 200, height: 100 },
            actions: playing,
            more: rarer,
            ...props,
          })
        )
      );
    const rail = () => host.querySelector('#boardButtonContainer')!;
    const align = () => rail().getAttribute('data-align');
    const setUp = {
      actions: [action('setup')],
      more: [{ id: 'reset', label: 'reset', onSelect: vi.fn() }],
    };
    // Set-up's buttons all show past the Stadium mid-slide: they stay.
    await draw(setUp);
    expect(align()).toBe('end');
    await draw({ ...setUp, end: 920, holdSide: true });
    expect(align()).toBe('end');
    await draw({});
    expect(align()).toBe('end');
    // A turn's would go behind More there: it moves, once.
    await draw({ end: 920, holdSide: true });
    expect(align()).toBe('start');
    expect(shown(rail().outerHTML)).toBe(7);
    await draw({ holdSide: true });
    expect(align()).toBe('start');
    await draw({ end: 920, holdSide: true });
    expect(align()).toBe('start');
    // Settled, it chooses again.
    await draw({});
    expect(align()).toBe('end');
    await act(async () => root.unmount());
    host.remove();
  });

  it('goes past the Stadium where before it has even less room, never over it', () => {
    // A 320px phone's tilted table: the Stadium near the seam's left end,
    // room past it for two buttons and before it for none.
    const placed = placeRailActions({
      anchor: { x: 8, y: 311, height: 44 },
      width: 320,
      avoid: { x: 43, y: 303, width: 46, height: 57 },
      end: 200,
      actions: playing,
      more: rarer,
    });
    expect(placed.atRight).toBe(true);
    expect(placed.start).toBeGreaterThanOrEqual(43 + 46);
  });

  it('stays before a Stadium at the right edge', () => {
    const markup = render({
      width: 400,
      avoid: { x: 300, y: 0, width: 100, height: 100 },
    });
    expect(markup).toContain('data-align="start"');
  });
});
