import { useLingui } from '@lingui/react/macro';
import { UsersIcon } from '@phosphor-icons/react/dist/csr/Users';

import { RailButton } from '../board/rail/TableRail.js';
import { useCompactLayout } from '../ui/breakpoints.js';
import { SettingsGroup, SettingsLinkRow } from '../ui/SettingsList.js';
import { Tooltip } from '../ui/Tooltip.js';
import { openFriends, useFriendsAvailable } from './friends-sheet-state.js';
import { useFriends, useOnlineFriends } from './friends-state.js';
import './friends.css';

/**
 * Friends on the app bar (ADR-055), for a signed-in player: a count of
 * friends online in the bar's cream, and a dot while requests wait.
 */
export const FriendsBarButton = () => {
  const { t } = useLingui();
  const { list } = useFriends();
  const online = useOnlineFriends();
  const label = t({ message: 'Friends', context: 'the friends sheet' });
  const waiting = list.incoming.length;
  const spoken =
    waiting > 0
      ? t({
          message: `${label}, ${waiting} requests`,
          comment: 'The Friends button while friend requests wait',
        })
      : online > 0
        ? t({
            message: `${label}, ${online} online`,
            comment: 'The Friends button with how many friends are online',
          })
        : label;
  return (
    <Tooltip content={label} side="bottom">
      <RailButton
        id="friendsButton"
        icon={UsersIcon}
        label={label}
        iconOnly
        badge={online}
        className="ptcgsim-friends-button"
        aria-label={spoken}
        data-requests={waiting > 0 ? 'true' : undefined}
        onClick={() => openFriends()}
      />
    </Tooltip>
  );
};

/**
 * On a phone, whose bar has no room for it, Friends is a row near the top
 * of Settings: requests waiting, else how many friends are online.
 */
export const FriendsSettingsRow = ({
  onOpen,
}: {
  /** Puts Settings away first: one window at a time. */
  readonly onOpen: () => void;
}) => {
  const { t } = useLingui();
  const available = useFriendsAvailable();
  const compact = useCompactLayout();
  const { list } = useFriends();
  const online = useOnlineFriends();
  if (!available || !compact) return null;
  const waiting = list.incoming.length;
  return (
    <SettingsGroup>
      <SettingsLinkRow
        id="settingsFriendsRow"
        icon={UsersIcon}
        tone="blue"
        label={t({ message: 'Friends', context: 'the friends sheet' })}
        {...(waiting > 0
          ? { value: t`${waiting} requests`, accent: true }
          : online > 0
            ? { value: t`${online} online` }
            : {})}
        onClick={() => {
          onOpen();
          openFriends();
        }}
      />
    </SettingsGroup>
  );
};
