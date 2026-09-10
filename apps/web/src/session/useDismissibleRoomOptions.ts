import { useEffect, useRef, useState } from 'react';

/** One owner for the temporary outside-press listener shared by room menus. */
export const useDismissibleRoomOptions = () => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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
    globalThis.document.addEventListener('mousedown', dismiss);
    return () => globalThis.document.removeEventListener('mousedown', dismiss);
  }, [open]);

  return { open, setOpen, buttonRef, menuRef };
};
