// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { workAreaDropTargetAt } from './work-area-drop-target.js';
afterEach(() => document.body.replaceChildren());
it('accepts only the actual visible window bounds, never its old scene rectangle or source', () => {
  document.body.innerHTML =
    '<div data-work-area-id="area" data-work-area-drop-active="true"></div>';
  const window = document.body.firstElementChild as HTMLElement;
  window.getBoundingClientRect = () => ({
    x: 200,
    y: 200,
    left: 200,
    top: 200,
    right: 500,
    bottom: 500,
    width: 300,
    height: 300,
    toJSON: () => ({}),
  });
  expect(workAreaDropTargetAt(document.body, 100, 100)).toBeNull();
  expect(workAreaDropTargetAt(document.body, 250, 250)).toBe('area');
  expect(workAreaDropTargetAt(document.body, 250, 250, 'area')).toBeNull();
  window.setAttribute('inert', '');
  expect(workAreaDropTargetAt(document.body, 250, 250)).toBeNull();
  window.removeAttribute('inert');
  window.dataset.workAreaDropActive = 'false';
  expect(workAreaDropTargetAt(document.body, 250, 250)).toBeNull();
});
