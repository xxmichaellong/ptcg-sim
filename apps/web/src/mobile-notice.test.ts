import { describe, expect, it, vi } from 'vitest';

import { announceMobileNotice, LEGACY_MOBILE_NOTICE } from './mobile-notice.js';

describe('legacy mobile notice', () => {
  it('warns exactly the user agents v1 warned and nobody else', () => {
    const mobile = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      'Mozilla/5.0 (webOS/1.4.0; U; en-US)',
      'BlackBerry9700/5.0.0.862',
      'Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; IEMobile/10.0)',
      'Opera/9.80 (J2ME/MIDP; Opera Mini/9.80)',
    ];
    for (const userAgent of mobile) {
      const alertUser = vi.fn();
      expect(announceMobileNotice(userAgent, alertUser)).toBe(true);
      expect(alertUser).toHaveBeenCalledExactlyOnceWith(LEGACY_MOBILE_NOTICE);
    }
    const desktop = vi.fn();
    expect(
      announceMobileNotice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        desktop
      )
    ).toBe(false);
    expect(desktop).not.toHaveBeenCalled();
  });

  it('never fails startup when the agent is unknown or the notice fails', () => {
    expect(announceMobileNotice(undefined, vi.fn())).toBe(false);
    expect(
      announceMobileNotice('Android 14', () => {
        throw new Error('blocked');
      })
    ).toBe(false);
  });

  it('raises a persistent toast by default instead of a native alert', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const toastModule = await import('./ui/toast.js');
    const toast = vi.spyOn(toastModule, 'toast');
    expect(announceMobileNotice('Android 14')).toBe(true);
    expect(alert).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledExactlyOnceWith({
      title: 'Best on a desktop',
      body: LEGACY_MOBILE_NOTICE,
      timeout: 0,
    });
    vi.unstubAllGlobals();
  });
});
