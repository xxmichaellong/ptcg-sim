import type { ReactNode } from 'react';

/**
 * The imperative side of the overlay primitives: `confirmAction` and
 * `promptValue` queue a request here and resolve when the player answers.
 * One `DialogHost` (inside `OverlayHost`) renders the front of the queue, so
 * any code -- an event handler, a keyboard shortcut, a plain module -- can
 * ask a question without owning any React state. Requests are answered in
 * the order they were asked, one dialog at a time.
 */

export type DialogTone = 'default' | 'danger';

export interface ConfirmOptions {
  readonly title: string;
  readonly body?: ReactNode;
  /** Defaults to "Confirm". */
  readonly confirmLabel?: string;
  /** Defaults to "Cancel". */
  readonly cancelLabel?: string;
  /** `danger` paints the confirm button red. */
  readonly tone?: DialogTone;
  /** Aborting closes the dialog and resolves `false`. */
  readonly signal?: AbortSignal;
  /** See `DialogFinalFocus`. */
  readonly finalFocus?: DialogFinalFocus;
}

/**
 * Where focus goes once the dialog has closed. By default it returns to
 * whatever had focus when the dialog opened; a caller whose opener may be
 * gone by then (a pile browser that the answer closes) names a better place.
 * Returning nothing falls back to the default.
 */
export type DialogFinalFocus = () => HTMLElement | null | undefined;

export interface PromptValidationContext {
  /** Aborted when the dialog closes or the player submits again. */
  readonly signal: AbortSignal;
}

/**
 * Returns an error message to keep the dialog open, or nothing to accept the
 * value. May be async (an image preload, say); the dialog shows it is busy.
 */
export type PromptValidator = (
  value: string,
  context: PromptValidationContext
) => string | null | undefined | PromiseLike<string | null | undefined>;

export interface PromptOptions {
  readonly title: string;
  readonly body?: ReactNode;
  /** The input's visible label. */
  readonly label: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly inputMode?: 'numeric' | 'text';
  /** Defaults to "OK". */
  readonly submitLabel?: string;
  /** Defaults to "Cancel". */
  readonly cancelLabel?: string;
  readonly validate?: PromptValidator;
  /** Aborting closes the dialog and resolves `null`. */
  readonly signal?: AbortSignal;
  /** See `DialogFinalFocus`. */
  readonly finalFocus?: DialogFinalFocus;
}

export type DialogRequest =
  | {
      readonly kind: 'confirm';
      readonly id: number;
      readonly options: ConfirmOptions;
    }
  | {
      readonly kind: 'prompt';
      readonly id: number;
      readonly options: PromptOptions;
    };

type Settle = (answer: boolean | string | null) => void;

let nextRequestId = 1;
let queue: readonly DialogRequest[] = [];
const settlers = new Map<number, Settle>();
const listeners = new Set<() => void>();

const publish = (): void => {
  for (const listener of [...listeners]) listener();
};

export const subscribeDialogRequests = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The pending requests, oldest first. The front one is on screen. */
export const dialogRequestsSnapshot = (): readonly DialogRequest[] => queue;

const enqueue = <Answer extends boolean | string | null>(
  request: DialogRequest,
  signal: AbortSignal | undefined,
  cancelled: Answer
): Promise<Answer> =>
  new Promise<Answer>((resolve) => {
    if (signal?.aborted) {
      resolve(cancelled);
      return;
    }
    const handleAbort = (): void => settleDialogRequest(request.id, cancelled);
    settlers.set(request.id, (answer) => {
      signal?.removeEventListener('abort', handleAbort);
      resolve(answer as Answer);
    });
    signal?.addEventListener('abort', handleAbort, { once: true });
    queue = [...queue, request];
    publish();
  });

/**
 * Answers one request and takes it off the queue. Later answers to the same
 * request are ignored, so a click racing an abort can never resolve twice.
 */
export const settleDialogRequest = (
  id: number,
  answer: boolean | string | null
): void => {
  const settle = settlers.get(id);
  if (!settle) return;
  settlers.delete(id);
  queue = queue.filter((request) => request.id !== id);
  publish();
  settle(answer);
};

/** Cancels every pending request, as if each one had been dismissed. */
export const cancelAllDialogRequests = (): void => {
  for (const request of [...queue]) {
    settleDialogRequest(request.id, request.kind === 'confirm' ? false : null);
  }
};

/** Asks a yes/no question; resolves `true` only when the player confirms. */
export const confirmAction = (options: ConfirmOptions): Promise<boolean> =>
  enqueue(
    { kind: 'confirm', id: nextRequestId++, options },
    options.signal,
    false
  );

/**
 * Asks for one line of text; resolves the accepted value, or `null` when the
 * player cancels. A validator keeps the dialog open with its message.
 */
export const promptValue = (options: PromptOptions): Promise<string | null> =>
  enqueue<string | null>(
    { kind: 'prompt', id: nextRequestId++, options },
    options.signal,
    null
  );
