/** Inputs that take no typed text: a paste on one is the window's. */
const NOT_TEXT = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * Whether typed or pasted text goes into this element (a text field, a
 * text area, an editable region); a radio, a checkbox or a button with the
 * focus leaves a paste to the window around it.
 */
export const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !NOT_TEXT.has(target.type)));
