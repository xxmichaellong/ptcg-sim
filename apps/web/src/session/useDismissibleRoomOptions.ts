import { useEffect, useRef, useState } from 'react';

/** Room menus share dismissal, keyboard navigation and focus return. */
export const useDismissibleRoomOptions = () => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const button = buttonRef.current;
    const items = () =>
      [
        ...(menu?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not(:disabled)'
        ) ?? []),
      ].filter((item) => !item.closest('[hidden], [inert]'));
    items()[0]?.focus({ preventScroll: true });
    const dismiss = (event: MouseEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        (buttonRef.current?.contains(target) ||
          menuRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    const navigate = (event: KeyboardEvent): void => {
      if (
        !(event.target instanceof Node) ||
        (!menu?.contains(event.target) && !button?.contains(event.target))
      )
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        button?.focus({ preventScroll: true });
        return;
      }
      if (event.key === 'Tab') {
        // Keep native tab order after the trigger when the menu disappears.
        button?.focus({ preventScroll: true });
        setOpen(false);
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const enabled = items();
      if (!enabled.length) return;
      event.preventDefault();
      event.stopPropagation();
      const current = enabled.indexOf(
        document.activeElement as HTMLButtonElement
      );
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? enabled.length - 1
            : (current + (event.key === 'ArrowUp' ? -1 : 1) + enabled.length) %
              enabled.length;
      enabled[next]?.focus({ preventScroll: true });
    };
    globalThis.document.addEventListener('mousedown', dismiss);
    globalThis.document.addEventListener('keydown', navigate, true);
    return () => {
      globalThis.document.removeEventListener('mousedown', dismiss);
      globalThis.document.removeEventListener('keydown', navigate, true);
      if (menu?.contains(document.activeElement))
        button?.focus({ preventScroll: true });
    };
  }, [open]);

  return { open, setOpen, buttonRef, menuRef };
};
