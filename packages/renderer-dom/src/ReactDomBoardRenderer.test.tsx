// @vitest-environment happy-dom

import { asPlayerId, asViewCardId } from '@ptcgsim/game-core';
import {
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_PRESENTATION,
  type BoardIntent,
  type BoardRendererStatus,
  type BoardScene,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactDomBoardRenderer } from './ReactDomBoardRenderer.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cardId = asViewCardId('visible-card');
const playerId = asPlayerId('p1');

const createScene = (revision = 1, x = 10): BoardScene => ({
  matchId: 'match',
  revision,
  viewport: { width: 800, height: 600, devicePixelRatio: 1 },
  bottomPlayerId: playerId,
  splitRatio: 0.5,
  zones: [
    {
      id: 'zone:p1:hand',
      playerId,
      side: 'local',
      kind: 'hand',
      bounds: { x: 0, y: 400, width: 800, height: 200 },
      count: 1,
      zIndex: 10,
      label: 'Blue hand',
      interactive: true,
    },
  ],
  cards: [
    {
      id: cardId,
      ownerId: playerId,
      parentId: 'zone:p1:hand',
      side: 'local',
      role: 'zone',
      bounds: { x, y: 420, width: 90, height: 126 },
      zIndex: 100,
      rotationQuarterTurns: 0,
      imageUrl: '/visible.png',
      concealed: false,
      label: 'Visible card',
      interactive: true,
    },
  ],
  markers: [],
});

const mountInAct = async (
  renderer: ReactDomBoardRenderer,
  host: HTMLElement,
  scene: BoardScene
): Promise<void> => {
  let pending: Promise<void> | null = null;
  await act(async () => {
    pending = renderer.mount(host, scene, DEFAULT_BOARD_PRESENTATION);
  });
  await pending;
};

describe('React DOM board renderer', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('reuses stable keyed card elements and emits renderer-neutral intents', async () => {
    const intents: BoardIntent[] = [];
    const statuses: BoardRendererStatus[] = [];
    const renderer = new ReactDomBoardRenderer({
      emitIntent: (intent) => intents.push(intent),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
      reportStatus: (status) => statuses.push(status),
    });
    const host = document.createElement('div');
    document.body.append(host);

    await mountInAct(renderer, host, createScene());
    const before = host.querySelector<HTMLElement>(
      '[data-card-id="visible-card"]'
    );
    expect(before).not.toBeNull();
    expect(before?.getAttribute('aria-label')).toBe('Visible card');

    act(() => renderer.installScene(createScene(2, 40), []));
    const after = host.querySelector<HTMLElement>(
      '[data-card-id="visible-card"]'
    );
    expect(after).toBe(before);
    expect(after?.style.left).toBe('40px');

    after?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    after?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    );
    expect(intents).toEqual([
      { kind: 'CardSelected', cardId },
      { kind: 'CardContextRequested', cardId },
    ]);
    expect(statuses).toEqual([
      { kind: 'mounting' },
      { kind: 'ready', generation: 1 },
    ]);

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
    expect(host.childElementCount).toBe(0);
    renderer.destroy();
    expect(statuses.at(-1)).toEqual({ kind: 'destroyed' });
  });

  it('rejects stale scenes and presentation events for the wrong revision', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    await mountInAct(renderer, host, createScene(3));
    expect(() => renderer.installScene(createScene(2), [])).toThrow(
      'older board scene revision'
    );
    expect(() =>
      act(() => renderer.installScene(createScene(2), [], 'replace'))
    ).not.toThrow();
    expect(() =>
      renderer.installScene(createScene(4), [
        { kind: 'CommandRejected', revision: 3, reason: 'stale' },
      ])
    ).toThrow('does not match');
    act(() => renderer.setPreferences(DEFAULT_BOARD_PREFERENCES));
    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('allows interaction cancellation before mount and while mounted', async () => {
    const emitIntent = vi.fn();
    const emitPresentationUpdate = vi.fn();
    const renderer = new ReactDomBoardRenderer({
      emitIntent,
      emitPresentationUpdate,
      reportError: vi.fn(),
    });
    expect(() => renderer.cancelInteraction()).not.toThrow();
    const host = document.createElement('div');
    await mountInAct(renderer, host, createScene());
    const surface = host.querySelector<HTMLElement>('.ptcgsim-board-surface')!;
    const card = host.querySelector<HTMLElement>('[data-card-id]')!;
    surface.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      }) as DOMRect;
    const releasePointerCapture = vi.fn();
    card.setPointerCapture = vi.fn();
    card.hasPointerCapture = vi.fn(() => true);
    card.releasePointerCapture = releasePointerCapture;
    act(() => {
      card.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 7,
          button: 0,
          clientX: 30,
          clientY: 440,
        })
      );
      surface.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 7,
          button: 0,
          clientX: 300,
          clientY: 300,
        })
      );
    });
    expect(emitPresentationUpdate).toHaveBeenCalled();
    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    act(() => {
      surface.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 7,
          button: 0,
          clientX: 300,
          clientY: 300,
        })
      );
    });
    expect(emitIntent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CardDropRequested' })
    );
  });

  it('clears scene and presentation synchronously while retaining the mounted root', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await mountInAct(renderer, host, createScene());
    act(() =>
      renderer.installPresentation({
        ...DEFAULT_BOARD_PRESENTATION,
        selectedCardId: cardId,
        openedZoneId: 'zone:p1:hand',
      })
    );
    expect(host.querySelector('[aria-pressed="true"]')).not.toBeNull();

    act(() => renderer.clearScene());
    expect(host.childElementCount).toBe(0);
    expect(() => act(() => renderer.clearScene())).not.toThrow();
    expect(host.childElementCount).toBe(0);

    act(() => renderer.installScene(createScene(2), [], 'replace'));
    const card = host.querySelector<HTMLElement>('[data-card-id]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('survives repeated StrictMode-compatible mount and teardown without nodes accumulating', async () => {
    const host = document.createElement('div');
    for (let index = 0; index < 10; index += 1) {
      const renderer = new ReactDomBoardRenderer({
        emitIntent: vi.fn(),
        emitPresentationUpdate: vi.fn(),
        reportError: vi.fn(),
      });
      await mountInAct(renderer, host, createScene(index));
      expect(host.querySelectorAll('[data-card-id]').length).toBe(1);
      await act(async () => {
        renderer.destroy();
        await Promise.resolve();
      });
      expect(host.childElementCount).toBe(0);
    }
  });
});
