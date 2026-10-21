import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

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
  /** Hover delay in milliseconds. Defaults to the provider's (100 ms). */
  readonly delay?: number;
  readonly disabled?: boolean;
  /**
   * For something that only informs (a count), never one that acts: a
   * finger's tap shows the tooltip too, and the next press anywhere hides
   * it. A button's tap does what the button does, so it never shows one.
   */
  readonly tapToShow?: boolean;
}

/** The one tooltip a tap opened, closed when another opens. */
let closeTapped: (() => void) | null = null;

/**
 * The hover delay shared by every tooltip under one provider: short enough
 * to feel immediate, long enough that sweeping the pointer across a row of
 * controls doesn't flash each label. Once one is open the next opens at once.
 */
export const TOOLTIP_DELAY_MS = 100;

/**
 * A tooltip's words with the key that does the same at the end, as a key
 * cap: "Flip a coin [F]". Without a key (the player freed it, or there is
 * none) it is just the words.
 */
export const withKeyHint = (label: ReactNode, hint?: string): ReactNode =>
  hint ? (
    <>
      {label} <kbd className="ptcgsim-ui-tooltip__hint">{hint}</kbd>
    </>
  ) : (
    label
  );

/**
 * A short label shown on hover or keyboard focus, positioned by Base UI and
 * kept on screen. It never takes focus and never hides the element it names.
 * A finger's tap opens one only where `tapToShow` says the element just
 * informs (Base UI opens on a mouse's hover or a keyboard's focus), and the
 * label itself takes no presses: whatever it lies over stays in reach, and
 * it goes as the pointer leaves.
 */
export const Tooltip = ({
  content,
  children,
  side = 'top',
  delay,
  disabled = false,
  tapToShow = false,
}: TooltipProps) => {
  const container = useContext(OverlayContainerContext);
  const trigger = useRef<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [tapped, setTapped] = useState(false);
  const tappedAtPress = useRef(false);
  useEffect(() => {
    if (!tapped) return;
    const close = () => setTapped(false);
    closeTapped?.();
    closeTapped = close;
    const press = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        trigger.current?.contains(event.target)
      )
        return;
      close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('keydown', key, true);
      if (closeTapped === close) closeTapped = null;
    };
  }, [tapped]);
  return (
    <BaseTooltip.Root
      disabled={disabled}
      disableHoverablePopup
      {...(tapToShow
        ? {
            open: hovered || tapped,
            // Base UI's own opening and closing is the mouse's and the
            // keyboard's; a tap's stays until the next tap, a press
            // elsewhere or Escape (above) -- the finger lifting reads to it
            // as the pointer leaving.
            onOpenChange: (open: boolean) => setHovered(open),
          }
        : {})}
    >
      <BaseTooltip.Trigger
        ref={(element: HTMLElement | null) => {
          trigger.current = element;
        }}
        render={children}
        {...(delay === undefined ? {} : { delay })}
        {...(tapToShow
          ? {
              // The tap's own click must not close what it opened.
              closeOnClick: false,
              // Whether it showed is read as the finger comes down: a press
              // can close it on the way (Base UI's), and the tap that ends
              // should then leave it closed, not open it again.
              onPointerDown: (event: ReactPointerEvent) => {
                if (event.pointerType === 'touch')
                  tappedAtPress.current = tapped;
              },
              onPointerUp: (event: ReactPointerEvent) => {
                if (event.pointerType === 'touch')
                  setTapped(!tappedAtPress.current);
              },
            }
          : {})}
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
