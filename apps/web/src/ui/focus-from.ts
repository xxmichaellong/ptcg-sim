/**
 * How the focus last moved: by a pointer's press, or by the keys that move
 * it. Browsers paint :focus-visible after any key, so a card picked with a
 * click and then sent to the Bench with `b` wore a keyboard ring, as did a
 * button clicked before a hotkey. Under a pointer the stylesheet
 * (design/focus-from.css) keeps rings to fields being typed in; a key that
 * moves the focus brings them back.
 */
export type FocusFrom = 'pointer' | 'keyboard';

/** Keys that are only ever a way about. */
const MOVING_KEYS: ReadonlySet<string> = new Set(['Tab', 'F6', 'ContextMenu']);
/**
 * Keys that move the focus where a list or toolbar takes them, and act
 * elsewhere: the arrows send a selected card to the deck, even from a rail
 * button a click left focused. They count only if the focus moves.
 */
const STEERING_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
/** How soon after a steering key the focus must move to count as moved by it. */
const STEERED_WITHIN_MS = 250;

/**
 * What a key says about the focus: it moves it ('moves'), it may move it
 * ('steers', if the focus then moves), or it acts on what has it.
 */
export const keyIntent = (
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'target'>
): 'moves' | 'steers' | 'acts' => {
  if (MOVING_KEYS.has(event.key) || (event.key === 'F10' && event.shiftKey))
    return 'moves';
  if (!STEERING_KEYS.has(event.key)) return 'acts';
  // On a table card the arrows send it to the deck (top, bottom, switch).
  return event.target instanceof Element &&
    event.target.closest('.ptcgsim-card') !== null
    ? 'acts'
    : 'steers';
};

/** Keeps `data-focus-from` on the page's root element; returns its undo. */
export const installFocusFrom = (
  document: Document,
  now: () => number = () => performance.now()
): (() => void) => {
  const root = document.documentElement;
  let steeredAt = -Infinity;
  const note = (from: FocusFrom): void => {
    if (root.dataset.focusFrom !== from) root.dataset.focusFrom = from;
  };
  const pressed = (): void => {
    steeredAt = -Infinity;
    note('pointer');
  };
  const keyed = (event: KeyboardEvent): void => {
    const intent = keyIntent(event);
    if (intent === 'moves') note('keyboard');
    else if (intent === 'steers') steeredAt = now();
  };
  const focused = (): void => {
    if (now() - steeredAt <= STEERED_WITHIN_MS) note('keyboard');
    steeredAt = -Infinity;
  };
  // Captured, so a handler that stops the event cannot hide it.
  document.addEventListener('pointerdown', pressed, true);
  document.addEventListener('keydown', keyed, true);
  document.addEventListener('focusin', focused, true);
  return () => {
    document.removeEventListener('pointerdown', pressed, true);
    document.removeEventListener('keydown', keyed, true);
    document.removeEventListener('focusin', focused, true);
    delete root.dataset.focusFrom;
  };
};
