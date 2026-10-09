import { toast } from './ui/toast.js';

const MOBILE_USER_AGENT =
  /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i;

export const LEGACY_MOBILE_NOTICE =
  'PTCG-sim is still in mobile development. Please use a desktop for full functionality.';

const showMobileNotice = (message: string): void => {
  // v1's alert waited to be acknowledged; this notice stays until dismissed.
  toast({ title: 'Best on a desktop', body: message, timeout: 0 });
};

/**
 * v1's `window.onload` check in index.ejs: a phone or tablet is told once, on
 * load, that the sim expects a desktop. The board is unchanged either way, so
 * this is a notice rather than anything that can block startup. It is raised
 * before the overlay host mounts and shown as soon as it does.
 */
export const announceMobileNotice = (
  userAgent: string | undefined = globalThis.navigator?.userAgent,
  notify: (message: string) => void = showMobileNotice
): boolean => {
  if (!userAgent || !MOBILE_USER_AGENT.test(userAgent)) return false;
  try {
    notify(LEGACY_MOBILE_NOTICE);
  } catch {
    // A failed notice must never keep the application from starting.
    return false;
  }
  return true;
};
