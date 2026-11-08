// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';

import { liftHeldCards } from './held-card-lift.js';

const card = (attributes: Record<string, string>): HTMLElement => {
  const element = document.createElement('button');
  element.className = 'ptcgsim-card';
  for (const [name, value] of Object.entries(attributes))
    element.setAttribute(name, value);
  return element;
};

it('shows a card flying out of a viewer over the windows, as it does a held one, and only those', () => {
  const surface = document.createElement('div');
  const table = document.createElement('div');
  table.className = 'ptcgsim-board-table';
  surface.append(table);
  const flying = card({ 'data-card-id': 'flying', 'data-over-windows': '' });
  const held = card({ 'data-card-id': 'held', 'data-held': 'drag' });
  const resting = card({ 'data-card-id': 'resting' });
  table.append(flying, held, resting);
  const layer = document.createElement('div');
  layer.append(document.createElement('div'));
  document.body.append(surface, layer);
  const stop = liftHeldCards(surface, layer);
  const copies = Array.from(layer.querySelectorAll('[data-lift-copy]'));
  // A copy each, with no identity of its own; the originals stay put.
  expect(copies).toHaveLength(2);
  for (const copy of copies)
    expect(copy.hasAttribute('data-card-id')).toBe(false);
  expect(flying.hasAttribute('data-lifted')).toBe(true);
  expect(held.hasAttribute('data-lifted')).toBe(true);
  expect(resting.hasAttribute('data-lifted')).toBe(false);
  stop();
  expect(layer.querySelectorAll('[data-lift-copy]')).toHaveLength(0);
  expect(flying.hasAttribute('data-lifted')).toBe(false);
  surface.remove();
  layer.remove();
});

it('carries markers above windows with their card, without duplicate identities or hints', () => {
  const frames: FrameRequestCallback[] = [];
  const request = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
  const cancel = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation(() => {});
  const surface = document.createElement('div'),
    table = document.createElement('div');
  table.className = 'ptcgsim-board-table';
  surface.append(table);
  const held = card({ 'data-card-id': 'held-marked', 'data-held': 'drag' });
  const marked = document.createElement('div');
  marked.className = 'ptcgsim-marker';
  marked.setAttribute('data-marker-id', 'held-used');
  marked.setAttribute('data-marker-parent-card-id', 'held-marked');
  marked.innerHTML =
    '<span data-marker-hint-id="held-used" data-board-hint="Ability used">Used</span>';
  marked.style.zIndex = '10200';
  const resting = marked.cloneNode(true) as HTMLElement;
  resting.setAttribute('data-marker-parent-card-id', 'resting');
  table.append(held, marked, resting);
  const layer = document.createElement('div');
  layer.append(document.createElement('div'));
  document.body.append(surface, layer);
  const stop = liftHeldCards(surface, layer);
  try {
    expect(layer.querySelectorAll('[data-lift-copy]')).toHaveLength(2);
    const copy = layer.querySelector<HTMLElement>('.ptcgsim-marker')!;
    expect(copy).not.toBeNull();
    expect(copy.style.zIndex).toBe('10200');
    expect(
      layer.querySelector(
        '[data-marker-id], [data-marker-hint-id], [data-marker-parent-card-id], [data-board-hint]'
      )
    ).toBeNull();
    expect(marked.hasAttribute('data-lifted')).toBe(true);
    expect(resting.hasAttribute('data-lifted')).toBe(false);
    marked.style.top = '42px';
    frames.shift()!(0);
    expect(copy.style.top).toBe('42px');
    held.removeAttribute('data-held');
    frames.shift()!(0);
    expect(layer.querySelectorAll('[data-lift-copy]')).toHaveLength(0);
    expect(marked.hasAttribute('data-lifted')).toBe(false);
  } finally {
    stop();
    request.mockRestore();
    cancel.mockRestore();
    surface.remove();
    layer.remove();
  }
});

for (const heldAttribute of ['data-held', 'data-over-windows'])
  it.each([
    ['damage', '<span>10</span>', '<span>20</span>', '20'],
    [
      'reminder',
      '<span><svg><path d="M0 0" /></svg> once <b>old</b></span>',
      '<span><svg><path d="M0 0" /></svg> twice <b>new</b></span>',
      ' twice new',
    ],
    [
      'mixed text',
      '<span><b>Mark</b></span>',
      '<span>New <b>Mark</b> note</span>',
      'New Mark note',
    ],
  ])(
    `keeps %s text current while carrying with ${heldAttribute}`,
    (_kind, before, after, text) => {
      const frames: FrameRequestCallback[] = [];
      const request = vi
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((callback) => {
          frames.push(callback);
          return frames.length;
        });
      const cancel = vi
        .spyOn(window, 'cancelAnimationFrame')
        .mockImplementation(() => {});
      const surface = document.createElement('div'),
        layer = document.createElement('div');
      const held = card({
        'data-card-id': 'marked',
        [heldAttribute]: heldAttribute === 'data-held' ? 'drag' : '',
      });
      const marker = document.createElement('div');
      marker.className = 'ptcgsim-marker';
      marker.setAttribute('data-marker-id', 'live-marker');
      marker.setAttribute('data-marker-parent-card-id', 'marked');
      marker.innerHTML = before!;
      surface.append(held, marker);
      layer.append(document.createElement('div'));
      document.body.append(surface, layer);
      const stop = liftHeldCards(surface, layer);
      try {
        const visible = () =>
          layer.querySelector<HTMLElement>('.ptcgsim-marker')!;
        expect(visible().textContent).toBe(marker.textContent);
        marker.innerHTML = after!;
        frames.shift()!(0);
        expect(visible().textContent).toBe(text);
        // Removed inline text must disappear too, without losing the badge.
        marker.innerHTML = '<span><b>Mark</b></span>';
        frames.shift()!(0);
        expect(visible().textContent).toBe('Mark');
        expect(
          layer.querySelector('[data-marker-id], [data-marker-parent-card-id]')
        ).toBeNull();
        expect(marker.hasAttribute('data-lifted')).toBe(true);
      } finally {
        stop();
        request.mockRestore();
        cancel.mockRestore();
        surface.remove();
        layer.remove();
      }
    }
  );
