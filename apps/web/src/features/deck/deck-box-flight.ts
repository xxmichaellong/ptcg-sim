import { motionSettings } from '../../motion/motion-settings.js';

/** How long the cover takes to cross the screen, at normal speed. */
const FLIGHT_MS = 520;

/** The flight each tray waits for: the last one sent to it. */
const landing = new WeakMap<HTMLElement, Animation>();

/**
 * A deck put on a seat flies to it (ADR-033 §13): a copy of its tile's
 * cover rises, crosses to the seat's switch and lands at the size of the
 * cover there (both 16:10), its corners rounded as that one's, while the
 * seat's own cover waits hidden underneath. Measured first and last, then
 * only transform and opacity move (FLIP). Nothing moves under reduced
 * motion or at "instant" speed, and nothing is left behind if the flight
 * is cut short.
 */
export const flyDeckBox = (box: HTMLElement, tray: HTMLElement): void => {
  const motion = motionSettings().getSnapshot();
  if (motion.reduced || motion.durationScale <= 0) return;
  if (typeof box.animate !== 'function') return;
  const from = box.getBoundingClientRect();
  const to = tray.getBoundingClientRect();
  if (from.width <= 0 || to.width <= 0) return;

  const ghost = box.cloneNode(true) as HTMLElement;
  ghost.style.setProperty(
    '--box-radius',
    getComputedStyle(tray).getPropertyValue('--box-radius')
  );
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${String(from.left)}px`,
    top: `${String(from.top)}px`,
    width: `${String(from.width)}px`,
    height: `${String(from.height)}px`,
    margin: '0',
    zIndex: 'calc(var(--layer-deck-screen) + 1)',
    pointerEvents: 'none',
    transformOrigin: 'top left',
  });
  ghost.dataset.lifted = 'true';
  ghost.setAttribute('aria-hidden', 'true');
  // Inside the screen's layer (no transform there, so still fixed to the
  // window): it fades and hides with the screen, never over the table.
  (tray.closest('.ptcgsim-deck-layer') ?? document.body).append(ghost);
  tray.style.visibility = 'hidden';

  const scale = to.width / from.width;
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const animation = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)' },
      {
        // Lifted up off the shelf on its way.
        transform: `translate(${String(dx * 0.45)}px, ${String(dy * 0.45 - 36)}px) scale(${String((1 + scale) / 2)})`,
        offset: 0.5,
      },
      {
        transform: `translate(${String(dx)}px, ${String(dy)}px) scale(${String(scale)})`,
      },
    ],
    {
      duration: FLIGHT_MS * motion.durationScale,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    }
  );
  landing.set(tray, animation);
  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    ghost.remove();
    // A second box sent to this tray meanwhile: it waits hidden for that.
    if (landing.get(tray) !== animation) return;
    landing.delete(tray);
    tray.style.visibility = '';
  };
  animation.addEventListener('finish', settle);
  animation.addEventListener('cancel', settle);
  // A tab put away mid-flight may never finish it.
  setTimeout(settle, FLIGHT_MS * motion.durationScale + 400);
};
