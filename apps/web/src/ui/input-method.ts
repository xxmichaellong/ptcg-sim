/**
 * Whether a key belongs to an input method (Japanese, Chinese, Korean...)
 * rather than to the field or the screen: any key while it composes, and
 * the Enter or Esc that ends a composition, which Safari sends after
 * `compositionend` with `isComposing` false and keyCode 229. Enter there
 * takes a candidate and Esc drops one; neither submits, closes or clears.
 *
 * Only Enter and Esc count with 229: Android's keyboards send 229 for
 * ordinary keys too.
 */
export const isInputMethodKey = (
  event: Pick<KeyboardEvent, 'isComposing' | 'keyCode' | 'key'>
): boolean =>
  event.isComposing ||
  (event.keyCode === 229 && (event.key === 'Enter' || event.key === 'Escape'));
