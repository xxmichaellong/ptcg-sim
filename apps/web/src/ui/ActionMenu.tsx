import { Menu } from '@base-ui/react/menu';
import type { Icon } from '@phosphor-icons/react';
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { OverlayContainerContext } from './overlay-host-registry.js';
import { OVERLAY_SURFACE_ATTRIBUTE } from './overlay-surface.js';
import { Tooltip } from './Tooltip.js';
import './action-menu.css';

export type ActionMenuEntry =
  | {
      readonly kind?: 'item';
      /** The row's id, for tests and for v1-shaped ids that still apply. */
      readonly id?: string;
      readonly label: ReactNode;
      readonly icon?: Icon;
      /**
       * The icon points the way the line reads (leaving, going back): it
       * turns round in a right-to-left language (`ds-mirror-rtl`).
       */
      readonly mirrored?: boolean;
      /** A key hint shown at the end of the row: `M`, `Alt+R`. */
      readonly hint?: string | undefined;
      readonly danger?: boolean;
      readonly disabled?: boolean;
      readonly onSelect: () => void;
    }
  | { readonly kind: 'separator' }
  | { readonly kind: 'label'; readonly label: string };

const decorative = { 'aria-hidden': true, focusable: false } as const;

/** How long, at most, an open menu follows its button after a resize. */
const FOLLOW_AFTER_RESIZE_FRAMES = 90;
/** Frames the button must keep still before the menu stops following it. */
const SETTLED_FRAMES = 3;

/**
 * An open menu follows its button while the page lays out again after the
 * window changes size (a phone turned on its side). The menu is placed as
 * the window resizes, before the page has moved the button: a window's
 * panel sliding to its new place carries it there over several frames, and
 * its first place may be off the new screen, which the positioner's own
 * watch only looks at again a second later. So, frame by frame until the
 * button keeps still, every move of it has the menu placed again, by the
 * visual viewport's resize, which is what the positioner listens to.
 */
const useFollowAfterResize = (
  open: boolean,
  trigger: RefObject<HTMLElement | null>
): void => {
  useEffect(() => {
    if (!open) return;
    const view = trigger.current?.ownerDocument.defaultView;
    const viewport = view?.visualViewport;
    if (!view || !viewport) return;
    let frame = 0;
    let last: DOMRect | undefined;
    let frames = 0;
    let still = 0;
    const follow = (): void => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      if (
        last === undefined ||
        rect.x !== last.x ||
        rect.y !== last.y ||
        rect.width !== last.width ||
        rect.height !== last.height
      ) {
        last = rect;
        still = 0;
        viewport.dispatchEvent(new Event('resize'));
      } else {
        still += 1;
      }
      frames += 1;
      if (still < SETTLED_FRAMES && frames < FOLLOW_AFTER_RESIZE_FRAMES)
        frame = view.requestAnimationFrame(follow);
    };
    const resized = (event: Event): void => {
      // The menu's own nudges come back here; only the window's count.
      if (!event.isTrusted) return;
      view.cancelAnimationFrame(frame);
      last = trigger.current?.getBoundingClientRect();
      frames = 0;
      still = 0;
      frame = view.requestAnimationFrame(follow);
    };
    view.addEventListener('resize', resized);
    return () => {
      view.removeEventListener('resize', resized);
      view.cancelAnimationFrame(frame);
    };
  }, [open, trigger]);
};

/**
 * A menu of actions opened from a button: the table rail's More, and the
 * app menu. Keyboard, pointer and touch work alike; its keys never reach
 * the table; the rows grow to 44px under a finger.
 */
export const ActionMenu = ({
  trigger,
  entries,
  label,
  side = 'top',
  align = 'start',
  header,
  open,
  onOpenChange,
  tooltip,
  tooltipSide = 'top',
}: {
  /** The button that opens it. It must forward a ref and DOM props. */
  readonly trigger: ReactElement;
  /**
   * What the button's tooltip says (an icon-only button's name). It stays
   * away while the menu is open, so it never lies over the menu.
   */
  readonly tooltip?: ReactNode;
  readonly tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  readonly entries: readonly ActionMenuEntry[];
  /** The menu's accessible name. */
  readonly label: string;
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
  readonly align?: 'start' | 'center' | 'end';
  /** Content above the items, such as the room's name. */
  readonly header?: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}) => {
  const container = useContext(OverlayContainerContext);
  const [shown, setShown] = useState(false);
  const triggerElement = useRef<HTMLButtonElement>(null);
  useFollowAfterResize(open ?? shown, triggerElement);
  const menuTrigger = <Menu.Trigger ref={triggerElement} render={trigger} />;
  return (
    <Menu.Root
      {...(open === undefined ? {} : { open })}
      onOpenChange={(next) => {
        setShown(next);
        onOpenChange?.(next);
      }}
    >
      {tooltip ? (
        // The tooltip's trigger renders the menu's, which renders the
        // button: one element carries both, and its own id and name.
        <Tooltip content={tooltip} side={tooltipSide} disabled={open ?? shown}>
          {menuTrigger}
        </Tooltip>
      ) : (
        menuTrigger
      )}
      <Menu.Portal container={container}>
        <Menu.Positioner
          className="ptcgsim-action-menu-positioner"
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
        >
          <Menu.Popup
            className="ptcgsim-action-menu"
            aria-label={label}
            {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'popover' }}
          >
            {header ? (
              <div className="ptcgsim-action-menu__header">{header}</div>
            ) : null}
            {entries.map((entry, index) => {
              if (entry.kind === 'separator') {
                return (
                  <Menu.Separator
                    key={`separator-${index}`}
                    className="ptcgsim-action-menu__separator"
                  />
                );
              }
              if (entry.kind === 'label') {
                return (
                  <div
                    key={`label-${entry.label}`}
                    className="ptcgsim-action-menu__label"
                    role="presentation"
                  >
                    {entry.label}
                  </div>
                );
              }
              const ItemIcon = entry.icon;
              return (
                <Menu.Item
                  key={entry.id ?? `item-${index}`}
                  {...(entry.id ? { id: entry.id } : {})}
                  className={`ptcgsim-action-menu__item${entry.danger ? ' is-danger' : ''}`}
                  disabled={entry.disabled === true}
                  onClick={entry.onSelect}
                >
                  <span className="ptcgsim-action-menu__icon">
                    {ItemIcon ? (
                      <ItemIcon
                        {...decorative}
                        {...(entry.mirrored
                          ? { className: 'ds-mirror-rtl' }
                          : {})}
                      />
                    ) : null}
                  </span>
                  <span className="ptcgsim-action-menu__text">
                    {entry.label}
                  </span>
                  {entry.hint ? (
                    <kbd className="ptcgsim-action-menu__hint">
                      {entry.hint}
                    </kbd>
                  ) : null}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};
