import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { useContext, type ReactElement, type ReactNode } from 'react';

import { OVERLAY_SURFACE_ATTRIBUTE } from './overlay-surface.js';
import { OverlayContainerContext } from './overlay-host-registry.js';
import './overlays.css';

export interface TooltipProps {
  /** What the tooltip says. Keep it to a short label or a key hint. */
  readonly content: ReactNode;
  /**
   * The element it describes. It must accept a ref and DOM props (a native
   * button, or a component that forwards them).
   */
  readonly children: ReactElement;
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
  /** Hover delay in milliseconds. Defaults to the provider's (500 ms). */
  readonly delay?: number;
  readonly disabled?: boolean;
}

/** The hover/focus delay shared by every tooltip under one provider. */
export const TOOLTIP_DELAY_MS = 500;

/**
 * A short label shown on hover or keyboard focus, positioned by Base UI and
 * kept on screen. It never takes focus and never hides the element it names.
 */
export const Tooltip = ({
  content,
  children,
  side = 'top',
  delay,
  disabled = false,
}: TooltipProps) => {
  const container = useContext(OverlayContainerContext);
  return (
    <BaseTooltip.Root disabled={disabled}>
      <BaseTooltip.Trigger
        render={children}
        {...(delay === undefined ? {} : { delay })}
      />
      <BaseTooltip.Portal
        container={container}
        {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'portal' }}
      >
        <BaseTooltip.Positioner
          className="ptcgsim-ui-tooltip-positioner"
          side={side}
          sideOffset={8}
          collisionPadding={8}
        >
          <BaseTooltip.Popup
            className="ptcgsim-ui-tooltip"
            {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'tooltip' }}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
};

/** Groups tooltips so moving between triggers shows the next one at once. */
export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <BaseTooltip.Provider delay={TOOLTIP_DELAY_MS}>
    {children}
  </BaseTooltip.Provider>
);
