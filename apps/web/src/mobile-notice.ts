const MOBILE_USER_AGENT =
  /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i;

export const LEGACY_MOBILE_NOTICE =
  'PTCG-sim is still in mobile development. Please use a desktop for full functionality.';

/**
 * v1's `window.onload` check in index.ejs: a phone or tablet is told once, on
 * load, that the sim expects a desktop. The board is unchanged either way, so
 * this stays a plain alert rather than anything that can block startup.
 */
export const announceMobileNotice = (
  userAgent: string | undefined = globalThis.navigator?.userAgent,
  alertUser: ((message: string) => void) | undefined = globalThis.alert?.bind(
    globalThis
  )
): boolean => {
  if (!userAgent || !MOBILE_USER_AGENT.test(userAgent) || !alertUser) {
    return false;
  }
  try {
    alertUser(LEGACY_MOBILE_NOTICE);
  } catch {
    // A blocked dialog must never keep the application from starting.
    return false;
  }
  return true;
};
