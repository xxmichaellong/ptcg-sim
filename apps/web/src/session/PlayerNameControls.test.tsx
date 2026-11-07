// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PlayerNameControls } from './PlayerNameControls.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it.each([
  { key: 'Enter', isComposing: true },
  { key: 'Escape', isComposing: true },
  { key: 'Enter', keyCode: 229 },
  { key: 'Escape', keyCode: 229 },
])(
  'keeps composing player names for $key ($isComposing, $keyCode)',
  async (init) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host),
      onChange = vi.fn();
    try {
      await act(async () =>
        root.render(
          <PlayerNameControls
            players={[{ id: 'p1', name: 'Blue', editable: true, onChange }]}
          />
        )
      );
      const input = host.querySelector('input')!;
      await act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )!.set!.call(input, 'あお');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            ...init,
            bubbles: true,
            cancelable: true,
          })
        )
      );
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('あお');
      expect(onChange).not.toHaveBeenCalled();
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          })
        )
      );
      expect(onChange).toHaveBeenCalledExactlyOnceWith('あお');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  }
);
