import { Trans, useLingui } from '@lingui/react/macro';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { LinkIcon } from '@phosphor-icons/react/dist/csr/Link';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';

import { Tooltip } from '../../ui/Tooltip.js';
import './table-welcome.css';

const decorative = { 'aria-hidden': true, focusable: false } as const;

/**
 * A room waiting for its opponent (ADR-047): its code, on the felt where
 * the welcome card sits at a Solo table, to read out or copy, and the link
 * that carries it. Whoever joins chooses to play or to watch. It goes once
 * the opponent takes their seat; the bar's room code keeps the rest.
 *
 * Two lines (2026-11-09): the title, then the code beside its copy
 * buttons, so it fits above the seam over the empty far half and never
 * lies on the player's own side of the table.
 */
export const TableInvite = ({
  code,
  onCopyCode,
  onInvite,
  onDismiss,
}: {
  readonly code: string | undefined;
  readonly onCopyCode: () => void;
  readonly onInvite: () => void;
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
      <h2 id="tableInviteTitle" className="table-invite__title">
        <Trans>Room ready</Trans>
      </h2>
      <div className="table-invite__row">
        <output
          id="tableInviteCode"
          className="table-welcome__code"
          aria-live="polite"
        >
          {code ?? '····'}
        </output>
        <div className="table-invite__actions">
          <button
            id="inviteOpponentButton"
            type="button"
            className="ds-button ds-button--primary"
            disabled={!code}
            onClick={onInvite}
          >
            <LinkIcon {...decorative} weight="bold" />
            <Trans>Copy invite link</Trans>
          </button>
          <Tooltip content={t`Copy code`} side="bottom">
            <button
              id="tableCopyCodeButton"
              type="button"
              className="ds-button ds-button--secondary table-invite__copy"
              aria-label={t`Copy code`}
              disabled={!code}
              onClick={onCopyCode}
            >
              <CopyIcon {...decorative} weight="bold" />
            </button>
          </Tooltip>
        </div>
      </div>
    </section>
  );
};
