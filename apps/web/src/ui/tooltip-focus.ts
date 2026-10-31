import type { BaseUIEvent } from '@base-ui/react/types';
import type { FocusEvent } from 'react';

/**
 * Opt in on a Tooltip trigger: a modal returning its focus should not open
 * another popup for the next Escape to close. Ordinary hover and focus keep
 * Base UI's defaults. Its trigger supplies this event extension.
 */
export const skipDialogReturnTooltip = (
  event: FocusEvent<HTMLElement>
): void => {
  if (
    event.relatedTarget instanceof Element &&
    event.relatedTarget.closest('.ptcgsim-ui-dialog') !== null
  ) {
    (event as BaseUIEvent<typeof event>).preventBaseUIHandler();
  }
};
