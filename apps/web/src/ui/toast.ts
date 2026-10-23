import { Toast } from '@base-ui/react/toast';

/**
 * Short, non-blocking notices: a save that worked, a file that could not be
 * read. They stack bottom-centre above the hand and dismiss themselves.
 * `toast()` works from anywhere -- before the host has mounted, too: notices
 * raised early wait here until a host connects.
 */

export type ToastTone = 'default' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  readonly title: string;
  readonly body?: string;
  readonly tone?: ToastTone;
  /** Milliseconds before it dismisses itself; `0` keeps it until closed. */
  readonly timeout?: number;
  /** Re-using an id replaces that notice instead of stacking another. */
  readonly id?: string;
}

export const DEFAULT_TOAST_TIMEOUT_MS = 5000;
const DANGER_TOAST_TIMEOUT_MS = 8000;
const MAX_PENDING_TOASTS = 8;

/** The Base UI manager the connected `Toast.Provider` listens to. */
export const toastManager = Toast.createToastManager();

// Counted, not a flag: when the active host changes, the new one can connect
// before the old one has disconnected.
let connections = 0;
let pending: readonly (ToastOptions & { readonly id: string })[] = [];
let nextToastId = 1;

const deliver = (options: ToastOptions & { readonly id: string }): void => {
  const tone = options.tone ?? 'default';
  toastManager.add({
    id: options.id,
    title: options.title,
    ...(options.body ? { description: options.body } : {}),
    type: tone,
    priority: tone === 'danger' ? 'high' : 'low',
    timeout:
      options.timeout ??
      (tone === 'danger' ? DANGER_TOAST_TIMEOUT_MS : DEFAULT_TOAST_TIMEOUT_MS),
  });
};

/** Shows a notice; returns its id. */
export const toast = (options: ToastOptions): string => {
  const id = options.id ?? `ptcgsim-toast-${nextToastId++}`;
  const request = { ...options, id };
  if (connections > 0) {
    deliver(request);
  } else {
    pending = [...pending.filter((queued) => queued.id !== id), request].slice(
      -MAX_PENDING_TOASTS
    );
  }
  return id;
};

/** Closes one notice, or every notice when no id is given. */
export const dismissToast = (id?: string): void => {
  if (connections === 0) {
    pending = id === undefined ? [] : pending.filter((t) => t.id !== id);
    return;
  }
  toastManager.close(id);
};

/**
 * Called by the active host once its provider is listening (and again with
 * `false` when it unmounts). Notices raised while no host listened are
 * delivered now.
 */
export const connectToastHost = (isConnected: boolean): void => {
  connections = Math.max(0, connections + (isConnected ? 1 : -1));
  if (!isConnected) return;
  const queued = pending;
  pending = [];
  for (const request of queued) deliver(request);
};
