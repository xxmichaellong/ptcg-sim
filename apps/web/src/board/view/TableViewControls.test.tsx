// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_TABLE_DEPTH,
  depthSettings,
} from '../../motion/depth-settings.js';
import { TableViewControls } from './TableViewControls.js';
import {
  boardViewSettings,
  DEFAULT_BOARD_VIEW,
} from './board-view-settings.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const render = async (solo = true): Promise<void> => {
  await act(async () => root.render(<TableViewControls solo={solo} />));
};

const input = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;

const choose = async (id: string): Promise<void> => {
  await act(async () => input(id).click());
};

const slide = async (id: string, value: string): Promise<void> => {
  const range = input(id);
  // React tracks the value it last set; go around it like a real drag does.
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!.call(range, value);
  await act(async () => {
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  boardViewSettings().reset();
  depthSettings().update(DEFAULT_TABLE_DEPTH);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  boardViewSettings().reset();
  depthSettings().update(DEFAULT_TABLE_DEPTH);
});

describe('TableViewControls', () => {
  it('applies each choice as it is made', async () => {
    await render();
    await choose('boardShowMine');
    expect(boardViewSettings().getSnapshot().show).toBe('mine');
    // With one half showing there is nothing to split.
    expect(input('boardSplitRange').disabled).toBe(true);
    await choose('boardShowBoth');
    expect(input('boardSplitRange').disabled).toBe(false);
    await slide('boardSplitRange', '60');
    expect(boardViewSettings().getSnapshot().split).toBe(0.6);
    expect(host.textContent).toContain('Theirs 40% · Mine 60%');

    // Auto, the default, is a tabletop where there is room: its angle shows.
    expect(depthSettings().getSnapshot().mode).toBe('auto');
    expect(host.querySelector('#tableTiltRange')).not.toBeNull();
    await choose('tableViewFlat');
    expect(host.querySelector('#tableTiltRange')).toBeNull();
    await choose('tableViewTable');
    expect(depthSettings().getSnapshot().mode).toBe('table');
    await slide('tableTiltRange', '14');
    expect(depthSettings().getSnapshot().tilt).toBe(14);
    await act(async () => input('tableLiftCheckbox').click());
    expect(depthSettings().getSnapshot().lift).toBe(false);

    await act(async () => input('zoneOutlinesCheckbox').click());
    await act(async () => input('hideHandCheckbox').click());
    await act(async () => input('hoverPreviewCheckbox').click());
    await act(async () => input('lostZoneCheckbox').click());
    await act(async () => input('opponentUprightCheckbox').click());
    expect(boardViewSettings().getSnapshot()).toMatchObject({
      zoneOutlines: false,
      hideOpponentHand: true,
      hoverPreview: true,
      lostZone: 'shown',
      opponentCardsUpright: true,
    });

    await act(async () =>
      host.querySelector<HTMLButtonElement>('#boardViewResetButton')!.click()
    );
    expect(boardViewSettings().getSnapshot()).toEqual(DEFAULT_BOARD_VIEW);
    expect(depthSettings().getSnapshot()).toEqual(DEFAULT_TABLE_DEPTH);
  });

  it("offers to cover the opponent's hand only in Solo", async () => {
    await render(false);
    expect(host.querySelector('#hideHandCheckbox')).toBeNull();
    expect(host.querySelector('#zoneOutlinesCheckbox')).not.toBeNull();
  });
});
