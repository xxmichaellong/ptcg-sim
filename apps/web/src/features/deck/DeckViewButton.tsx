import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { useLingui } from '@lingui/react/macro';
import { Tooltip } from '../../ui/Tooltip.js';

export const DeckViewButton = ({
  name,
  onClick,
}: {
  readonly name: string;
  readonly onClick: () => void;
}) => {
  const { t } = useLingui();
  return (
    <Tooltip content={t`Quick view`}>
      <button
        type="button"
        className="deck-icon-button"
        data-view-deck="true"
        aria-label={t`View ${name}`}
        onClick={onClick}
      >
        <EyeIcon aria-hidden="true" weight="bold" />
      </button>
    </Tooltip>
  );
};
