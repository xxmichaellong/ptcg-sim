import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { Drawer } from '@base-ui/react/drawer';
import { useLingui } from '@lingui/react/macro';
import { useContext, type ReactNode, type RefObject } from 'react';

import { useCompactLayout } from './breakpoints.js';
import { OverlayContainerContext } from './overlay-host-registry.js';
import { OVERLAY_SURFACE_ATTRIBUTE } from './overlay-surface.js';
import { Tooltip, withKeyHint } from './Tooltip.js';
import './sheet.css';

export type SheetPlacement = 'center' | 'side';
export type SheetSize = 'sm' | 'md' | 'lg' | 'xl';

export interface SheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /**
   * Where it sits when there is room: centred, or along the right edge. On
   * a phone every sheet rises from the bottom and can be swiped away.
   */
  readonly placement?: SheetPlacement;
  readonly size?: SheetSize;
  /**
   * A side sheet that leaves the table in play (the activity log). On a
   * phone there is no room beside the table, so it is always modal there.
   */
  readonly modal?: boolean;
  /** Controls beside the title, before the close button. */
  readonly headerActions?: ReactNode;
  readonly initialFocus?: RefObject<HTMLElement | null>;
  readonly className?: string;
  /** Marks the popup for tests and for scoped styles. */
  readonly id?: string;
  readonly children?: ReactNode;
}

/**
 * The one container for everything that is not the table (ADR-030): a
 * centred panel or a side drawer where there is room, a bottom sheet on a
 * phone. It traps focus while modal, closes on Esc and outside presses, and
 * its keys never reach the table.
 */
export const Sheet = ({
  open,
  onOpenChange,
  title,
  description,
  placement = 'center',
  size = 'md',
  modal = true,
  headerActions,
  initialFocus,
  className,
  id,
  children,
}: SheetProps) => {
  const { t } = useLingui();
  const container = useContext(OverlayContainerContext);
  const compact = useCompactLayout();
  const variant = compact ? 'bottom' : placement;
  const isModal = compact || modal;
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      swipeDirection={variant === 'side' ? 'right' : 'down'}
      modal={isModal}
      {...(isModal ? {} : { disablePointerDismissal: true })}
    >
      <Drawer.Portal
        container={container}
        {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'portal' }}
      >
        {isModal ? (
          <Drawer.Backdrop className="ptcgsim-sheet-backdrop" />
        ) : null}
        <Drawer.Viewport
          className="ptcgsim-sheet-viewport"
          data-variant={variant}
          data-modal={isModal ? 'true' : 'false'}
        >
          <Drawer.Popup
            id={id}
            className={
              className ? `ptcgsim-sheet ${className}` : 'ptcgsim-sheet'
            }
            data-variant={variant}
            data-size={size}
            {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'dialog' }}
            {...(initialFocus ? { initialFocus } : {})}
          >
            {variant === 'bottom' ? (
              <div className="ptcgsim-sheet__handle" aria-hidden="true" />
            ) : null}
            <header className="ptcgsim-sheet__header">
              <div className="ptcgsim-sheet__heading">
                <Drawer.Title className="ptcgsim-sheet__title">
                  {title}
                </Drawer.Title>
                {description ? (
                  <Drawer.Description className="ptcgsim-sheet__description">
                    {description}
                  </Drawer.Description>
                ) : null}
              </div>
              {headerActions ? (
                <div className="ptcgsim-sheet__actions">{headerActions}</div>
              ) : null}
              <Tooltip
                content={withKeyHint(
                  t`Close`,
                  t({ message: 'Esc', context: 'keyboard key' })
                )}
                side="bottom"
              >
                <Drawer.Close
                  className="ptcgsim-sheet__close"
                  aria-label={t`Close`}
                >
                  <XIcon aria-hidden="true" />
                </Drawer.Close>
              </Tooltip>
            </header>
            <Drawer.Content className="ptcgsim-sheet__body">
              {children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
};
