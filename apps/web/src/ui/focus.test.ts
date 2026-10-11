// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { trapFocus } from './focus.js';

afterEach(() => document.body.replaceChildren());

describe('custom surface focus boundary', () => {
  it('wraps around visible controls while ignoring disabled, inert and hidden descendants', () => {
    const container = document.createElement('div');
    container.tabIndex = -1;
    container.innerHTML = `
      <input type="hidden">
      <button disabled tabindex="0">Disabled</button>
      <div hidden><button>Hidden</button></div>
      <div inert><button>Inert</button></div>
      <div style="display:none"><button>Collapsed</button></div>
      <button id="first">First</button>
      <button id="last">Last</button>
      <button tabindex="-1">Programmatic only</button>`;
    document.body.append(container);
    const event = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    const first = container.querySelector<HTMLElement>('#first')!;
    const last = container.querySelector<HTMLElement>('#last')!;
    container.focus();
    trapFocus(event, container);
    expect(document.activeElement).toBe(first);
    trapFocus({ ...event, shiftKey: true }, container);
    expect(document.activeElement).toBe(last);
    trapFocus(event, container);
    expect(document.activeElement).toBe(first);
    expect(event.preventDefault).toHaveBeenCalledTimes(3);
  });

  it('retains focus in an empty surface without consuming unrelated keys', () => {
    const container = document.createElement('div');
    container.tabIndex = -1;
    document.body.append(container);
    const preventDefault = vi.fn();
    trapFocus({ key: 'Escape', shiftKey: false, preventDefault }, container);
    expect(preventDefault).not.toHaveBeenCalled();
    trapFocus({ key: 'Tab', shiftKey: false, preventDefault }, container);
    expect(document.activeElement).toBe(container);
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
