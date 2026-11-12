import { Trans, useLingui } from '@lingui/react/macro';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { DoorOpenIcon } from '@phosphor-icons/react/dist/csr/DoorOpen';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { EyeSlashIcon } from '@phosphor-icons/react/dist/csr/EyeSlash';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/csr/PaperPlaneTilt';
import type { Icon } from '@phosphor-icons/react';
import { LinkIcon } from '@phosphor-icons/react/dist/csr/Link';
import { ProhibitIcon } from '@phosphor-icons/react/dist/csr/Prohibit';
import { UserMinusIcon } from '@phosphor-icons/react/dist/csr/UserMinus';
import { UserPlusIcon } from '@phosphor-icons/react/dist/csr/UserPlus';
import { UsersIcon } from '@phosphor-icons/react/dist/csr/Users';
import { useEffect, useState, type ReactNode } from 'react';

import { AccountAvatar, SignInPage } from '../account/AccountPages.js';
import { useAccount } from '../account/account-state.js';
import { useCommandSource } from '../commands/registry.js';
import { confirmAction } from '../ui/dialog-requests.js';
import { Sheet } from '../ui/Sheet.js';
import {
  SettingsGroup,
  SettingsIcon,
  SettingsLinkRow,
  SettingsSwitchRow,
} from '../ui/SettingsList.js';
import { toast } from '../ui/toast.js';
import { onFriendLink, takeFriendLink } from './friend-link-capture.js';
import {
  findUserId,
  friendInviteLink,
  isUserId,
  lookUpPlayer,
  type FriendAction,
  type FriendEntry,
  type FriendPresence,
  type FriendProfile,
  type FriendsList,
} from './friends-api.js';
import { usePresence, usePresenceMap } from './friends-presence.js';
import { goToRoom, inviteFriend } from './friends-invites.js';
import { useWhere, type LiveWhere } from './friends-live.js';
import {
  changeFriend,
  markRequestsSeen,
  refreshFriends,
  setAppearOffline,
  setFriendsShowing,
  setOpenFriendsHandler,
  useFriends,
} from './friends-state.js';
import {
  backFriendsPage as back,
  closeFriends,
  friendsSheetState,
  openFriends,
  pushFriendsPage as push,
  useFriendsSheet as useSheet,
} from './friends-sheet-state.js';
import '../account/account.css';
import '../session/shell/settings-sheet.css';
import './friends.css';

/**
 * Friends (ADR-055): the app bar's people button opens this sheet. Its
 * first page lists requests, friends, recent players and sent requests;
 * Add a friend takes a User ID or an invite link; a player's page has
 * their actions, with Remove and Block apart.
 */

/** "5 minutes ago", "yesterday", in the page's language. */
const ago = (time: number, locale: string): string => {
  const minutes = Math.round((time - Date.now()) / 60_000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(minutes) < 60)
    return format.format(Math.min(0, minutes), 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, 'hour');
  return format.format(Math.round(hours / 24), 'day');
};

/** A friend's presence: a light, and Online, In a game, Watching or when. */
const PresenceLine = ({
  presence,
}: {
  readonly presence: FriendPresence | undefined;
}) => {
  const { t, i18n } = useLingui();
  const state = presence?.state ?? 'offline';
  const text =
    state === 'online'
      ? t({ message: 'Online', context: 'a friend is online' })
      : state === 'playing'
        ? t({ message: 'In a game', context: 'a friend is playing' })
        : state === 'watching'
          ? t({ message: 'Watching', context: 'a friend is spectating' })
          : presence?.lastSeen
            ? t({
                message: `Last seen ${ago(presence.lastSeen, i18n.locale)}`,
                comment: 'e.g. "Last seen 5 minutes ago"',
              })
            : t({ message: 'Offline', context: 'a friend is offline' });
  return (
    <span className="friends-status" data-state={state}>
      <span className="friends-status__light" aria-hidden="true" />
      {text}
    </span>
  );
};

/** In a game, then watching, then online, then offline by last seen. */
const PRESENCE_RANK: Readonly<Record<FriendPresence['state'], number>> = {
  playing: 0,
  watching: 1,
  online: 2,
  offline: 3,
};

const byPresence =
  (presence: ReadonlyMap<string, FriendPresence>) =>
  (left: FriendEntry, right: FriendEntry): number => {
    const a = presence.get(left.id);
    const b = presence.get(right.id);
    return (
      PRESENCE_RANK[a?.state ?? 'offline'] -
        PRESENCE_RANK[b?.state ?? 'offline'] ||
      (b?.lastSeen ?? 0) - (a?.lastSeen ?? 0) ||
      left.name.localeCompare(right.name)
    );
  };

const formatDate = (time: number, locale: string): string =>
  new Date(time).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

/** A small round button at a row's end. */
const Pill = ({
  id,
  accent = false,
  disabled = false,
  label,
  children,
  onClick,
}: {
  readonly id?: string;
  readonly accent?: boolean;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly children: ReactNode;
  readonly onClick: () => void;
}) => (
  <button
    type="button"
    className="account-pill"
    {...(id ? { id } : {})}
    {...(accent ? { 'data-accent': 'true' } : {})}
    {...(label ? { 'aria-label': label } : {})}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
);

/** A person: avatar, name and a line under it, then what to do. */
const PersonRow = ({
  person,
  subtitle,
  onOpen,
  children,
  rowId,
}: {
  readonly person: Pick<FriendProfile, 'name' | 'avatar'>;
  readonly subtitle?: ReactNode;
  readonly onOpen?: () => void;
  readonly children?: ReactNode;
  readonly rowId?: string;
}) => {
  const text = (
    <>
      <AccountAvatar account={person} size={36} />
      <span className="settings-row__text">
        <span className="settings-row__label">{person.name}</span>
        {subtitle ? (
          <span className="settings-row__subtitle">{subtitle}</span>
        ) : null}
      </span>
    </>
  );
  return (
    <div
      className="settings-row friends-row"
      data-icon="true"
      {...(rowId ? { id: rowId } : {})}
    >
      {onOpen ? (
        <button type="button" className="friends-row__open" onClick={onOpen}>
          {text}
        </button>
      ) : (
        text
      )}
      {children}
      {onOpen && !children ? (
        <CaretRightIcon
          className="settings-row__mark ds-mirror-rtl"
          aria-hidden="true"
          weight="bold"
        />
      ) : null}
    </div>
  );
};

// ---- Playing together (step 3) ---------------------------------------------

type PlayAction = 'invite' | 'ask' | 'watch';

/**
 * What playing with a friend means from here: invite them to this tab's
 * room, ask into theirs, or watch theirs (one they watch, or one this tab
 * can't join as a player). Nothing for a friend offline or already here.
 */
const playActions = (
  where: LiveWhere,
  presence: FriendPresence | undefined
): readonly PlayAction[] => {
  if (!presence || presence.state === 'offline') return [];
  const here = where.kind === 'room' ? where.room : undefined;
  if (presence.room && presence.room === here) return [];
  const actions: PlayAction[] = [];
  if (where.kind === 'room' && where.role === 'player') actions.push('invite');
  if (presence.state === 'playing' && presence.room) actions.push('ask');
  if (presence.room) actions.push('watch');
  return actions;
};

/** The one a friend's row offers. */
const playAction = (
  where: LiveWhere,
  presence: FriendPresence | undefined
): PlayAction | undefined => playActions(where, presence)[0];

const usePlayLabels = () => {
  const { t } = useLingui();
  return {
    invite: t({ message: 'Invite', context: 'invite a friend to my room' }),
    ask: t({ message: 'Ask to join', context: 'ask a friend to let me in' }),
    watch: t({ message: 'Watch', context: 'watch a friend’s game' }),
  } as const;
};

const play = (
  action: PlayAction,
  friend: Pick<FriendProfile, 'id' | 'name'>,
  room: string | undefined
): void => {
  if (action === 'watch') {
    if (room) {
      closeFriends();
      void goToRoom(room, 'spectator', friend.name);
    }
    return;
  }
  void inviteFriend(friend, action);
};

const PlayPill = ({
  action,
  friend,
  room,
}: {
  readonly action: PlayAction;
  readonly friend: Pick<FriendProfile, 'id' | 'name'>;
  readonly room: string | undefined;
}) => {
  const labels = usePlayLabels();
  return (
    <Pill
      id={`friendPlay-${friend.id}`}
      accent={action !== 'watch'}
      onClick={() => play(action, friend, room)}
    >
      {labels[action]}
    </Pill>
  );
};

/** A friend's page: every way to play with them now. */
const PlayRows = ({
  friend,
  presence,
}: {
  readonly friend: Pick<FriendProfile, 'id' | 'name'>;
  readonly presence: FriendPresence | undefined;
}) => {
  const { t } = useLingui();
  const where = useWhere();
  const actions = playActions(where, presence);
  if (actions.length === 0) return null;
  const rows: Readonly<
    Record<PlayAction, { readonly icon: Icon; readonly label: string }>
  > = {
    invite: { icon: PaperPlaneTiltIcon, label: t`Invite to my room` },
    ask: { icon: DoorOpenIcon, label: t`Ask to join` },
    watch: { icon: EyeIcon, label: t`Watch their game` },
  };
  return (
    <SettingsGroup>
      {actions.map((action) => (
        <SettingsLinkRow
          key={action}
          id={`friendPlayRow-${action}`}
          icon={rows[action].icon}
          tone={action === 'watch' ? 'teal' : 'green'}
          label={rows[action].label}
          trailing="none"
          onClick={() => play(action, friend, presence?.room)}
        />
      ))}
    </SettingsGroup>
  );
};

/** Changes a friendship from a button, one at a time. */
const useChange = () => {
  const [busy, setBusy] = useState<string | null>(null);
  const run = (id: string, action: FriendAction): void => {
    if (busy) return;
    setBusy(id);
    void changeFriend(id, action).finally(() => setBusy(null));
  };
  return { busy, run };
};

/** What a player is to this account, by the list. */
const relationOf = (list: FriendsList, id: string) =>
  list.friends.some((entry) => entry.id === id)
    ? 'friend'
    : list.incoming.some((entry) => entry.id === id)
      ? 'incoming'
      : list.outgoing.some((entry) => entry.id === id)
        ? 'outgoing'
        : list.blocked.some((entry) => entry.id === id)
          ? 'blocked'
          : 'none';

const HomePage = () => {
  const { t, i18n } = useLingui();
  const { status, list } = useFriends();
  const presence = usePresenceMap();
  const where = useWhere();
  const { busy, run } = useChange();
  const friends = [...list.friends].sort(byPresence(presence));
  // Coming back to the list reads it again: answers may have come.
  useEffect(() => {
    void refreshFriends();
  }, []);
  useEffect(() => {
    markRequestsSeen();
  }, [list.incoming]);
  const recent = list.recent.filter(
    (entry) => relationOf(list, entry.id) !== 'blocked'
  );
  return (
    <>
      <SettingsGroup>
        <SettingsSwitchRow
          id="friendsAppearOffline"
          icon={EyeSlashIcon}
          tone="slate"
          label={t`Appear offline`}
          subtitle={t`Friends see you as offline.`}
          checked={list.appearOffline}
          disabled={status !== 'ready'}
          onChange={(checked) => void setAppearOffline(checked)}
        />
        <SettingsLinkRow
          id="friendsAddRow"
          icon={UserPlusIcon}
          tone="blue"
          label={t`Add a friend`}
          onClick={() => push({ kind: 'add' })}
        />
      </SettingsGroup>
      {list.incoming.length > 0 ? (
        <SettingsGroup heading={t`Friend requests`} id="friendsRequests">
          {list.incoming.map((entry) => (
            <PersonRow
              key={entry.id}
              rowId={`friendRequest-${entry.id}`}
              person={entry}
              subtitle={t`Wants to be friends`}
            >
              <Pill
                accent
                disabled={busy !== null}
                onClick={() => run(entry.id, 'accept')}
              >
                {t({ message: 'Accept', context: 'a friend request' })}
              </Pill>
              <Pill
                disabled={busy !== null}
                label={t`Decline ${entry.name}`}
                onClick={() => run(entry.id, 'decline')}
              >
                {t({ message: 'Decline', context: 'a friend request' })}
              </Pill>
            </PersonRow>
          ))}
        </SettingsGroup>
      ) : null}
      <SettingsGroup
        heading={t({ message: 'Friends', context: 'the list of friends' })}
        id="friendsList"
      >
        {friends.length === 0 ? (
          <div className="settings-row friends-empty" data-kind="block">
            {status === 'loading' ? (
              <Trans>Loading friends…</Trans>
            ) : status === 'failed' ? (
              <Trans>Couldn't load your friends.</Trans>
            ) : (
              <Trans>
                No friends yet. Share your User ID or invite link to add one.
              </Trans>
            )}
          </div>
        ) : (
          friends.map((entry) => {
            const action = playAction(where, presence.get(entry.id));
            return (
              <PersonRow
                key={entry.id}
                rowId={`friend-${entry.id}`}
                person={entry}
                subtitle={<PresenceLine presence={presence.get(entry.id)} />}
                onOpen={() => push({ kind: 'player', id: entry.id })}
              >
                {action ? (
                  <PlayPill
                    action={action}
                    friend={entry}
                    room={presence.get(entry.id)?.room}
                  />
                ) : null}
              </PersonRow>
            );
          })
        )}
      </SettingsGroup>
      {recent.length > 0 ? (
        <SettingsGroup heading={t`Recent players`} id="friendsRecent">
          {recent.map((entry) => {
            const relation = relationOf(list, entry.id);
            return (
              <PersonRow
                key={entry.id}
                rowId={`recentPlayer-${entry.id}`}
                person={{ name: entry.name, avatar: 'initials' }}
                subtitle={t`Played ${formatDate(entry.playedAt, i18n.locale)}`}
              >
                {relation === 'none' ? (
                  <Pill
                    accent
                    disabled={busy !== null}
                    label={t`Add ${entry.name} as a friend`}
                    onClick={() => run(entry.id, 'request')}
                  >
                    {t({ message: 'Add', context: 'add as a friend' })}
                  </Pill>
                ) : (
                  <span className="friends-row__state">
                    {relation === 'friend'
                      ? t({ message: 'Friends', context: 'already friends' })
                      : relation === 'outgoing'
                        ? t`Request sent`
                        : t`Wants to be friends`}
                  </span>
                )}
              </PersonRow>
            );
          })}
        </SettingsGroup>
      ) : null}
      {list.outgoing.length > 0 ? (
        <SettingsGroup heading={t`Sent requests`} id="friendsSent">
          {list.outgoing.map((entry) => (
            <PersonRow
              key={entry.id}
              rowId={`sentRequest-${entry.id}`}
              person={entry}
              subtitle={t`Request sent`}
            >
              <Pill
                disabled={busy !== null}
                label={t`Cancel request to ${entry.name}`}
                onClick={() => {
                  void confirmAction({
                    title: t`Cancel your friend request to ${entry.name}?`,
                    body: t`You can send another one tomorrow.`,
                    confirmLabel: t`Cancel request`,
                    cancelLabel: t({
                      message: 'Wait',
                      context: 'keep a request',
                    }),
                  }).then((confirmed) => {
                    if (confirmed) run(entry.id, 'cancel');
                  });
                }}
              >
                {t({ message: 'Cancel', context: 'a sent friend request' })}
              </Pill>
            </PersonRow>
          ))}
        </SettingsGroup>
      ) : null}
      {list.blocked.length > 0 ? (
        <SettingsGroup heading={t`Blocked`} id="friendsBlocked">
          {list.blocked.map((entry) => (
            <PersonRow key={entry.id} person={entry}>
              <Pill
                disabled={busy !== null}
                label={t`Unblock ${entry.name}`}
                onClick={() => run(entry.id, 'unblock')}
              >
                {t`Unblock`}
              </Pill>
            </PersonRow>
          ))}
        </SettingsGroup>
      ) : null}
    </>
  );
};

/** Copies text and says so. */
const copy = (text: string, done: string, failed: string): void => {
  void navigator.clipboard.writeText(text).then(
    () => toast({ id: 'friends-copy', title: done, tone: 'success' }),
    () => toast({ id: 'friends-copy', title: failed, tone: 'warning' })
  );
};

type Lookup =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'self' }
  | { readonly kind: 'looking' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'found'; readonly player: FriendProfile };

const AddPage = ({ initial }: { readonly initial?: string }) => {
  const { t } = useLingui();
  const { account } = useAccount();
  const { list } = useFriends();
  const { busy, run } = useChange();
  const [text, setText] = useState(initial ?? '');
  const [lookup, setLookup] = useState<Lookup>({ kind: 'empty' });
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === '') {
      setLookup({ kind: 'empty' });
      return undefined;
    }
    const id = findUserId(trimmed);
    if (!id) {
      setLookup({ kind: 'invalid' });
      return undefined;
    }
    if (id === account?.id) {
      setLookup({ kind: 'self' });
      return undefined;
    }
    setLookup({ kind: 'looking' });
    let current = true;
    const timer = window.setTimeout(() => {
      lookUpPlayer(id).then(
        (player) => {
          if (current) {
            setLookup(player ? { kind: 'found', player } : { kind: 'missing' });
          }
        },
        () => {
          if (current) setLookup({ kind: 'failed' });
        }
      );
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [text, account?.id]);
  const note =
    lookup.kind === 'invalid'
      ? t`That isn't a User ID.`
      : lookup.kind === 'self'
        ? t`That's your own User ID.`
        : lookup.kind === 'looking'
          ? t`Looking…`
          : lookup.kind === 'missing'
            ? t`No player has that ID.`
            : lookup.kind === 'failed'
              ? t`Couldn't look that up. Try again.`
              : undefined;
  const found = lookup.kind === 'found' ? lookup.player : undefined;
  const relation = found ? relationOf(list, found.id) : 'none';
  return (
    <>
      <SettingsGroup
        footer={t`Your friend can copy their User ID from Account, in Settings.`}
      >
        <div className="settings-row" data-kind="block">
          <label className="ds-field friends-add__field">
            <span className="ds-label">{t`User ID or invite link`}</span>
            <input
              id="friendsAddInput"
              className="ds-input"
              autoComplete="off"
              spellCheck={false}
              placeholder={t`Paste a User ID or invite link`}
              value={text}
              aria-invalid={
                lookup.kind === 'invalid' || lookup.kind === 'missing'
                  ? true
                  : undefined
              }
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        </div>
        {note ? (
          <div
            className="settings-row friends-empty"
            data-kind="block"
            id="friendsAddNote"
            role="status"
          >
            {note}
          </div>
        ) : null}
        {found ? (
          <PersonRow person={found} rowId="friendsAddFound">
            {relation === 'none' ? (
              <Pill
                id="friendsAddSend"
                accent
                disabled={busy !== null}
                onClick={() => run(found.id, 'request')}
              >
                {t`Add friend`}
              </Pill>
            ) : relation === 'incoming' ? (
              <Pill
                accent
                disabled={busy !== null}
                onClick={() => run(found.id, 'accept')}
              >
                {t({ message: 'Accept', context: 'a friend request' })}
              </Pill>
            ) : (
              <span className="friends-row__state">
                {relation === 'friend'
                  ? t({ message: 'Friends', context: 'already friends' })
                  : relation === 'outgoing'
                    ? t`Request sent`
                    : t`Blocked`}
              </span>
            )}
          </PersonRow>
        ) : null}
      </SettingsGroup>
      {account ? (
        <SettingsGroup
          heading={t`Your User ID`}
          footer={t`Share it so friends can add you.`}
        >
          <div className="settings-row account-info-row" data-icon="true">
            <SettingsIcon icon={UsersIcon} tone="slate" />
            <span className="settings-row__text">
              <span className="settings-row__label">{t`User ID`}</span>
              <span
                className="settings-row__subtitle account-info-row__value"
                id="friendsOwnId"
              >
                {account.id}
              </span>
            </span>
            <Pill
              id="friendsCopyId"
              onClick={() =>
                copy(
                  account.id,
                  t`User ID copied`,
                  t`Couldn't copy. Try again.`
                )
              }
            >
              {t({ message: 'Copy', context: 'copy to the clipboard' })}
            </Pill>
          </div>
          <div className="settings-row account-info-row" data-icon="true">
            <SettingsIcon icon={LinkIcon} tone="teal" />
            <span className="settings-row__text">
              <span className="settings-row__label">{t`Invite link`}</span>
            </span>
            <Pill
              id="friendsCopyLink"
              onClick={() =>
                copy(
                  friendInviteLink(account.id),
                  t`Invite link copied`,
                  t`Couldn't copy. Try again.`
                )
              }
            >
              {t({ message: 'Copy', context: 'copy to the clipboard' })}
            </Pill>
          </div>
        </SettingsGroup>
      ) : null}
    </>
  );
};

const PlayerPage = ({ id }: { readonly id: string }) => {
  const { t, i18n } = useLingui();
  const { list } = useFriends();
  const { busy, run } = useChange();
  const relation = relationOf(list, id);
  const presence = usePresence(id);
  const entry =
    list.friends.find((item) => item.id === id) ??
    list.incoming.find((item) => item.id === id) ??
    list.outgoing.find((item) => item.id === id);
  const blocked = list.blocked.find((item) => item.id === id);
  const recent = list.recent.find((item) => item.id === id);
  const person: Pick<FriendProfile, 'name' | 'avatar'> = entry ??
    blocked ?? { name: recent?.name ?? '', avatar: 'initials' };
  const subtitle =
    relation === 'friend' && entry
      ? t`Friends since ${formatDate(entry.since, i18n.locale)}`
      : relation === 'incoming'
        ? t`Wants to be friends`
        : relation === 'outgoing'
          ? t`Request sent`
          : relation === 'blocked'
            ? t`Blocked`
            : undefined;
  // Gone from the list (removed, or blocked elsewhere): back to it.
  useEffect(() => {
    if (relation === 'none' && !recent) back();
  }, [relation, recent]);
  return (
    <>
      <SettingsGroup>
        <div
          className="settings-row account-hero"
          data-kind="block"
          id="friendHero"
        >
          <AccountAvatar account={person} size={56} />
          <span className="settings-row__text">
            <span className="settings-row__label">{person.name}</span>
            {relation === 'friend' ? (
              <span className="settings-row__subtitle" id="friendPresence">
                <PresenceLine presence={presence} />
              </span>
            ) : null}
            {subtitle ? (
              <span className="settings-row__subtitle">{subtitle}</span>
            ) : null}
          </span>
        </div>
      </SettingsGroup>
      {relation === 'friend' && entry ? (
        <PlayRows friend={entry} presence={presence} />
      ) : null}
      {relation === 'friend' ? (
        <SettingsGroup>
          <SettingsLinkRow
            id="friendRemove"
            icon={UserMinusIcon}
            tone="slate"
            label={t`Remove friend`}
            trailing="none"
            disabled={busy !== null}
            onClick={() => {
              void confirmAction({
                title: t`Remove ${person.name} as a friend?`,
                body: t`You can send them a new friend request any time.`,
                confirmLabel: t({ message: 'Remove', context: 'a friend' }),
                cancelLabel: t({ message: 'Keep', context: 'a friend' }),
                tone: 'danger',
              }).then((confirmed) => {
                if (confirmed) run(id, 'remove');
              });
            }}
          />
        </SettingsGroup>
      ) : null}
      <SettingsGroup>
        {relation === 'blocked' ? (
          <SettingsLinkRow
            id="friendUnblock"
            icon={ProhibitIcon}
            tone="slate"
            label={t`Unblock`}
            trailing="none"
            disabled={busy !== null}
            onClick={() => run(id, 'unblock')}
          />
        ) : (
          <SettingsLinkRow
            id="friendBlock"
            icon={ProhibitIcon}
            tone="red"
            label={t`Block`}
            danger
            trailing="none"
            disabled={busy !== null}
            onClick={() => {
              void confirmAction({
                title: t`Block ${person.name}?`,
                body: t`You won't be friends, and they can't send you requests or invites. They won't be told.`,
                confirmLabel: t`Block`,
                tone: 'danger',
              }).then((confirmed) => {
                if (confirmed) run(id, 'block');
              });
            }}
          />
        )}
      </SettingsGroup>
    </>
  );
};

const BackButton = () => {
  const { t } = useLingui();
  return (
    <button
      type="button"
      id="friendsBackButton"
      className="settings-back"
      aria-label={t({ message: 'Back', context: 'to the friends page before' })}
      onClick={() => back()}
    >
      <CaretLeftIcon
        aria-hidden="true"
        weight="bold"
        className="ds-mirror-rtl"
      />
    </button>
  );
};

/** The page's one Friends sheet, opened from the bar or a command. */
export const FriendsSheetHost = () => {
  const { t } = useLingui();
  const state = useSheet();
  const { account, status } = useAccount();
  const available = status === 'ready' && account !== null;
  useEffect(() => {
    setOpenFriendsHandler(() => openFriends());
    setFriendsShowing(() => friendsSheetState().open);
    return () => {
      setOpenFriendsHandler(undefined);
      setFriendsShowing(() => false);
    };
  }, []);
  // A friend's invite link opens Friends on them, once the account is
  // known (signed out, at Sign in, to sign in first); a link pasted into
  // this tab later does the same.
  const ready = status === 'ready';
  useEffect(() => {
    if (!ready) return undefined;
    const openLinked = (): void => {
      const id = takeFriendLink();
      if (id && isUserId(id)) openFriends({ kind: 'add', id });
    };
    openLinked();
    onFriendLink(openLinked);
    return () => onFriendLink(undefined);
  }, [ready]);
  useCommandSource(() =>
    available
      ? [
          {
            id: 'friends.open',
            title: t({ message: 'Friends', context: 'the friends sheet' }),
            section: 'room',
            icon: UsersIcon,
            keywords: ['friends', 'people', 'invite'],
            run: () => openFriends(),
          },
          {
            id: 'friends.add',
            title: t`Add a friend`,
            section: 'room',
            icon: UserPlusIcon,
            keywords: ['friend', 'add', 'user id'],
            run: () => openFriends({ kind: 'add' }),
          },
          {
            id: 'friends.copyLink',
            title: t`Copy invite link`,
            section: 'room',
            icon: LinkIcon,
            keywords: ['friend', 'invite', 'link', 'share'],
            run: () =>
              copy(
                friendInviteLink(account.id),
                t`Invite link copied`,
                t`Couldn't copy. Try again.`
              ),
          },
        ]
      : []
  );
  const page = state.stack.at(-1) ?? { kind: 'home' };
  const title = !available
    ? t({ message: 'Friends', context: 'the friends sheet' })
    : page.kind === 'add'
      ? t`Add a friend`
      : page.kind === 'player'
        ? ''
        : t({ message: 'Friends', context: 'the friends sheet' });
  const body = !available ? (
    status === 'ready' ? (
      <SignInPage back={() => undefined} />
    ) : null
  ) : page.kind === 'add' ? (
    <AddPage {...(page.id ? { initial: page.id } : {})} />
  ) : page.kind === 'player' ? (
    <PlayerPage id={page.id} />
  ) : (
    <HomePage />
  );
  const pageKey = page.kind === 'player' ? `player-${page.id}` : page.kind;
  return (
    <Sheet
      open={state.open}
      onOpenChange={(open) => {
        if (!open) closeFriends();
      }}
      title={title}
      {...(available && state.stack.length > 1
        ? { headerLeading: <BackButton /> }
        : {})}
      onEscape={back}
      placement="side"
      size="sm"
      id="friendsSheet"
      className="ptcgsim-settings-sheet ptcgsim-friends-sheet"
    >
      <div
        key={pageKey}
        className="settings-page"
        id={
          !available
            ? 'friendsSignIn'
            : page.kind === 'add'
              ? 'friendsAdd'
              : page.kind === 'player'
                ? 'friendPage'
                : 'friendsHome'
        }
        {...(state.motion ? { 'data-enter': state.motion } : {})}
      >
        {body}
      </div>
    </Sheet>
  );
};
