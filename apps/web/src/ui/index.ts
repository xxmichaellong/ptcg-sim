/**
 * Overlay primitives (ADR-027): one dialog, confirm, prompt, toast and
 * tooltip set with shared look, motion and focus behaviour. Mount
 * `OverlayHost` once per React root; then `confirmAction`, `promptValue` and
 * `toast` work from anywhere.
 */
export {
  UiButton,
  type UiButtonProps,
  type UiButtonVariant,
} from './Button.js';
export {
  ConfirmDialog,
  Dialog,
  DialogCloseButton,
  PromptDialog,
  type ConfirmDialogProps,
  type DialogProps,
  type PromptDialogProps,
} from './Dialog.js';
export {
  cancelAllDialogRequests,
  confirmAction,
  promptValue,
  type ConfirmOptions,
  type DialogFinalFocus,
  type DialogTone,
  type PromptOptions,
  type PromptValidationContext,
  type PromptValidator,
} from './dialog-requests.js';
export { OverlayHost, type OverlayHostProps } from './OverlayHost.js';
export {
  isOverlayKeyTarget,
  isOverlaySurfaceTarget,
  OVERLAY_SURFACE_ATTRIBUTE,
} from './overlay-surface.js';
export {
  dismissToast,
  toast,
  type ToastOptions,
  type ToastTone,
} from './toast.js';
export { Tooltip, TooltipProvider, type TooltipProps } from './Tooltip.js';
