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

describe('React DOM board renderer', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('reuses stable keyed card elements and emits renderer-neutral intents', async () => {
    const intents: BoardIntent[] = [];
    const statuses: BoardRendererStatus[] = [];
    const renderer = new ReactDomBoardRenderer({
      emitIntent: (intent) => intents.push(intent),
      reportError: vi.fn(),
      reportStatus: (status) => statuses.push(status),
    });
    const host = document.createElement('div');
    document.body.append(host);

    await act(async () => {
      await renderer.mount(host, createScene(), DEFAULT_BOARD_PRESENTATION);
    });
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

    act(() => renderer.destroy());
    expect(host.childElementCount).toBe(0);
    renderer.destroy();
    expect(statuses.at(-1)).toEqual({ kind: 'destroyed' });
  });

  it('rejects stale scenes and presentation events for the wrong revision', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    await act(async () => {
      await renderer.mount(host, createScene(3), DEFAULT_BOARD_PRESENTATION);
    });
    expect(() => renderer.installScene(createScene(2), [])).toThrow(
      'older board scene revision'
    );
    expect(() =>
      renderer.installScene(createScene(4), [
        { kind: 'CommandRejected', revision: 3, reason: 'stale' },
      ])
    ).toThrow('does not match');
    act(() => renderer.setPreferences(DEFAULT_BOARD_PREFERENCES));
    act(() => renderer.destroy());
  });

  it('survives repeated StrictMode-compatible mount and teardown without nodes accumulating', async () => {
    const host = document.createElement('div');
    for (let index = 0; index < 10; index += 1) {
      const renderer = new ReactDomBoardRenderer({
        emitIntent: vi.fn(),
        reportError: vi.fn(),
      });
      await act(async () => {
        await renderer.mount(
          host,
          createScene(index),
          DEFAULT_BOARD_PRESENTATION
        );
      });
      expect(host.querySelectorAll('[data-card-id]').length).toBe(1);
      act(() => renderer.destroy());
      expect(host.childElementCount).toBe(0);
    }
  });
});
