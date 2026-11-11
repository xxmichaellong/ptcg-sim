import { useLingui } from '@lingui/react/macro';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';

import { SettingsGroup, SettingsLinkRow } from '../ui/SettingsList.js';
import { useAccountSaves } from './account-saves.js';

/**
 * Saves & replays' list of the games saved to the account (ADR-052): each
 * resumes as its file would, and leaves the list once resumed.
 */
export const AccountSavesGroup = ({
  resume,
  leave,
  busy,
}: {
  readonly resume: (text: string, onResumed?: () => void) => void;
  readonly leave: () => void;
  readonly busy: boolean;
}) => {
  const { t, i18n } = useLingui();
  const { saves, remove } = useAccountSaves();
  if (!saves || saves.length === 0) return null;
  const when = new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <SettingsGroup heading={t`Saved games`}>
      {saves.map((save) => (
        <SettingsLinkRow
          key={save.id}
          id={`accountSave-${save.id}`}
          icon={ClockCounterClockwiseIcon}
          tone="brown"
          label={save.title || t`Saved game`}
          subtitle={when.format(save.savedAt)}
          trailing="none"
          disabled={busy}
          onClick={() => {
            leave();
            resume(save.text, () => remove(save.id));
          }}
        />
      ))}
    </SettingsGroup>
  );
};
