import { Menu } from '@base-ui/react/menu';
import type { Icon } from '@phosphor-icons/react';
import { useContext, type ReactElement, type ReactNode } from 'react';

import { OverlayContainerContext } from './overlay-host-registry.js';
import { OVERLAY_SURFACE_ATTRIBUTE } from './overlay-surface.js';
import './action-menu.css';

export type ActionMenuEntry =
  | {
      readonly kind?: 'item';
      /** The row's id, for tests and for v1-shaped ids that still apply. */
      readonly id?: string;
      readonly label: ReactNode;
      readonly icon?: Icon;
      /** A key hint shown at the end of the row: `M`, `Alt+R`. */
      readonly hint?: string | undefined;
      readonly danger?: boolean;
      readonly disabled?: boolean;
      readonly onSelect: () => void;
    }
  | { readonly kind: 'separator' }
  | { readonly kind: 'label'; readonly label: string };

const decorative = { 'aria-hidden': true, focusable: false } as const;

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
}: {
  /** The button that opens it. It must forward a ref and DOM props. */
  readonly trigger: ReactElement;
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
  return (
    <Menu.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange: (next) => onOpenChange(next) } : {})}
    >
      <Menu.Trigger render={trigger} />
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
                    {ItemIcon ? <ItemIcon {...decorative} /> : null}
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
