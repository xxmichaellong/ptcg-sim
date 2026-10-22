import { CoinIcon } from '@phosphor-icons/react/dist/csr/Coin';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ActionMenuEntry } from '../../ui/ActionMenu.js';
import {
  fitRailActions,
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

describe('fitting the rail', () => {
  it('keeps every action when they fit as icons', () => {
    const actions = [action('turn'), action('coin'), action('undo')];
    const fitted = fitRailActions(actions, undefined, 3 * 46 + 2 * 6, 46);
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
    const fitted = fitRailActions(actions, [reset], 4 * 46 + 3 * 6, 46);
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

  it('falls back to positions when no priorities are given', () => {
    const actions = [action('a'), action('b'), action('c')];
    const fitted = fitRailActions(actions, undefined, 2 * 46 + 6, 46);
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
    const roomy = fitRailActions(actions, both, 6 * 46 + 5 * 6, 46);
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
      9 * 46 + 8 * 6,
      46
    );
    expect(three.shown.map((shown) => shown.id)).toEqual(['turn', 'coin']);
    expect(ids(three.more)).toEqual([
      'setupBothButton',
      'resetBothButton',
      'reset',
    ]);
    // Short of room, they are the first back into More.
    const short = fitRailActions(actions, both, 3 * 46 + 2 * 6, 46);
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

  it('stays before a Stadium at the right edge', () => {
    const markup = render({
      width: 400,
      avoid: { x: 300, y: 0, width: 100, height: 100 },
    });
    expect(markup).toContain('data-align="start"');
  });
});
