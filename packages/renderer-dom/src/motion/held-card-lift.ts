/**
 * The card in the hand, over the windows open on the table.
 *
 * The board surface is its own stacking context below the table's viewers
 * (the "Looking at cards" and attached-cards windows, a pile's viewer), so a
 * card held there would pass under a window it is carried over -- even the
 * window it is about to be dropped into. While a card is held and a window
 * is open, the lift layer (a sibling of the surface, on --table-layer-drag)
 * shows an exact copy of every held card and its markers, kept in step
 * frame by frame with the original, which stays where it is (it holds the pointer) but unseen.
 * The copy carries no identity -- no card id, role or label -- so the table
 * still has one card, and assistive technology and tests read the original.
 * A card flying out of a viewer (`data-over-windows`) is shown there too
 * until it lands, or its whole flight would pass under the viewer.
 */

/** Attributes a copy never takes from its original. */
const IDENTITY = new Set([
  'id',
  'role',
  'tabindex',
  'data-card-id',
  'data-marker-id',
  'data-marker-parent-card-id',
  'data-marker-hint-id',
  'data-board-hint',
  'data-lifted',
  'aria-label',
  'aria-haspopup',
  'aria-pressed',
  'aria-describedby',
]);

const copyAttributes = (from: Element, to: Element): void => {
  for (const attribute of Array.from(from.attributes)) {
    if (IDENTITY.has(attribute.name)) continue;
    if (to.getAttribute(attribute.name) !== attribute.value)
      to.setAttribute(attribute.name, attribute.value);
  }
  for (const attribute of Array.from(to.attributes)) {
    if (attribute.name === 'data-lift-copy') continue;
    if (!from.hasAttribute(attribute.name) || IDENTITY.has(attribute.name))
      to.removeAttribute(attribute.name);
  }
};

/** Whether `to` still has the shape of `from`, node for node. */
const sameShape = (from: Element, to: Element): boolean => {
  if (from.tagName !== to.tagName) return false;
  if (from.childNodes.length !== to.childNodes.length) return false;
  for (let index = 0; index < from.childNodes.length; index += 1) {
    const original = from.childNodes[index]!;
    const copy = to.childNodes[index]!;
    if (original.nodeType !== copy.nodeType) return false;
    if (
      original.nodeType === 1 &&
      !sameShape(original as Element, copy as Element)
    )
      return false;
  }
  return true;
};

const follow = (from: Element, to: Element): void => {
  copyAttributes(from, to);
  for (let index = 0; index < from.childNodes.length; index += 1) {
    const original = from.childNodes[index]!;
    const copy = to.childNodes[index]!;
    if (original.nodeType === 1) {
      follow(original as Element, copy as Element);
    } else if (copy.nodeValue !== original.nodeValue) {
      copy.nodeValue = original.nodeValue;
    }
  }
};

/** A cloned canvas is blank: each copy is drawn from its original. */
const paintCanvases = (from: Element, to: Element): void => {
  const originals = from.querySelectorAll('canvas');
  const copies = to.querySelectorAll('canvas');
  for (let index = 0; index < originals.length; index += 1) {
    const original = originals[index]!;
    const copy = copies[index];
    if (!copy || original.width === 0 || original.height === 0) continue;
    try {
      copy.getContext('2d')?.drawImage(original, 0, 0);
    } catch {
      // Unreadable or unsupported: the copy stays as cloned.
    }
  }
};

const copyOf = (original: HTMLElement): HTMLElement => {
  const copy = original.cloneNode(true) as HTMLElement;
  copy.setAttribute('data-lift-copy', '');
  follow(original, copy);
  paintCanvases(original, copy);
  return copy;
};

/**
 * Shows the surface's held cards on `layer` until the returned function is
 * called. `layer` lies exactly over the surface; its first child stands for
 * the surface's table (`.ptcgsim-board-table`), whose motion it follows.
 */
export const liftHeldCards = (
  surface: HTMLElement,
  layer: HTMLElement
): (() => void) => {
  const view = surface.ownerDocument.defaultView;
  const stage = layer.firstElementChild as HTMLElement | null;
  if (!view || !stage) return () => undefined;
  const copies = new Map<HTMLElement, HTMLElement>();
  let frame: number | null = null;
  const tick = (): void => {
    frame = null;
    // The layer carries the surface's state, so the board's own styles
    // (reduced motion, the table view) dress the copies as the originals.
    for (const attribute of Array.from(surface.attributes))
      if (
        attribute.name.startsWith('data-') &&
        layer.getAttribute(attribute.name) !== attribute.value
      )
        layer.setAttribute(attribute.name, attribute.value);
    layer.style.left = `${String(surface.offsetLeft)}px`;
    layer.style.top = `${String(surface.offsetTop)}px`;
    layer.style.width = `${String(surface.offsetWidth)}px`;
    layer.style.height = `${String(surface.offsetHeight)}px`;
    const table = surface.querySelector<HTMLElement>('.ptcgsim-board-table');
    if (table) stage.style.cssText = table.style.cssText;
    const held = new Set(
      Array.from(
        surface.querySelectorAll<HTMLElement>(
          '.ptcgsim-card[data-held="drag"]:not([data-lift-copy]), .ptcgsim-card[data-over-windows]:not([data-lift-copy])'
        )
      )
    );
    const heldIds = new Set([...held].map((card) => card.dataset.cardId));
    for (const marker of Array.from(
      surface.querySelectorAll<HTMLElement>('[data-marker-parent-card-id]')
    )) {
      if (heldIds.has(marker.dataset.markerParentCardId)) held.add(marker);
    }
    for (const [original, copy] of copies) {
      if (held.has(original) && original.isConnected) continue;
      copy.remove();
      original.removeAttribute('data-lifted');
      copies.delete(original);
    }
    for (const original of held) {
      let copy = copies.get(original);
      if (copy && !sameShape(original, copy)) {
        copy.remove();
        copy = undefined;
      }
      if (!copy) {
        copy = copyOf(original);
        stage.append(copy);
        copies.set(original, copy);
        original.setAttribute('data-lifted', '');
      } else {
        follow(original, copy);
      }
    }
    frame = view.requestAnimationFrame(tick);
  };
  tick();
  return () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    for (const [original, copy] of copies) {
      copy.remove();
      original.removeAttribute('data-lifted');
    }
    copies.clear();
  };
};
