import { Trans, useLingui } from '@lingui/react/macro';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import type { ReactNode } from 'react';

import { DeckIcon } from '../../ui/DeckIcon.js';
import { Sheet } from '../../ui/Sheet.js';
import { Tooltip } from '../../ui/Tooltip.js';
import './online-sheet.css';

/**
 * Play online (ADR-030): the lobby's host-or-join panel in a sheet over the
 * table, so a Solo game stays where it is while its owner reads it.
 */
export const OnlineSheet = ({
  open,
  onOpenChange,
  onDeck,
  onSettings,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Before a room, the deck and Settings open from here: the sheet is all
   * there is, and a deck readied now goes into the room on joining.
   */
  readonly onDeck?: () => void;
  readonly onSettings?: () => void;
  /** The lobby's panel. */
  readonly children: ReactNode;
}) => {
  const { t } = useLingui();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t`Play online`}
      description={t`Host a room and invite a friend, or join theirs.`}
      {...(onDeck || onSettings
        ? {
            headerActions: (
              <>
                {onDeck ? (
                  <button
                    id="onlineDeckButton"
                    type="button"
                    className="ds-button ds-button--ghost"
                    onClick={onDeck}
                  >
                    <DeckIcon aria-hidden="true" weight="bold" />
                    <Trans context="the deck screen">Deck</Trans>
                  </button>
                ) : null}
                {onSettings ? (
                  <Tooltip content={t`Settings`} side="bottom">
                    <button
                      id="onlineSettingsButton"
                      type="button"
                      className="ds-icon-button"
                      aria-label={t`Settings`}
                      onClick={onSettings}
                    >
                      <GearSixIcon aria-hidden="true" weight="bold" />
                    </button>
                  </Tooltip>
                ) : null}
              </>
            ),
          }
        : {})}
      size="md"
      id="playOnlineSheet"
      className="ptcgsim-online-sheet"
    >
      {children}
    </Sheet>
  );
};
