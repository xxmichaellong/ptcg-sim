// @vitest-environment happy-dom

import { DEFAULT_BOARD_DEPTH } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { depthSettings } from '../../motion/depth-settings.js';
import { isOverlayKeyTarget } from '../../ui/overlay-surface.js';
import { BoardViewPanel } from './BoardViewPanel.js';
import {
  boardViewSettings,
  DEFAULT_BOARD_VIEW,
} from './board-view-settings.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let trigger: HTMLButtonElement;

const render = async (
  open: boolean,
  onClose: () => void = vi.fn(),
  solo = true
): Promise<void> => {
  await act(async () =>
    root.render(<BoardViewPanel open={open} onClose={onClose} solo={solo} />)
  );
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
  depthSettings().update(DEFAULT_BOARD_DEPTH);
  trigger = document.createElement('button');
  trigger.dataset.boardViewTrigger = 'true';
  document.body.append(trigger);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  boardViewSettings().reset();
  depthSettings().update(DEFAULT_BOARD_DEPTH);
});

describe('BoardViewPanel', () => {
  it('renders nothing while closed', async () => {
    await render(false);
    expect(host.querySelector('#boardViewPanel')).toBeNull();
  });

  it('opens as a labelled, non-modal panel focused on what it shows', async () => {
    trigger.focus();
    await render(true);
    const panel = host.querySelector<HTMLElement>('#boardViewPanel')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('false');
    expect(
      document.getElementById(panel.getAttribute('aria-labelledby')!)
        ?.textContent
    ).toBe('Board view');
    expect(document.activeElement).toBe(input('boardShowBoth'));
    // Keys pressed in it belong to it, not to the table's shortcuts.
    expect(isOverlayKeyTarget(input('boardShowBoth'))).toBe(true);
  });

  it('applies each choice as it is made', async () => {
    await render(true);
    await choose('boardShowMine');
    expect(boardViewSettings().getSnapshot().show).toBe('mine');
    // With one half showing there is nothing to split.
    expect(input('boardSplitRange').disabled).toBe(true);
    await choose('boardShowBoth');
    expect(input('boardSplitRange').disabled).toBe(false);
    await slide('boardSplitRange', '60');
    expect(boardViewSettings().getSnapshot().split).toBe(0.6);
    expect(host.textContent).toContain('Theirs 40% · Mine 60%');

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
    expect(boardViewSettings().getSnapshot()).toMatchObject({
      zoneOutlines: false,
      hideOpponentHand: true,
      hoverPreview: true,
    });

    await act(async () =>
      host.querySelector<HTMLButtonElement>('#boardViewResetButton')!.click()
    );
    expect(boardViewSettings().getSnapshot()).toEqual(DEFAULT_BOARD_VIEW);
    expect(depthSettings().getSnapshot()).toEqual(DEFAULT_BOARD_DEPTH);
  });

  it("offers to cover the opponent's hand only in Solo", async () => {
    await render(true, vi.fn(), false);
    expect(host.querySelector('#hideHandCheckbox')).toBeNull();
    expect(host.querySelector('#zoneOutlinesCheckbox')).not.toBeNull();
  });

  it('closes on Escape without the key reaching the table, and gives focus back', async () => {
    const onClose = vi.fn();
    const tableKeys = vi.fn();
    document.addEventListener('keydown', tableKeys);
    trigger.focus();
    await render(true, onClose);
    input('boardShowBoth').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    document.removeEventListener('keydown', tableKeys);
    expect(onClose).toHaveBeenCalledOnce();
    expect(tableKeys).not.toHaveBeenCalled();
    await render(false, onClose);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a press outside it, but not on its own controls or its button', async () => {
    const onClose = vi.fn();
    await render(true, onClose);
    input('boardShowMine').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true })
    );
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    document.body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true })
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from its close button', async () => {
    const onClose = vi.fn();
    await render(true, onClose);
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close board view"]'
        )!
        .click()
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
