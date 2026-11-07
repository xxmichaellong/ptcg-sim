/**
 * Every overlay portal and surface (dialog panel and scrim, toast, tooltip)
 * carries this attribute, so document-level handlers -- the board's keyboard
 * shortcuts, its outside-press dismissals -- can tell a key or a press inside
 * a dialog from one meant for the table. Native dialogs swallowed both.
 */
export const OVERLAY_SURFACE_ATTRIBUTE = 'data-ptcgsim-overlay';

const surfaceOf = (target: EventTarget | null): Element | null =>
  typeof Element !== 'undefined' && target instanceof Element
    ? target.closest(`[${OVERLAY_SURFACE_ATTRIBUTE}]`)
    : null;

/** Whether a press landed on an overlay (including a dialog's scrim). */
export const isOverlaySurfaceTarget = (target: EventTarget | null): boolean =>
  surfaceOf(target) !== null;

/**
 * Whether a key pressed on `target` belongs to an overlay. A dialog that has
 * been answered and is only animating out no longer owns the keyboard, so a
 * quick next shortcut still reaches the table.
 */
export const isOverlayKeyTarget = (target: EventTarget | null): boolean => {
  if (surfaceOf(target) === null) return false;
  const dialog = (target as Element).closest(
    `[${OVERLAY_SURFACE_ATTRIBUTE}="dialog"], [${OVERLAY_SURFACE_ATTRIBUTE}="alert"]`
  );
  return dialog === null || !dialog.hasAttribute('data-closed');
};

/**
 * Whether a modal sheet or dialog is open. It hears Esc on the page (Base
 * UI), the focus in it or not yet (a card's sheet just opened from its
 * row), so a screen under it leaves Esc to it.
 */
export const isModalWindowOpen = (): boolean =>
  typeof document !== 'undefined' &&
  document.querySelector(
    '.ptcgsim-sheet-viewport[data-modal="true"] .ptcgsim-sheet[data-open], .ptcgsim-ui-dialog[data-open]'
  ) !== null;
