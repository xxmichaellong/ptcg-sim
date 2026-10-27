import { flushSync } from 'react-dom';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { BoardPreferences } from '@ptcgsim/renderer-contract';

const NEUTRAL: Readonly<{ x: number; y: number }> = Object.freeze({
  x: 0,
  y: 0,
});

/** Small camera-eye motion shared by paint, picking, chrome and overlays. */
export const useBoardParallax = (
  host: RefObject<HTMLElement | null>,
  preferences: BoardPreferences
): BoardPreferences => {
  const [viewpoint, setViewpoint] = useState(NEUTRAL);
  const enabled =
    preferences.depth?.parallax === true &&
    preferences.depth.mode !== 'flat' &&
    !preferences.reducedMotion &&
    preferences.animationSpeed !== 0;
  useEffect(() => {
    const surface = host.current;
    if (!surface || !enabled) {
      setViewpoint(NEUTRAL);
      return;
    }
    let frame: number | null = null;
    let held = false;
    let current = NEUTRAL;
    let target = NEUTRAL;
    let last = 0;
    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      surface.dataset.parallax = 'idle';
    };
    const busy = () =>
      held ||
      document.hidden ||
      surface.querySelector('[data-board-motion="active"]') !== null ||
      surface.parentElement?.querySelector('[role="dialog"], [role="menu"]') !==
        null;
    const tick = (at: number) => {
      frame = null;
      if (busy()) {
        surface.dataset.parallax = 'idle';
        return;
      }
      // Limit expensive scene projections to 30Hz, then stop completely at rest.
      if (at - last >= 32) {
        last = at;
        const distance = Math.hypot(target.x - current.x, target.y - current.y);
        current =
          distance < 0.02
            ? target
            : {
                x: current.x + (target.x - current.x) * 0.28,
                y: current.y + (target.y - current.y) * 0.28,
              };
        flushSync(() => setViewpoint(current));
      }
      if (current !== target) frame = requestAnimationFrame(tick);
      else surface.dataset.parallax = 'idle';
    };
    const schedule = () => {
      if (frame === null && !busy()) {
        surface.dataset.parallax = 'active';
        frame = requestAnimationFrame(tick);
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons || busy()) return;
      const rect = surface.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      target = {
        x: Math.max(
          -1,
          Math.min(1, (2 * (event.clientX - rect.left)) / rect.width - 1)
        ),
        y: Math.max(
          -1,
          Math.min(1, (2 * (event.clientY - rect.top)) / rect.height - 1)
        ),
      };
      schedule();
    };
    const down = () => {
      held = true;
      cancel();
      surface.dataset.parallax = 'frozen';
    };
    const up = () => {
      held = false;
      surface.dataset.parallax = 'idle';
    }; // Resume only on a new hover; never shift a release.
    const leave = () => {
      if (!held) {
        target = NEUTRAL;
        schedule();
      }
    };
    const reset = () => {
      held = false;
      cancel();
      target = current = NEUTRAL;
      setViewpoint(NEUTRAL);
    };
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerleave', leave);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      cancel();
      delete surface.dataset.parallax;
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, [host, enabled]);
  return useMemo(
    () => (enabled ? { ...preferences, viewpoint } : preferences),
    [preferences, enabled, viewpoint]
  );
};
