import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type FormEventHandler,
  type ReactNode,
  type RefObject,
} from 'react';

import { UiButton } from './Button.js';
import type {
  ConfirmOptions,
  DialogFinalFocus,
  DialogTone,
  PromptOptions,
} from './dialog-requests.js';
import { OverlayContainerContext } from './overlay-host-registry.js';
import { OVERLAY_SURFACE_ATTRIBUTE } from './overlay-surface.js';
import './overlays.css';

interface DialogSurfaceProps {
  /** `alert` is a Base UI AlertDialog: role=alertdialog, no outside dismiss. */
  readonly kind: 'dialog' | 'alert';
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Runs after the enter or exit animation has finished. */
  readonly onOpenChangeComplete?: (open: boolean) => void;
  /** Whether a press on the scrim closes a plain dialog. Defaults to true. */
  readonly dismissible?: boolean;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly tone?: DialogTone;
  readonly initialFocus?: RefObject<HTMLElement | null>;
  readonly finalFocus?: DialogFinalFocus;
  /** Wraps the content in a form, so Enter in a field submits it. */
  readonly onSubmit?: FormEventHandler<HTMLFormElement>;
  readonly className?: string;
  readonly children?: ReactNode;
}

const hasContent = (node: ReactNode): boolean =>
  node !== undefined && node !== null && node !== false && node !== '';

/**
 * The shared frame: scrim, centring viewport and the glass panel, with the
 * title and description wired up as the dialog's accessible name and
 * description. Alert and plain dialogs share every part but the root.
 */
const DialogSurface = ({
  kind,
  open,
  onOpenChange,
  onOpenChangeComplete,
  dismissible = true,
  title,
  description,
  tone = 'default',
  initialFocus,
  finalFocus,
  onSubmit,
  className,
  children,
}: DialogSurfaceProps) => {
  const container = useContext(OverlayContainerContext);
  const popupRef = useRef<HTMLDivElement>(null);
  // What had focus as the dialog opened, read before Base UI moves focus in.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [trackedOpen, setTrackedOpen] = useState(false);
  if (open !== trackedOpen) {
    setTrackedOpen(open);
    if (open) {
      const active =
        typeof document === 'undefined' ? null : document.activeElement;
      setOpener(
        active instanceof HTMLElement && active !== active.ownerDocument.body
          ? active
          : null
      );
    }
  }
  const returnTarget = (): HTMLElement | null =>
    finalFocus?.() ?? (opener?.isConnected ? opener : null);
  // Once answered, the dialog only animates out. Hand focus back at once,
  // not after the animation, so the very next key reaches the table (a
  // focused field in a closing dialog would swallow it).
  useLayoutEffect(() => {
    if (open) return;
    const popup = popupRef.current;
    const active = popup?.ownerDocument.activeElement;
    if (!popup || !(active instanceof HTMLElement) || !popup.contains(active)) {
      return;
    }
    const target = returnTarget();
    if (target) target.focus({ preventScroll: true });
    else active.blur();
    // Only the transition to closed matters; the target is read then.
  }, [open]);
  const content = (
    <>
      <BaseDialog.Title className="ptcgsim-ui-dialog__title">
        {title}
      </BaseDialog.Title>
      {hasContent(description) ? (
        <BaseDialog.Description className="ptcgsim-ui-dialog__description">
          {description}
        </BaseDialog.Description>
      ) : null}
      {children}
    </>
  );
  const parts = (
    <BaseDialog.Portal
      container={container}
      {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'portal' }}
    >
      <BaseDialog.Backdrop className="ptcgsim-ui-scrim" />
      <BaseDialog.Viewport className="ptcgsim-ui-viewport">
        <BaseDialog.Popup
          className={
            className ? `ptcgsim-ui-dialog ${className}` : 'ptcgsim-ui-dialog'
          }
          data-tone={tone}
          {...{ [OVERLAY_SURFACE_ATTRIBUTE]: kind }}
          ref={popupRef}
          {...(initialFocus ? { initialFocus } : {})}
          finalFocus={() => {
            // Focus was handed back when the dialog was answered, or the
            // player has moved on since: leave it where it is.
            const popup = popupRef.current;
            const active = popup?.ownerDocument.activeElement;
            if (
              active &&
              active !== popup.ownerDocument.body &&
              !popup.contains(active)
            ) {
              return false;
            }
            // Otherwise back to what had focus before it opened. Nothing
            // (it was the page itself) means nothing: never guess at an
            // older focus that may be a field which would swallow keys.
            return returnTarget() ?? false;
          }}
        >
          {onSubmit ? (
            <form
              className="ptcgsim-ui-dialog__form"
              noValidate
              onSubmit={onSubmit}
            >
              {content}
            </form>
          ) : (
            content
          )}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
  const handleOpenChange = (next: boolean): void => onOpenChange(next);
  return kind === 'alert' ? (
    <AlertDialog.Root
      open={open}
      onOpenChange={handleOpenChange}
      {...(onOpenChangeComplete ? { onOpenChangeComplete } : {})}
    >
      {parts}
    </AlertDialog.Root>
  ) : (
    <BaseDialog.Root
      open={open}
      onOpenChange={handleOpenChange}
      disablePointerDismissal={!dismissible}
      {...(onOpenChangeComplete ? { onOpenChangeComplete } : {})}
    >
      {parts}
    </BaseDialog.Root>
  );
};

export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenChangeComplete?: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Buttons along the bottom edge, right-aligned. */
  readonly actions?: ReactNode;
  readonly dismissible?: boolean;
  readonly initialFocus?: RefObject<HTMLElement | null>;
  readonly finalFocus?: DialogFinalFocus;
  readonly className?: string;
  readonly children?: ReactNode;
}

/** A modal panel with a title, optional description, content and actions. */
export const Dialog = ({ actions, children, ...props }: DialogProps) => (
  <DialogSurface kind="dialog" {...props}>
    {children}
    {hasContent(actions) ? (
      <div className="ptcgsim-ui-dialog__actions">{actions}</div>
    ) : null}
  </DialogSurface>
);

/** A secondary button that closes the surrounding dialog. */
export const DialogCloseButton = ({ children }: { children: ReactNode }) => (
  <BaseDialog.Close className="ptcgsim-ui-button" data-variant="secondary">
    {children}
  </BaseDialog.Close>
);

export interface ConfirmDialogProps extends Omit<ConfirmOptions, 'signal'> {
  readonly open: boolean;
  /** `false` for Cancel, Escape or a closed dialog. */
  readonly onResolve: (confirmed: boolean) => void;
  /** After the exit animation, once the dialog has left the screen. */
  readonly onClosed?: () => void;
}

/**
 * A yes/no question (role=alertdialog). It opens on its confirm button, as
 * v1's browser confirm() did, so Enter answers yes and Escape answers no.
 */
export const ConfirmDialog = ({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  finalFocus,
  onResolve,
  onClosed,
}: ConfirmDialogProps) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <DialogSurface
      kind="alert"
      open={open}
      onOpenChange={(next) => {
        if (!next) onResolve(false);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed?.();
      }}
      title={title}
      description={body}
      tone={tone}
      // v1 asked with the browser's confirm(), where Enter means OK: every
      // tone keeps that keystroke, a dangerous one is only painted red.
      initialFocus={confirmRef}
      {...(finalFocus ? { finalFocus } : {})}
    >
      <div className="ptcgsim-ui-dialog__actions">
        <BaseDialog.Close
          className="ptcgsim-ui-button"
          data-variant="secondary"
          data-dialog-action="cancel"
        >
          {cancelLabel}
        </BaseDialog.Close>
        <UiButton
          ref={confirmRef}
          variant={tone === 'danger' ? 'danger' : 'primary'}
          data-dialog-action="confirm"
          onClick={() => onResolve(true)}
        >
          {confirmLabel}
        </UiButton>
      </div>
    </DialogSurface>
  );
};

const VALIDATION_FAILED = 'That value could not be checked. Please try again.';

const isPromiseLike = <T,>(value: unknown): value is PromiseLike<T> =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { then?: unknown }).then === 'function';

export interface PromptDialogProps extends Omit<PromptOptions, 'signal'> {
  readonly open: boolean;
  /** The accepted value, or `null` for Cancel, Escape or a closed dialog. */
  readonly onResolve: (value: string | null) => void;
  /** After the exit animation, once the dialog has left the screen. */
  readonly onClosed?: () => void;
}

/**
 * One labelled text field. Enter submits; a validator's message keeps the
 * dialog open under the field, and an async validator shows the dialog busy
 * until it answers.
 */
export const PromptDialog = ({
  open,
  title,
  body,
  label,
  defaultValue = '',
  placeholder,
  inputMode = 'text',
  submitLabel = 'OK',
  cancelLabel = 'Cancel',
  validate,
  finalFocus,
  onResolve,
  onClosed,
}: PromptDialogProps) => {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedOnce = useRef(false);
  const validation = useRef<AbortController | undefined>(undefined);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    if (open) return;
    validation.current?.abort();
    validation.current = undefined;
  }, [open]);
  useEffect(
    () => () => {
      validation.current?.abort();
      validation.current = undefined;
    },
    []
  );

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!open || checking) return;
    validation.current?.abort();
    const controller = new AbortController();
    validation.current = controller;
    const submitted = value;
    const finish = (message: string | null | undefined): void => {
      if (controller.signal.aborted || validation.current !== controller) {
        return;
      }
      validation.current = undefined;
      setChecking(false);
      if (message) {
        setError(message);
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      onResolve(submitted);
    };
    let outcome: ReturnType<NonNullable<typeof validate>>;
    try {
      outcome = validate?.(submitted, { signal: controller.signal });
    } catch {
      finish(VALIDATION_FAILED);
      return;
    }
    if (isPromiseLike<string | null | undefined>(outcome)) {
      setError(null);
      setChecking(true);
      Promise.resolve(outcome).then(finish, () => finish(VALIDATION_FAILED));
      return;
    }
    finish(outcome);
  };

  return (
    <DialogSurface
      kind="dialog"
      open={open}
      onOpenChange={(next) => {
        if (!next) onResolve(null);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed?.();
      }}
      dismissible={false}
      title={title}
      description={body}
      initialFocus={inputRef}
      {...(finalFocus ? { finalFocus } : {})}
      onSubmit={submit}
    >
      <div className="ptcgsim-ui-field" data-invalid={error ? '' : undefined}>
        <label className="ptcgsim-ui-field__label" htmlFor={inputId}>
          {label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="ptcgsim-ui-field__input"
          type="text"
          value={value}
          inputMode={inputMode}
          {...(inputMode === 'numeric' ? { pattern: '[0-9]*' } : {})}
          {...(placeholder ? { placeholder } : {})}
          autoComplete="off"
          spellCheck={false}
          readOnly={checking}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onFocus={(event) => {
            // Like the native prompt, the suggested value starts selected so
            // typing replaces it.
            if (selectedOnce.current) return;
            selectedOnce.current = true;
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            if (error) setError(null);
          }}
        />
        {error ? (
          <p id={errorId} className="ptcgsim-ui-field__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="ptcgsim-ui-dialog__actions">
        <BaseDialog.Close
          className="ptcgsim-ui-button"
          data-variant="secondary"
          data-dialog-action="cancel"
        >
          {cancelLabel}
        </BaseDialog.Close>
        <UiButton
          type="submit"
          variant="primary"
          data-dialog-action="submit"
          disabled={checking}
          aria-busy={checking ? true : undefined}
        >
          {checking ? 'Checking…' : submitLabel}
        </UiButton>
      </div>
    </DialogSurface>
  );
};
