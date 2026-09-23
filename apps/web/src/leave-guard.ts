export const LEGACY_LEAVE_MESSAGE =
  'Are you sure you want to leave? Any unsaved game data will be lost.';

interface LeaveGuardTarget {
  addEventListener(
    type: 'beforeunload',
    listener: (event: BeforeUnloadEvent) => void
  ): void;
  removeEventListener(
    type: 'beforeunload',
    listener: (event: BeforeUnloadEvent) => void
  ): void;
}

/**
 * v1's `initializeWindow` registers one `beforeunload` warning for the whole
 * application, so a reload or a closed tab always asks before discarding the
 * table. The wording is v1's; browsers have long replaced it with their own
 * text, and setting `returnValue` is what still triggers the prompt.
 *
 * The deck builder keeps its own dirty-draft guard: this one covers everything
 * else, including a live game, exactly as the source did.
 */
export const installLeaveGuard = (
  target: LeaveGuardTarget | undefined = globalThis.window
): (() => void) => {
  if (!target) return () => undefined;
  const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
    event.returnValue = LEGACY_LEAVE_MESSAGE;
  };
  target.addEventListener('beforeunload', handleBeforeUnload);
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    target.removeEventListener('beforeunload', handleBeforeUnload);
  };
};
