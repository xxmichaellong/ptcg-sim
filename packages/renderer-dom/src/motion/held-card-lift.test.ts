// @vitest-environment happy-dom
import { expect, it } from 'vitest';

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
