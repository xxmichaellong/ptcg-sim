/**
 * Overlay primitives (ADR-027): one dialog, confirm, prompt, toast and
 * tooltip set with shared look, motion and focus behaviour. Mount
 * `OverlayHost` once per React root; then `confirmAction`, `promptValue`,
 * `pickCount` and `toast` work from anywhere.
 */
export {
  UiButton,
  type UiButtonProps,
  type UiButtonVariant,
} from './Button.js';
export {
  ConfirmDialog,
  CountDialog,
  Dialog,
  DialogCloseButton,
  PromptDialog,
  type ConfirmDialogProps,
  type CountDialogProps,
  type DialogProps,
  type PromptDialogProps,
} from './Dialog.js';
export {
  cancelAllDialogRequests,
  confirmAction,
  pickCount,
  promptValue,
  type ConfirmOptions,
  type CountOptions,
  type DialogFinalFocus,
  type DialogTone,
  type PromptOptions,
  type PromptValidationContext,
  type PromptValidator,
} from './dialog-requests.js';
export { OverlayHost, type OverlayHostProps } from './OverlayHost.js';
export {
  Sheet,
  type SheetPlacement,
  type SheetProps,
  type SheetSize,
} from './Sheet.js';
export {
  COARSE_POINTER_QUERY,
  COMPACT_QUERY,
  MEDIUM_QUERY,
  useCompactLayout,
  useMediaQuery,
} from './breakpoints.js';
export {
  isOverlayKeyTarget,
  isOverlaySurfaceTarget,
  OVERLAY_SURFACE_ATTRIBUTE,
} from './overlay-surface.js';
export {
  dismissToast,
  toast,
  type ToastAction,
  type ToastOptions,
  type ToastTone,
} from './toast.js';
export { Tooltip, TooltipProvider, type TooltipProps } from './Tooltip.js';
