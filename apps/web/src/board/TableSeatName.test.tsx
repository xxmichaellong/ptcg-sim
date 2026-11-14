// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { TooltipProvider } from '../ui/Tooltip.js';
import { TableSeatName } from './TableSeatName.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = (
  name: string,
  onRename: (name: string) => unknown,
  editable = true
) =>
  act(async () =>
    root.render(
      <TooltipProvider>
        <TableSeatName
          name={name}
          editable={editable}
          onRename={onRename as (name: string) => boolean}
          side="top"
        />
      </TooltipProvider>
    )
  );
const button = () =>
  host.querySelector<HTMLButtonElement>('[data-seat-name="rename"]');
const field = () =>
  host.querySelector<HTMLInputElement>('[data-seat-name="field"]');
const open = () => act(async () => button()!.click());
const type = (value: string) =>
  act(async () => {
    const input = field()!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const key = (init: KeyboardEventInit) =>
  act(async () =>
    field()!.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    )
  );
const leave = () => act(async () => field()!.blur());

it('opens in place with the name selected, and gives the keyboard back', async () => {
  // The room hasn't answered yet.
  const onRename = vi.fn(() => new Promise<boolean>(() => {}));
  await render('Blue', onRename);
  expect(button()!.textContent).toBe('Blue');
  expect(button()!.getAttribute('aria-label')).toBe('Rename Blue');
  await open();
  expect(document.activeElement).toBe(field());
  expect(field()!.getAttribute('aria-label')).toBe('Name for Blue');
  expect(field()!.value).toBe('Blue');
  await key({ key: 'Escape' });
  expect(field()).toBeNull();
  expect(document.activeElement).toBe(button());
  await open();
  await type('Dawn');
  await key({ key: 'Enter' });
  expect(onRename).toHaveBeenCalledExactlyOnceWith('Dawn');
  expect(document.activeElement).toBe(button());
  // Shown at once, while the room takes it.
  expect(button()!.textContent).toBe('Dawn');
});

it('is the name alone where it may not be renamed', async () => {
  await render('Red', vi.fn(), false);
  expect(button()).toBeNull();
  expect(host.textContent).toBe('Red');
});

it('saves nothing for an empty or untouched name', async () => {
  const onRename = vi.fn(() => true);
  await render('Blue', onRename);
  await open();
  await leave();
  await open();
  await type('   ');
  await leave();
  expect(onRename).not.toHaveBeenCalled();
  expect(button()!.textContent).toBe('Blue');
});

it.each([
  { key: 'Enter', isComposing: true },
  { key: 'Escape', isComposing: true },
  { key: 'Enter', keyCode: 229 },
  { key: 'Escape', keyCode: 229 },
])('keeps composing a name for $key ($isComposing, $keyCode)', async (init) => {
  const onRename = vi.fn();
  await render('Blue', onRename);
  await open();
  await type('あお');
  await key(init);
  expect(document.activeElement).toBe(field());
  expect(field()!.value).toBe('あお');
  expect(onRename).not.toHaveBeenCalled();
  await key({ key: 'Enter' });
  expect(onRename).toHaveBeenCalledExactlyOnceWith('あお');
});

it.each(['blur', 'Enter'])(
  'keeps a newer draft through an earlier save’s answer (%s)',
  async (method) => {
    const onRename = vi.fn();
    const save = () => (method === 'blur' ? leave() : key({ key: 'Enter' }));
    await render('Original', onRename);
    await open();
    await type('First save');
    await save();
    expect(onRename).toHaveBeenLastCalledWith('First save');
    await open();
    await type('Second draft');
    await render('First save', onRename);
    expect(field()!.value).toBe('Second draft');
    await save();
    expect(onRename).toHaveBeenLastCalledWith('Second draft');
    await render('Second draft', onRename);
    expect(button()!.textContent).toBe('Second draft');
  }
);

it('sends a name back even while an earlier change is waiting', async () => {
  const onRename = vi.fn(() => new Promise<boolean>(() => {}));
  await render('Original', onRename);
  for (const name of ['Pending', 'Original']) {
    await open();
    await type(name);
    await leave();
  }
  expect(onRename.mock.calls.map((call) => call[0])).toEqual([
    'Pending',
    'Original',
  ]);
});

it('follows the name while untouched, Esc puts it back, and a draft waits out a pause', async () => {
  const onRename = vi.fn();
  await render('Original', onRename);
  await open();
  await render('Remote', onRename);
  expect(field()!.value).toBe('Remote');
  await type('Draft');
  await key({ key: 'Escape' });
  expect(button()!.textContent).toBe('Remote');
  await open();
  expect(field()!.value).toBe('Remote');
  await type('Another');
  // A replay starts: the name is shown, not renamed, and nothing is sent.
  await render('Remote', onRename, false);
  expect(field()).toBeNull();
  expect(host.textContent).toBe('Remote');
  expect(onRename).not.toHaveBeenCalled();
  await render('Remote', onRename, true);
  await open();
  expect(field()!.value).toBe('Another');
  await leave();
  expect(onRename).toHaveBeenCalledExactlyOnceWith('Another');
});

it.each(['immediate', 'deferred'])(
  'keeps a refused name to try again (%s refusal)',
  async (mode) => {
    let refuse!: (accepted: boolean) => void;
    const first = new Promise<boolean>((resolve) => {
      refuse = resolve;
    });
    const onRename = vi
      .fn()
      .mockImplementationOnce(() => (mode === 'immediate' ? false : first))
      .mockResolvedValue(true);
    await render('Original', onRename);
    await open();
    await type('Wanted');
    await leave();
    if (mode === 'deferred') await act(async () => refuse(false));
    expect(button()!.dataset['failed']).toBe('true');
    expect(button()!.textContent).toBe('Original');
    await open();
    expect(field()!.value).toBe('Wanted');
    expect(field()!.getAttribute('aria-invalid')).toBe('true');
    await leave();
    expect(onRename).toHaveBeenCalledTimes(2);
    expect(button()!.dataset['failed']).toBeUndefined();
  }
);

it.each(['edit', 'Escape'])(
  'ignores an older refusal after a newer %s',
  async (choice) => {
    let refuse!: (accepted: boolean) => void;
    const onRename = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          refuse = resolve;
        })
    );
    await render('Original', onRename);
    await open();
    await type('First');
    await leave();
    await open();
    await type('New draft');
    if (choice === 'Escape') await key({ key: 'Escape' });
    await act(async () => refuse(false));
    if (choice === 'Escape') {
      expect(button()!.textContent).toBe('Original');
      expect(button()!.dataset['failed']).toBeUndefined();
    } else {
      expect(field()!.value).toBe('New draft');
      expect(field()!.getAttribute('aria-invalid')).toBeNull();
    }
  }
);
