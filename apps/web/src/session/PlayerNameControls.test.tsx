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

for (const id of ['p1', 'p2'])
  it.each(['blur', 'Enter'])(
    `preserves a newer draft for ${id} after an earlier save via %s`,
    async (method) => {
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host),
        onChange = vi.fn();
      const render = (name: string) =>
        root.render(
          <PlayerNameControls
            players={[{ id, name, editable: true, onChange }]}
          />
        );
      const type = async (value: string) =>
        act(async () => {
          const input = host.querySelector('input')!;
          input.focus();
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
          )!.set!.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      const save = async () =>
        act(async () => {
          const input = host.querySelector('input')!;
          if (method === 'blur') input.blur();
          else
            input.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
            );
        });
      try {
        await act(async () => render('Original'));
        await type('First save');
        await save();
        expect(onChange).toHaveBeenLastCalledWith('First save');
        await type('Second draft');
        await act(async () => render('First save'));
        expect(host.querySelector('input')!.value).toBe('Second draft');
        await save();
        expect(onChange).toHaveBeenLastCalledWith('Second draft');
        await act(async () => render('Second draft'));
        expect(host.querySelector('input')!.value).toBe('Second draft');
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    }
  );

it('queues a name revert even while an earlier change is waiting', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    onChange = vi.fn();
  try {
    await act(async () =>
      root.render(
        <PlayerNameControls
          players={[{ id: 'p1', name: 'Original', editable: true, onChange }]}
        />
      )
    );
    const input = host.querySelector('input')!;
    for (const name of ['Pending', 'Original']) {
      await act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )!.set!.call(input, name);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => input.blur());
    }
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([
      'Pending',
      'Original',
    ]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('syncs pristine name fields, cancels escaped edits and preserves disabled drafts', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    onChange = vi.fn();
  const render = (name: string, editable = true) =>
    root.render(
      <PlayerNameControls players={[{ id: 'p1', name, editable, onChange }]} />
    );
  try {
    await act(async () => render('Original'));
    const input = host.querySelector('input')!;
    await act(async () => input.focus());
    await act(async () => render('Remote'));
    expect(input.value).toBe('Remote');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, 'Draft');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    );
    expect(input.value).toBe('Remote');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, 'Another');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => render('Remote', false));
    expect(input.value).toBe('Remote');
    expect(input.disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => render('Remote', true));
    expect(input.value).toBe('Another');
    await act(async () => input.focus());
    await act(async () => input.blur());
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Another');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
