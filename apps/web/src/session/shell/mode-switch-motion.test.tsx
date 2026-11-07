// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import {
  resetModeSwitchSlide,
  useModeSwitchSlide,
} from './mode-switch-motion.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const Switch = ({ current }: { readonly current: 'solo' | 'online' }) => {
  const group = useRef<HTMLDivElement>(null);
  useModeSwitchSlide(group, current);
  const sides = [
    <button key="solo" className="ptcgsim-app-bar__switch-option">
      Solo
    </button>,
    <button key="online" className="ptcgsim-app-bar__switch-option">
      Online
    </button>,
  ];
  return (
    <div ref={group}>{current === 'solo' ? sides : [...sides].reverse()}</div>
  );
};

let host: HTMLElement;
let root: Root;
const animate = vi.fn();

beforeEach(() => {
  resetModeSwitchSlide();
  animate.mockReset();
  HTMLElement.prototype.animate = animate as never;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const index = [...(this.parentElement?.children ?? [])].indexOf(this);
      const width = this.textContent === 'Solo' ? 60 : 80;
      const left =
        index === 0
          ? 0
          : this.parentElement!.children[0]!.textContent === 'Solo'
            ? 62
            : 82;
      return {
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 30,
        height: 30,
        x: left,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it('slides the sides past each other when the side in play changes, not on first showing', () => {
  act(() => root.render(<Switch current="solo" />));
  expect(animate).not.toHaveBeenCalled();
  act(() => root.render(<Switch current="online" />));
  // Online, now first, comes from where it was: past Solo and the gap.
  expect(animate).toHaveBeenCalledTimes(2);
  expect(animate.mock.calls[0]![0]).toEqual([
    { translate: '62px 0px' },
    { translate: '0px 0px' },
  ]);
  expect(animate.mock.calls[1]![0]).toEqual([
    { translate: '-82px 0px' },
    { translate: '0px 0px' },
  ]);
});

it('slides a new bar from the one the page just put away', () => {
  act(() => root.render(<Switch current="solo" />));
  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(<Switch current="online" />));
  expect(animate).toHaveBeenCalledTimes(2);
});
