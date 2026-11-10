import { useState } from 'react';

import {
  emblemCategory,
  type EmblemCategory,
} from '../card-backs/card-back-emblems.js';
import { EmblemPicker } from '../card-backs/EmblemPicker.js';
import { SettingsBlock, SettingsGroup } from '../ui/SettingsList.js';
import { toast } from '../ui/toast.js';
import { patchAccount } from './account-api.js';
import {
  announceAccountChange,
  replaceAccount,
  useAccount,
} from './account-state.js';
import { useLingui } from '@lingui/react/macro';

import '../ui/form-controls.css';
import '../card-backs/card-back-chooser.css';

/**
 * Avatar (ADR-052): the name's initial (None), or any emblem the sleeve
 * designer has -- a Pokémon, a Poké Ball or an Energy. Loaded with the
 * page, as the sleeve designer is.
 */
export const AccountAvatarPage = () => {
  const { t } = useLingui();
  const { account } = useAccount();
  const current = account?.avatar.startsWith('emblem:')
    ? account.avatar.slice('emblem:'.length)
    : 'none';
  const [shelf, setShelf] = useState<EmblemCategory>(() =>
    current === 'none' ? 'pokemon' : emblemCategory(current)
  );
  if (!account) return null;
  return (
    <SettingsGroup>
      <SettingsBlock>
        <EmblemPicker
          name="accountAvatar"
          value={current}
          shelf={shelf}
          onShelf={setShelf}
          onChange={(emblem) => {
            const avatar = emblem === 'none' ? 'initials' : `emblem:${emblem}`;
            if (avatar === account.avatar) return;
            replaceAccount({ ...account, avatar });
            patchAccount({ avatar }).then(
              (changed) => {
                replaceAccount(changed);
                announceAccountChange();
              },
              () => {
                replaceAccount(account);
                toast({
                  title: t`Couldn't change the avatar. Try again.`,
                  tone: 'danger',
                  id: 'account-avatar',
                });
              }
            );
          }}
        />
      </SettingsBlock>
    </SettingsGroup>
  );
};

export default AccountAvatarPage;
