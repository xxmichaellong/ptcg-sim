import { Trans, useLingui } from '@lingui/react/macro';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { UserPlusIcon } from '@phosphor-icons/react/dist/csr/UserPlus';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';

import { Tooltip } from '../../ui/Tooltip.js';
import type { RoomInviteRole } from '../room-invites.js';
import './table-welcome.css';

const decorative = { 'aria-hidden': true, focusable: false } as const;

/**
 * A room waiting for its opponent (ADR-020): the two ways to invite, on the
 * felt where the welcome card sits at a Solo table. It goes once the
 * opponent takes their seat; the app menu keeps both invites.
 */
export const TableInvite = ({
  roles,
  onInvite,
  onDismiss,
}: {
  readonly roles: readonly RoomInviteRole[];
  readonly onInvite: (role: RoomInviteRole) => void;
  readonly onDismiss: () => void;
}) => {
  const { t } = useLingui();
  return (
    <section
      className="table-welcome table-welcome--invite"
      aria-labelledby="tableInviteTitle"
      data-table-invite="true"
    >
      <Tooltip content={t`Hide`} side="bottom">
        <button
          type="button"
          className="ds-icon-button table-welcome__dismiss"
          aria-label={t`Hide`}
          onClick={onDismiss}
        >
          <XIcon {...decorative} weight="bold" />
        </button>
      </Tooltip>
      <header className="table-welcome__hero">
        <div>
          <h2 id="tableInviteTitle">
            <Trans>Room ready</Trans>
          </h2>
        </div>
      </header>
      <p className="table-welcome__lead">
        <Trans>Send your opponent a link. Each works once.</Trans>
      </p>
      <div className="table-welcome__actions">
        {roles.includes('player') ? (
          <button
            id="inviteOpponentButton"
            type="button"
            className="ds-button ds-button--primary"
            onClick={() => onInvite('player')}
          >
            <UserPlusIcon {...decorative} weight="bold" />
            <Trans>Invite opponent</Trans>
          </button>
        ) : null}
        {roles.includes('spectator') ? (
          <button
            id="inviteSpectatorButton"
            type="button"
            className="ds-button ds-button--secondary"
            onClick={() => onInvite('spectator')}
          >
            <EyeIcon {...decorative} weight="bold" />
            <Trans>Invite spectator</Trans>
          </button>
        ) : null}
      </div>
    </section>
  );
};
