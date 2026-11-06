import { useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';

import { Sheet } from '../../ui/Sheet.js';
import './online-sheet.css';

/**
 * Play online (ADR-030, ADR-047): the lobby's host-or-join panel in a sheet
 * over the table, so a Solo game stays where it is while its owner reads it.
 */
export const OnlineSheet = ({
  open,
  onOpenChange,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The lobby's panel. */
  readonly children: ReactNode;
}) => {
  const { t } = useLingui();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t`Play online`}
      size="sm"
      id="playOnlineSheet"
      className="ptcgsim-online-sheet"
    >
      {children}
    </Sheet>
  );
};
