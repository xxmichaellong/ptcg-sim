import { Trans, useLingui } from '@lingui/react/macro';
import { BroomIcon } from '@phosphor-icons/react/dist/csr/Broom';
import { CalendarBlankIcon } from '@phosphor-icons/react/dist/csr/CalendarBlank';
import { CardsIcon } from '@phosphor-icons/react/dist/csr/Cards';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/csr/DiscordLogo';
import { FlaskIcon } from '@phosphor-icons/react/dist/csr/Flask';
import { GoogleLogoIcon } from '@phosphor-icons/react/dist/csr/GoogleLogo';
import { IdentificationBadgeIcon } from '@phosphor-icons/react/dist/csr/IdentificationBadge';
import { KeyIcon } from '@phosphor-icons/react/dist/csr/Key';
import { LockSimpleIcon } from '@phosphor-icons/react/dist/csr/LockSimple';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { SmileyIcon } from '@phosphor-icons/react/dist/csr/Smiley';
import type { Icon } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { isInputMethodKey } from '../ui/input-method.js';
import {
  SettingsFooter,
  SettingsGroup,
  SettingsIcon,
  SettingsLinkRow,
  type SettingsTone,
} from '../ui/SettingsList.js';
import { toast } from '../ui/toast.js';
import {
  AccountRequestError,
  deleteAccountRequest,
  deleteSignInMethod,
  patchAccount,
  postSignOut,
  type Account,
  type AccountProvider,
} from './account-api.js';
import { emblemFile } from '../card-backs/card-back-emblems.js';
import { AccountReplaysRow } from './AccountReplaysPage.js';
import {
  addDeviceDecks,
  clearAccountFromDevice,
  syncAccountNow,
  useAccountSync,
} from './account-sync.js';
import {
  announceAccountChange,
  providerName,
  refreshAccount,
  replaceAccount,
  startSignIn,
  useAccount,
} from './account-state.js';

import './account.css';

/**
 * The account's pages in Settings (ADR-052), after MagicCircle's account
 * menu (systemMenu/account/, magiccircle.gg 8668411a7e): the row above
 * the player names, Sign in, Account (About me, then the connections,
 * then Delete at the foot), Sign-in methods, Avatar and Delete account.
 */

/** The pages the account adds to Settings. */
export type AccountSettingsPage =
  | 'signIn'
  | 'account'
  | 'accountAvatar'
  | 'signInMethods'
  | 'signOut'
  | 'deleteAccount'
  | 'accountReplays';

export interface AccountPageContext {
  readonly navigate: (page: AccountSettingsPage, opener: string) => void;
  /** Back a page (after deleting, to the first). */
  readonly back: () => void;
}

const PROVIDER_ICONS: Readonly<Record<AccountProvider, Icon>> = {
  google: GoogleLogoIcon,
  discord: DiscordLogoIcon,
  test: FlaskIcon,
};

const PROVIDER_TONES: Readonly<Record<AccountProvider, SettingsTone>> = {
  google: 'blue',
  discord: 'indigo',
  test: 'slate',
};

/** The name's first letter, or the emblem chosen. */
export const AccountAvatar = ({
  account,
  size = 40,
}: {
  readonly account: Pick<Account, 'name' | 'avatar'>;
  readonly size?: number;
}) => {
  const emblem = account.avatar.startsWith('emblem:')
    ? emblemFile(account.avatar.slice('emblem:'.length))
    : undefined;
  const initial = [...account.name.trim()][0]?.toLocaleUpperCase() ?? '?';
  return (
    <span
      className="account-avatar"
      data-kind={emblem ? 'emblem' : 'initials'}
      style={{ '--account-avatar-size': `${String(size)}px` } as CSSProperties}
      aria-hidden="true"
    >
      {emblem ? <img src={emblem} alt="" draggable={false} /> : initial}
    </span>
  );
};

/**
 * Settings' first row: Sign in, or who is signed in. Nothing while the
 * account is unknown, or where no sign-in is offered.
 */
export const AccountRow = ({
  navigate,
}: {
  readonly navigate: (page: AccountSettingsPage, opener: string) => void;
}) => {
  const { t } = useLingui();
  const { account, providers } = useAccount();
  if (account) {
    return (
      <SettingsGroup>
        <button
          type="button"
          id="accountRow"
          className="settings-row account-row"
          data-kind="link"
          onClick={() => navigate('account', 'accountRow')}
        >
          <AccountAvatar account={account} />
          <span className="settings-row__text">
            <span className="settings-row__label">{account.name}</span>
            <span className="settings-row__subtitle">
              {t({ message: 'Account', context: 'settings page' })}
            </span>
          </span>
          <CaretRightIcon
            className="settings-row__mark ds-mirror-rtl"
            aria-hidden="true"
            weight="bold"
          />
        </button>
      </SettingsGroup>
    );
  }
  if (providers.length === 0) return null;
  return (
    <SettingsGroup>
      <button
        type="button"
        id="signInRow"
        className="settings-row account-row"
        data-kind="link"
        onClick={() => navigate('signIn', 'signInRow')}
      >
        <span className="account-avatar" data-kind="empty" aria-hidden="true" />
        <span className="settings-row__text">
          <span className="settings-row__label">{t`Sign in`}</span>
          <span className="settings-row__subtitle">
            {t`Keep decks and replays everywhere`}
          </span>
        </span>
        <CaretRightIcon
          className="settings-row__mark ds-mirror-rtl"
          aria-hidden="true"
          weight="bold"
        />
      </button>
    </SettingsGroup>
  );
};

/** Sign in: one button per provider on offer. */
export const SignInPage = ({ back }: { readonly back: () => void }) => {
  const { t } = useLingui();
  const { account, providers } = useAccount();
  // Signed in (here or in another tab), the page has done its work.
  const signedIn = account !== null;
  useEffect(() => {
    if (signedIn) back();
  }, [signedIn, back]);
  return (
    <>
      <p className="account-lede">
        <Trans>Your decks and replays, on every device.</Trans>
      </p>
      <div className="account-providers">
        {providers.map((provider) => {
          const Glyph = PROVIDER_ICONS[provider];
          const name = providerName(provider);
          return (
            <button
              key={provider}
              type="button"
              id={`signInWith-${provider}`}
              className="account-provider"
              data-provider={provider}
              onClick={() => startSignIn(provider)}
            >
              <Glyph aria-hidden="true" weight="bold" />
              {t`Continue with ${name}`}
            </button>
          );
        })}
      </div>
      <p className="account-fine">
        <Trans>For players 13 and older.</Trans>{' '}
        <a href="/privacy.html" target="_blank" rel="noopener">
          <Trans>Privacy</Trans>
        </a>
      </p>
    </>
  );
};

/** The account's name, saved as it is left (Enter or blur); Esc puts it back. */
const AccountNameField = ({ account }: { readonly account: Account }) => {
  const { t } = useLingui();
  const [name, setName] = useState(account.name);
  const dirty = useRef(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!dirty.current) setName(account.name);
  }, [account.name]);
  const save = () => {
    if (!dirty.current) return;
    dirty.current = false;
    const value = name.replace(/\s+/gu, ' ').trim();
    if (!value || value === account.name) {
      setName(account.name);
      return;
    }
    setName(value);
    patchAccount({ name: value }).then(
      (changed) => {
        replaceAccount(changed);
        announceAccountChange();
      },
      () => {
        dirty.current = true;
        setFailed(true);
      }
    );
  };
  return (
    <label className="ds-field">
      <span className="ds-label">
        <Trans>Name</Trans>
      </span>
      <input
        id="accountName"
        className="ds-input"
        autoComplete="nickname"
        maxLength={32}
        value={name}
        aria-invalid={failed ? true : undefined}
        aria-label={t`Account name`}
        onChange={(event) => {
          dirty.current = true;
          setFailed(false);
          setName(event.target.value);
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (isInputMethodKey(event.nativeEvent)) return;
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            dirty.current = false;
            setFailed(false);
            setName(account.name);
            event.stopPropagation();
          }
        }}
      />
    </label>
  );
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/** A row that only shows something: a label, its value, maybe a button. */
const InfoRow = ({
  icon,
  tone,
  label,
  value,
  action,
}: {
  readonly icon: Icon;
  readonly tone: SettingsTone;
  readonly label: string;
  readonly value: string;
  readonly action?: {
    readonly id: string;
    readonly label: string;
    readonly onClick: () => void;
  };
}) => (
  <div className="settings-row account-info-row" data-icon="true">
    <SettingsIcon icon={icon} tone={tone} />
    <span className="settings-row__text">
      <span className="settings-row__label">{label}</span>
      <span className="settings-row__subtitle account-info-row__value">
        {value}
      </span>
    </span>
    {action ? (
      <button
        type="button"
        id={action.id}
        className="account-pill"
        onClick={action.onClick}
      >
        {action.label}
      </button>
    ) : null}
  </div>
);

/** Account: About me, then the connections, then Delete at the foot. */
export const AccountPage = ({ navigate, back }: AccountPageContext) => {
  const { t, i18n } = useLingui();
  const { account } = useAccount();
  const { deviceDecks } = useAccountSync();
  // Signed out (here or in another tab): nothing to show.
  const signedOut = account === null;
  useEffect(() => {
    if (signedOut) back();
  }, [signedOut, back]);
  if (!account) return null;
  const joined = new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: 'medium',
  }).format(account.createdAt);
  const methods = account.methods
    .map((method) => providerName(method.provider))
    .join(', ');
  return (
    <>
      <SettingsGroup heading={t({ message: 'About me', context: 'account' })}>
        <div className="settings-row account-hero" data-kind="block">
          <AccountAvatar account={account} size={56} />
          <AccountNameField account={account} />
        </div>
        <SettingsLinkRow
          id="accountAvatarRow"
          icon={SmileyIcon}
          tone="orange"
          label={t`Avatar`}
          value={
            account.avatar === 'initials'
              ? t({ message: 'Initial', context: 'avatar' })
              : t({ message: 'Emblem', context: 'avatar' })
          }
          onClick={() => navigate('accountAvatar', 'accountAvatarRow')}
        />
        <InfoRow
          icon={IdentificationBadgeIcon}
          tone="slate"
          label={t`User ID`}
          value={account.id}
          action={{
            id: 'copyAccountId',
            label: t`Copy`,
            onClick: () => {
              void copyText(account.id).then((copied) =>
                toast({
                  title: copied ? t`Copied` : t`Couldn't copy`,
                  tone: copied ? 'success' : 'warning',
                  id: 'account-id-copy',
                })
              );
            },
          }}
        />
        <InfoRow
          icon={CalendarBlankIcon}
          tone="teal"
          label={t({ message: 'Joined', context: 'account' })}
          value={joined}
        />
      </SettingsGroup>
      {/* The account's games (ADR-053). */}
      <AccountReplaysRow
        onOpen={() => navigate('accountReplays', 'accountReplaysRow')}
        onSignIn={() => navigate('signIn', 'accountReplaysSignInRow')}
      />
      <SettingsGroup
        heading={t({ message: 'Connections', context: 'account' })}
      >
        <SettingsLinkRow
          id="signInMethodsRow"
          icon={KeyIcon}
          tone="gold"
          label={t`Sign-in methods`}
          value={methods}
          onClick={() => navigate('signInMethods', 'signInMethodsRow')}
        />
        {deviceDecks > 0 ? (
          <InfoRow
            icon={CardsIcon}
            tone="green"
            label={t`This device's decks`}
            value={
              deviceDecks === 1
                ? t`1 deck not in your account`
                : t`${deviceDecks} decks not in your account`
            }
            action={{
              id: 'addDeviceDecks',
              label: t`Add`,
              onClick: () => {
                void addDeviceDecks().then(() =>
                  toast({
                    title: t`Decks added`,
                    tone: 'success',
                    id: 'account-decks',
                  })
                );
              },
            }}
          />
        ) : null}
        <SettingsLinkRow
          id="signOutButton"
          icon={SignOutIcon}
          tone="slate"
          label={t`Sign out`}
          onClick={() => navigate('signOut', 'signOutButton')}
        />
      </SettingsGroup>
      <SettingsFooter>
        <button
          type="button"
          id="deleteAccountRow"
          className="settings-footer__action"
          data-danger="true"
          onClick={() => navigate('deleteAccount', 'deleteAccountRow')}
        >
          <Trans>Delete account</Trans>
        </button>
      </SettingsFooter>
    </>
  );
};

/**
 * Sign out: keep what the account brought to this device, or clear it (a
 * device that isn't the player's). Either way, changes not yet sent go
 * first.
 */
export const SignOutPage = ({ back }: { readonly back: () => void }) => {
  const { t } = useLingui();
  const { account } = useAccount();
  const [busy, setBusy] = useState(false);
  const signedOut = account === null;
  useEffect(() => {
    if (signedOut) back();
  }, [signedOut, back]);
  if (!account) return null;
  const signOut = (clear: boolean) => {
    setBusy(true);
    const accountId = account.id;
    void syncAccountNow(false)
      .then(() => postSignOut())
      .then(
        async () => {
          if (clear) await clearAccountFromDevice(accountId);
          replaceAccount(null);
          announceAccountChange();
          toast({
            title: clear ? t`Signed out and cleared` : t`Signed out`,
            id: 'account-sign-in',
          });
        },
        () => {
          setBusy(false);
          toast({
            title: t`Couldn't sign out. Try again.`,
            tone: 'danger',
            id: 'account-sign-in',
          });
        }
      );
  };
  return (
    <SettingsGroup>
      <SettingsLinkRow
        id="signOutKeep"
        icon={SignOutIcon}
        tone="slate"
        label={t`Sign out`}
        subtitle={t`Keep your decks and settings here`}
        trailing="none"
        disabled={busy}
        onClick={() => signOut(false)}
      />
      <SettingsLinkRow
        id="signOutClear"
        icon={BroomIcon}
        tone="red"
        label={t`Sign out and clear`}
        subtitle={t`Remove your decks and settings from this device`}
        trailing="none"
        disabled={busy}
        onClick={() => signOut(true)}
      />
    </SettingsGroup>
  );
};

/** Sign-in methods: each provider, connected or not; never none. */
export const SignInMethodsPage = () => {
  const { t } = useLingui();
  const { account, providers } = useAccount();
  const [busy, setBusy] = useState<AccountProvider | null>(null);
  if (!account) return null;
  const shown = providers.filter(
    (provider) =>
      provider !== 'test' ||
      account.methods.some((method) => method.provider === 'test')
  );
  for (const method of account.methods) {
    if (!shown.includes(method.provider)) shown.push(method.provider);
  }
  const only = account.methods.length < 2;
  return (
    <SettingsGroup
      {...(only
        ? {
            footer: (
              <span className="account-lock">
                <LockSimpleIcon aria-hidden="true" weight="bold" />
                {t`Add another sign-in method first. You need at least one.`}
              </span>
            ),
          }
        : {})}
    >
      {shown.map((provider) => {
        const method = account.methods.find(
          (entry) => entry.provider === provider
        );
        const name = providerName(provider);
        const subtitle = method
          ? account.sessionProvider === provider
            ? t`${method.label} · This session`
            : method.label
          : t`Not connected`;
        return (
          <div
            key={provider}
            className="settings-row account-method"
            data-icon="true"
            data-provider={provider}
          >
            <SettingsIcon
              icon={PROVIDER_ICONS[provider]}
              tone={PROVIDER_TONES[provider]}
            />
            <span className="settings-row__text">
              <span className="settings-row__label">{name}</span>
              <span className="settings-row__subtitle">{subtitle}</span>
            </span>
            {method ? (
              <button
                type="button"
                id={`disconnect-${provider}`}
                className="account-pill"
                disabled={only || busy !== null}
                aria-label={t`Disconnect ${name}`}
                onClick={() => {
                  setBusy(provider);
                  deleteSignInMethod(provider).then(
                    (changed) => {
                      setBusy(null);
                      replaceAccount(changed);
                      announceAccountChange();
                    },
                    (error: unknown) => {
                      setBusy(null);
                      if (
                        error instanceof AccountRequestError &&
                        error.status === 401
                      ) {
                        void refreshAccount();
                        return;
                      }
                      toast({
                        title: t`Couldn't disconnect. Try again.`,
                        tone: 'danger',
                        id: 'account-method',
                      });
                    }
                  );
                }}
              >
                {t`Disconnect`}
              </button>
            ) : providers.includes(provider) ? (
              <button
                type="button"
                id={`connect-${provider}`}
                className="account-pill"
                data-accent="true"
                disabled={busy !== null}
                aria-label={t`Connect ${name}`}
                onClick={() => startSignIn(provider, 'link')}
              >
                {t`Connect`}
              </button>
            ) : null}
          </div>
        );
      })}
    </SettingsGroup>
  );
};

/** How long Delete must be held. */
export const HOLD_TO_DELETE_MS = 1200;

/**
 * A button that acts only once held down (pointer, Space or Enter) for
 * `HOLD_TO_DELETE_MS`, filling as it goes; letting go early undoes it.
 */
export const HoldButton = ({
  id,
  label,
  disabled = false,
  onHeld,
}: {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onHeld: () => void;
}) => {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const stop = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };
  const start = () => {
    if (disabled || timer.current !== undefined) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      onHeld();
    }, HOLD_TO_DELETE_MS);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      id={id}
      className="account-hold"
      data-holding={holding ? 'true' : undefined}
      disabled={disabled}
      style={
        {
          '--account-hold-ms': `${String(HOLD_TO_DELETE_MS)}ms`,
        } as CSSProperties
      }
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') stop();
      }}
      onBlur={stop}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="account-hold__fill" aria-hidden="true" />
      <span className="account-hold__label">{label}</span>
    </button>
  );
};

/** Delete account: what goes, then Hold to delete. */
export const DeleteAccountPage = ({ back }: { readonly back: () => void }) => {
  const { t } = useLingui();
  const { account } = useAccount();
  const [busy, setBusy] = useState(false);
  if (!account) return null;
  return (
    <>
      <SettingsGroup>
        <div className="settings-row account-hero" data-kind="block">
          <AccountAvatar account={account} />
          <span className="settings-row__text">
            <span className="settings-row__label">{account.name}</span>
            <span className="settings-row__subtitle">{account.id}</span>
          </span>
        </div>
      </SettingsGroup>
      <p className="account-warning">
        <Trans>
          Deletes your account and its sign-in methods for good. Decks on this
          device stay.
        </Trans>
      </p>
      <HoldButton
        id="deleteAccountButton"
        label={t`Hold to delete`}
        disabled={busy}
        onHeld={() => {
          setBusy(true);
          deleteAccountRequest(account.id).then(
            () => {
              replaceAccount(null);
              announceAccountChange();
              toast({ title: t`Account deleted`, id: 'account-sign-in' });
              back();
            },
            (error: unknown) => {
              setBusy(false);
              // Signed out meanwhile (or deleted from another device):
              // the account as it now is says so.
              if (
                error instanceof AccountRequestError &&
                error.status === 401
              ) {
                void refreshAccount();
                return;
              }
              toast({
                title: t`Couldn't delete. Try again.`,
                tone: 'danger',
                id: 'account-delete',
              });
            }
          );
        }}
      />
    </>
  );
};
