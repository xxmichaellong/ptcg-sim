import { useEffect, type RefObject } from 'react';

/** The visual viewport's say, as `window.visualViewport` gives it. */
interface VisualViewportLike {
  readonly height: number;
  readonly offsetTop: number;
  readonly scale: number;
}

/**
 * How much of the page's bottom an on-screen keyboard covers. Safari and
 * Chrome keep the page its height and lay the keyboard over its foot, so
 * what still shows is the visual viewport; a zoomed-in page shows less of
 * itself too, but that is no keyboard.
 */
export const keyboardInsetOf = (
  layoutHeight: number,
  viewport: VisualViewportLike | null | undefined
): number =>
  viewport && viewport.scale <= 1.01
    ? Math.max(
        0,
        Math.round(layoutHeight - viewport.offsetTop - viewport.height)
      )
    : 0;

/** A field a keyboard types into. */
const takesTyping = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLInputElement &&
    /^(?:search|text|email|url|tel|number|password)$/u.test(element.type));

/**
 * Keeps `--keyboard-inset` on an element the height an on-screen keyboard
 * covers, so a list can pad its end and scroll its last rows above it. As
 * the room left changes, a field in it being typed into stays in sight.
 */
export const useKeyboardInset = (ref: RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    const element = ref.current;
    const viewport = globalThis.visualViewport;
    if (!element || !viewport) return;
    const measure = () => {
      element.style.setProperty(
        '--keyboard-inset',
        `${String(keyboardInsetOf(globalThis.innerHeight, viewport))}px`
      );
    };
    const resized = () => {
      measure();
      const field = document.activeElement;
      if (takesTyping(field) && element.contains(field))
        field.scrollIntoView({ block: 'nearest' });
    };
    measure();
    viewport.addEventListener('resize', resized);
    viewport.addEventListener('scroll', measure);
    return () => {
      viewport.removeEventListener('resize', resized);
      viewport.removeEventListener('scroll', measure);
      element.style.removeProperty('--keyboard-inset');
    };
  }, [ref]);
};
