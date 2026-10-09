// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cancelAllDialogRequests,
  confirmAction,
  dismissToast,
  isOverlayKeyTarget,
  isOverlaySurfaceTarget,
  OverlayHost,
  promptValue,
  toast,
  Tooltip,
} from './index.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const hosts: HTMLElement[] = [];

const mountHost = async (container?: HTMLElement): Promise<Root> => {
  const element = document.createElement('div');
  document.body.append(element);
  hosts.push(element);
  const root = createRoot(element);
  roots.push(root);
  await act(async () => {
    root.render(<OverlayHost {...(container ? { container } : {})} />);
  });
  return root;
};

/** Lets Base UI's rAF/timer-driven transitions and focus moves settle. */
const settle = async (rounds = 4): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

const dialog = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    '[data-ptcgsim-overlay="alert"], [data-ptcgsim-overlay="dialog"]'
  );

const button = (action: string): HTMLButtonElement => {
  const element = document.querySelector<HTMLButtonElement>(
    `[data-dialog-action="${action}"]`
  );
  if (!element) throw new Error(`No ${action} button`);
  return element;
};

const click = async (element: Element): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
  });
};

const pressKey = async (element: Element, key: string): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    );
  });
};

const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const submitForm = async (input: HTMLInputElement): Promise<void> => {
  await act(async () => {
    input.form?.requestSubmit();
  });
};

const field = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>(
    '.ptcgsim-ui-field__input'
  );
  if (!input) throw new Error('No prompt field');
  return input;
};

/** Runs a store-publishing call inside act, as a click handler would. */
const inAct = async <T,>(call: () => T): Promise<{ readonly result: T }> => {
  let result!: T;
  await act(async () => {
    result = call();
  });
  return { result };
};

const ask = async <T,>(call: () => Promise<T>) => {
  let promise!: Promise<T>;
  await act(async () => {
    promise = call();
  });
  return track(promise);
};

const track = <T,>(promise: Promise<T>) => {
  const state: { settled: boolean; value?: T } = { settled: false };
  void promise.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(async () => {
  await act(async () => {
    cancelAllDialogRequests();
    dismissToast();
  });
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  for (const element of hosts.splice(0)) element.remove();
  document.body.innerHTML = '';
});

describe('confirmAction', () => {
  it('asks in a labelled alert dialog and resolves true on confirm', async () => {
    await mountHost();
    const answer = await ask(() =>
      confirmAction({
        title: 'Shuffle the discard?',
        body: 'Every card goes back into the deck.',
        confirmLabel: 'Shuffle',
        cancelLabel: 'Keep',
      })
    );
    await settle();

    const popup = dialog();
    expect(popup?.getAttribute('role')).toBe('alertdialog');
    const titleId = popup?.getAttribute('aria-labelledby');
    expect(titleId && document.getElementById(titleId)?.textContent).toBe(
      'Shuffle the discard?'
    );
    const descriptionId = popup?.getAttribute('aria-describedby');
    expect(
      descriptionId && document.getElementById(descriptionId)?.textContent
    ).toBe('Every card goes back into the deck.');
    expect(button('cancel').textContent).toBe('Keep');
    expect(button('confirm').textContent).toBe('Shuffle');
    expect(button('confirm').dataset.variant).toBe('primary');
    // A default confirm starts on its confirm button, like the native one.
    expect(document.activeElement).toBe(button('confirm'));
    expect(answer.settled).toBe(false);
    // The scrim belongs to the dialog too: a press on it is not a press on
    // the table underneath.
    expect(
      isOverlaySurfaceTarget(document.querySelector('.ptcgsim-ui-scrim'))
    ).toBe(true);
    const confirmButton = button('confirm');
    expect(isOverlayKeyTarget(confirmButton)).toBe(true);

    await click(confirmButton);
    // Answered, it only animates out: it no longer owns the keyboard.
    expect(
      !confirmButton.isConnected || !isOverlayKeyTarget(confirmButton)
    ).toBe(true);
    await settle();
    expect(answer).toEqual({ settled: true, value: true });
    expect(dialog()).toBeNull();
  });

  it('resolves false on Cancel and on Escape, and does nothing else', async () => {
    await mountHost();
    const cancelled = await ask(() =>
      confirmAction({ title: 'Leave the room?' })
    );
    await settle();
    await click(button('cancel'));
    await settle();
    expect(cancelled).toEqual({ settled: true, value: false });

    const escaped = await ask(() =>
      confirmAction({ title: 'Leave the room?' })
    );
    await settle();
    await pressKey(document.activeElement ?? document.body, 'Escape');
    await settle();
    expect(escaped).toEqual({ settled: true, value: false });
    expect(dialog()).toBeNull();
  });

  it('paints a dangerous confirm red and focuses Cancel first', async () => {
    await mountHost();
    void (await inAct(() =>
      confirmAction({ title: 'Delete your deck?', tone: 'danger' })
    ));
    await settle();
    expect(dialog()?.dataset.tone).toBe('danger');
    expect(button('confirm').dataset.variant).toBe('danger');
    expect(document.activeElement).toBe(button('cancel'));
  });

  it('closes and resolves false when its signal aborts', async () => {
    await mountHost();
    const abort = new AbortController();
    const answer = await ask(() =>
      confirmAction({ title: 'Sure?', signal: abort.signal })
    );
    await settle();
    expect(dialog()).not.toBeNull();
    await inAct(() => abort.abort());
    await settle();
    expect(answer).toEqual({ settled: true, value: false });
    expect(dialog()).toBeNull();

    const preAborted = await ask(() =>
      confirmAction({ title: 'Never shown', signal: abort.signal })
    );
    await settle();
    expect(preAborted).toEqual({ settled: true, value: false });
    expect(dialog()).toBeNull();
  });

  it('hands focus back the moment it is answered, before animating out', async () => {
    await mountHost();
    const opener = document.createElement('button');
    opener.textContent = 'Leave Room';
    document.body.append(opener);
    opener.focus();
    const answer = await ask(() => confirmAction({ title: 'Leave the room?' }));
    await settle();
    expect(document.activeElement).toBe(button('confirm'));

    await click(button('confirm'));
    // No settling: the dialog may still be fading out, but the next key
    // already goes where it did before the question was asked.
    expect(document.activeElement).toBe(opener);
    await settle();
    expect(answer.value).toBe(true);
    expect(document.activeElement).toBe(opener);

    const prompt = await ask(() =>
      promptValue({ title: 'Draw how many cards?', label: 'Cards' })
    );
    await settle();
    expect(document.activeElement).toBe(field());
    await typeInto(field(), '2');
    await submitForm(field());
    expect(document.activeElement).toBe(opener);
    await settle();
    expect(prompt.value).toBe('2');
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('returns focus where the caller asks once its opener is gone', async () => {
    await mountHost();
    const opener = document.createElement('button');
    const fallback = document.createElement('button');
    document.body.append(opener, fallback);
    opener.focus();
    const answer = await ask(() =>
      confirmAction({
        title: 'Shuffle all to Deck?',
        finalFocus: () => (opener.isConnected ? opener : fallback),
      })
    );
    await settle();
    opener.remove();
    await click(button('confirm'));
    expect(document.activeElement).toBe(fallback);
    await settle();
    expect(answer.value).toBe(true);
    expect(document.activeElement).toBe(fallback);
    fallback.remove();
  });

  it('shows queued questions one at a time, in order', async () => {
    await mountHost();
    const first = await ask(() => confirmAction({ title: 'First?' }));
    const second = await ask(() => confirmAction({ title: 'Second?' }));
    await settle();
    expect(
      document.querySelectorAll('[data-ptcgsim-overlay="alert"]')
    ).toHaveLength(1);
    expect(dialog()?.textContent).toContain('First?');

    await click(button('cancel'));
    await settle();
    expect(first.value).toBe(false);
    expect(dialog()?.textContent).toContain('Second?');
    await click(button('confirm'));
    await settle();
    expect(second.value).toBe(true);
  });

  it('waits for a host, and only the newest host paints it', async () => {
    const answer = await ask(() => confirmAction({ title: 'Anyone there?' }));
    await settle();
    expect(dialog()).toBeNull();

    await mountHost();
    const layer = document.createElement('div');
    layer.dataset.harnessLayer = 'true';
    document.body.append(layer);
    await mountHost(layer);
    await settle();
    expect(
      document.querySelectorAll('[data-ptcgsim-overlay="alert"]')
    ).toHaveLength(1);
    expect(
      layer.querySelector('[data-ptcgsim-overlay="alert"]')
    ).not.toBeNull();

    await click(button('confirm'));
    await settle();
    expect(answer.value).toBe(true);
  });
});

describe('promptValue', () => {
  it('submits the typed value with Enter once it validates', async () => {
    await mountHost();
    const answer = await ask(() =>
      promptValue({
        title: 'Draw how many cards?',
        label: 'Number of cards',
        defaultValue: '1',
        inputMode: 'numeric',
        submitLabel: 'Draw',
        validate: (value) =>
          /^\d+$/u.test(value.trim()) ? null : 'Please enter a number.',
      })
    );
    await settle();

    const popup = dialog();
    expect(popup?.getAttribute('role')).toBe('dialog');
    const input = field();
    expect(input.value).toBe('1');
    expect(input.inputMode).toBe('numeric');
    expect(document.activeElement).toBe(input);
    const label = document.querySelector(`label[for="${input.id}"]`);
    expect(label?.textContent).toBe('Number of cards');
    expect(button('submit').textContent).toBe('Draw');

    await typeInto(input, 'lots');
    await submitForm(input);
    await settle();
    expect(answer.settled).toBe(false);
    expect(dialog()).not.toBeNull();
    const error = document.querySelector('[role="alert"]');
    expect(error?.textContent).toBe('Please enter a number.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(error?.id);

    await typeInto(input, '4');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await submitForm(input);
    await settle();
    expect(answer).toEqual({ settled: true, value: '4' });
    expect(dialog()).toBeNull();
  });

  it('resolves null when cancelled, whatever was typed', async () => {
    await mountHost();
    const answer = await ask(() =>
      promptValue({ title: 'Card back', label: 'URL' })
    );
    await settle();
    await typeInto(field(), 'https://example.test/back.png');
    await click(button('cancel'));
    await settle();
    expect(answer).toEqual({ settled: true, value: null });
  });

  it('keeps the dialog busy while an async check runs, then shows its answer', async () => {
    await mountHost();
    const checks: {
      value: string;
      resolve: (message: string | null) => void;
      signal: AbortSignal;
    }[] = [];
    const answer = await ask(() =>
      promptValue({
        title: 'Background',
        label: 'Image URL',
        validate: (value, { signal }) =>
          new Promise<string | null>((resolve) => {
            checks.push({ value, resolve, signal });
          }),
      })
    );
    await settle();
    await typeInto(field(), 'https://example.test/missing.png');
    await submitForm(field());
    await settle();
    expect(checks).toHaveLength(1);
    expect(button('submit').disabled).toBe(true);
    expect(button('submit').textContent).toBe('Checking…');
    expect(field().readOnly).toBe(true);

    await act(async () =>
      checks[0]?.resolve('Please enter a valid image URL.')
    );
    await settle();
    expect(answer.settled).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Please enter a valid image URL.'
    );
    expect(button('submit').disabled).toBe(false);

    await typeInto(field(), 'https://example.test/found.png');
    await submitForm(field());
    await settle();
    await act(async () => checks[1]?.resolve(null));
    await settle();
    expect(answer).toEqual({
      settled: true,
      value: 'https://example.test/found.png',
    });
  });

  it('abandons a running check when the player cancels', async () => {
    await mountHost();
    let check: { signal: AbortSignal; resolve: (m: null) => void } | undefined;
    const answer = await ask(() =>
      promptValue({
        title: 'Background',
        label: 'Image URL',
        validate: (_value, { signal }) =>
          new Promise<null>((resolve) => {
            check = { signal, resolve };
          }),
      })
    );
    await settle();
    await submitForm(field());
    await settle();
    await pressKey(field(), 'Escape');
    await settle();
    expect(answer).toEqual({ settled: true, value: null });
    expect(check?.signal.aborted).toBe(true);
    await act(async () => check?.resolve(null));
    expect(answer.value).toBeNull();
  });
});

describe('toast', () => {
  it('shows notices raised before the host existed, with their tone', async () => {
    await inAct(() =>
      toast({
        title: 'Saved game resumed',
        body: 'An invitation was copied to your clipboard.',
        tone: 'success',
      })
    );
    await mountHost();
    await settle();
    const notice = document.querySelector<HTMLElement>(
      '[data-ptcgsim-overlay="toast"]'
    );
    expect(notice?.dataset.tone).toBe('success');
    expect(notice?.textContent).toContain('Saved game resumed');
    expect(notice?.textContent).toContain(
      'An invitation was copied to your clipboard.'
    );
    expect(
      notice?.querySelector('[aria-label="Dismiss notification"]')
    ).not.toBeNull();
  });

  it('stacks notices and dismisses them by id', async () => {
    await mountHost();
    const { result: first } = await inAct(() =>
      toast({ title: 'Could not save', tone: 'danger' })
    );
    await inAct(() => toast({ title: 'Second notice' }));
    await settle();
    expect(
      document.querySelectorAll('[data-ptcgsim-overlay="toast"]')
    ).toHaveLength(2);
    await inAct(() => dismissToast(first));
    await settle(10);
    const remaining = [
      ...document.querySelectorAll('[data-ptcgsim-overlay="toast"]'),
    ].map((element) => element.textContent);
    expect(remaining).toEqual(['Second notice']);
  });
});

describe('Tooltip', () => {
  it('labels its trigger on keyboard focus', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    hosts.push(element);
    const root = createRoot(element);
    roots.push(root);
    await act(async () => {
      root.render(
        <OverlayHost>
          <Tooltip content="Shuffle (Alt+S)" delay={0}>
            <button type="button" data-testid="trigger">
              Shuffle
            </button>
          </Tooltip>
        </OverlayHost>
      );
    });
    const trigger = element.querySelector<HTMLButtonElement>(
      '[data-testid="trigger"]'
    );
    expect(trigger?.textContent).toBe('Shuffle');
    await act(async () => {
      trigger?.focus();
      trigger?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    await settle();
    const tip = document.querySelector('[data-ptcgsim-overlay="tooltip"]');
    expect(tip?.textContent).toBe('Shuffle (Alt+S)');
    expect(isOverlaySurfaceTarget(tip)).toBe(true);
    expect(isOverlaySurfaceTarget(trigger)).toBe(false);
  });
});
