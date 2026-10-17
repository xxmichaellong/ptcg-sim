/** Keyboard boundary for the custom card surfaces that are not Base UI dialogs. */
const TABBABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), iframe, [tabindex]:not([tabindex="-1"])';

const canTabTo = (item: HTMLElement): boolean => {
  if (
    item.tabIndex < 0 ||
    item.matches(':disabled, input[type="hidden"]') ||
    item.closest('[hidden], [inert], [aria-hidden="true"]')
  )
    return false;
  const view = item.ownerDocument.defaultView;
  for (let node: HTMLElement | null = item; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden')
      return false;
  }
  return true;
};

export const trapFocus = (
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  container: HTMLElement,
  selector = TABBABLE
): void => {
  if (event.key !== 'Tab') return;
  const items = [...container.querySelectorAll<HTMLElement>(selector)].filter(
    canTabTo
  );
  const active = container.ownerDocument.activeElement;
  const outside = !container.contains(active) || active === container;
  if (items.length === 0) {
    event.preventDefault();
    container.focus({ preventScroll: true });
  } else if (
    outside ||
    (event.shiftKey ? active === items[0] : active === items.at(-1))
  ) {
    event.preventDefault();
    (event.shiftKey ? items.at(-1) : items[0])?.focus({ preventScroll: true });
  }
};
