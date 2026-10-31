// @vitest-environment happy-dom

import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useExitGhost } from './exit-ghost.js';

const Panel = () => {
  const ref = useRef<HTMLDivElement>(null);
  useExitGhost(ref, 'is-leaving-panel');
  return (
    <div ref={ref} className="panel" data-area="upper" role="dialog">
      <section className="card" data-card="1">
        <span className="spinner">…</span>
      </section>
    </div>
  );
};

describe('useExitGhost', () => {
  let host: HTMLDivElement;
  let root: Root;
  let style: HTMLStyleElement;

  beforeEach(async () => {
    style = document.createElement('style');
    // Placed by an attribute the copy loses.
    style.textContent =
      '.panel { position: fixed; top: 0px; } .panel[data-area="upper"] { bottom: 33px; align-items: end; }';
    document.head.append(style);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<Panel />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    style.remove();
  });

  const close = async () => {
    await act(async () => root.render(null));
    await act(async () => Promise.resolve());
    return host.querySelector<HTMLElement>('.panel.is-leaving');
  };

  it('leaves an inert copy where the element was, which nothing can find', async () => {
    const ghost = await close();
    expect(ghost).not.toBeNull();
    expect(ghost!.classList.contains('is-leaving-panel')).toBe(true);
    expect(ghost!.getAttribute('aria-hidden')).toBe('true');
    expect(ghost!.hasAttribute('inert')).toBe(true);
    expect(ghost!.hasAttribute('role')).toBe(false);
    expect(ghost!.hasAttribute('data-area')).toBe(false);
    // Its placement stays though its attribute is gone.
    expect(ghost!.style.bottom).toBe('33px');
    expect(ghost!.style.alignItems).toBe('end');
  });

  it('goes once its own exit (or a child of it) has ended, not a deeper part', async () => {
    const ghost = (await close())!;
    act(() => {
      ghost
        .querySelector('.spinner')!
        .dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(ghost.isConnected).toBe(true);
    act(() => {
      ghost
        .querySelector('.card')!
        .dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(ghost.isConnected).toBe(false);
  });
});
