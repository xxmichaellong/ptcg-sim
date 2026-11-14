import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { FilmReelIcon } from '@phosphor-icons/react/dist/csr/FilmReel';
import { LinkSimpleIcon } from '@phosphor-icons/react/dist/csr/LinkSimple';
import { StarIcon } from '@phosphor-icons/react/dist/csr/Star';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { useEffect, useState } from 'react';

import { SettingsGroup, SettingsLinkRow } from '../ui/SettingsList.js';
import { Tooltip } from '../ui/Tooltip.js';
import { toast } from '../ui/toast.js';
import { AccountRequestError } from './account-api.js';
import { useReplayTable, watchReplay } from './account-replay-player.js';
import { useAccount } from './account-state.js';
import {
  deleteAccountReplay,
  fetchAccountReplays,
  setReplayStarred,
  shareAccountReplay,
  type AccountReplay,
} from './replay-api.js';

import './account-replays.css';

/**
 * Your games (ADR-053): what the account kept of the games played signed
 * in, newest first. A game is watched from its row (on the Solo table),
 * starred to keep it past the last 100, shared by a link that opens it as
 * a spectator sees it, or deleted (once unstarred).
 */

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * The row that leads here, in a group of its own: from Saves & replays,
 * and from the account. Signed out, it offers to sign in where one can.
 */
export const AccountReplaysRow = ({
  onOpen,
  onSignIn,
}: {
  readonly onOpen: () => void;
  readonly onSignIn: () => void;
}) => {
  const { t } = useLingui();
  const { status, account, providers } = useAccount();
  if (status !== 'ready') return null;
  if (account) {
    return (
      <SettingsGroup>
        <SettingsLinkRow
          id="accountReplaysRow"
          icon={FilmReelIcon}
          tone="gold"
          label={t`Your games`}
          onClick={onOpen}
        />
      </SettingsGroup>
    );
  }
  if (providers.length === 0) return null;
  return (
    <SettingsGroup>
      <SettingsLinkRow
        id="accountReplaysSignInRow"
        icon={FilmReelIcon}
        tone="gold"
        label={t`Your games`}
        subtitle={t`Sign in to keep your games`}
        onClick={onSignIn}
      />
    </SettingsGroup>
  );
};

const opponentOf = (replay: AccountReplay): string | undefined => {
  const index = replay.playerOrder.indexOf(replay.viewer);
  const other = replay.players.find((_, seat) => seat !== index);
  return other && other.trim() !== '' ? other : undefined;
};

/** When the list is read again after the page opens. */
const REREAD_AFTER_MS = [3_000, 10_000] as const;

export const AccountReplaysPage = ({
  leave,
  back,
}: {
  /** Puts Settings away, for the table to play. */
  readonly leave: () => void;
  readonly back: () => void;
}) => {
  const { t, i18n } = useLingui();
  const { account } = useAccount();
  const table = useReplayTable();
  const [replays, setReplays] = useState<readonly AccountReplay[]>();
  const [busy, setBusy] = useState<string>();
  const signedOut = account === null;
  useEffect(() => {
    if (signedOut) back();
  }, [signedOut, back]);
  useEffect(() => {
    if (!account) return undefined;
    let live = true;
    const read = (first: boolean) =>
      fetchAccountReplays().then(
        (found) => {
          if (live) setReplays(found);
        },
        () => {
          if (!live || !first) return;
          setReplays([]);
          toast({
            title: t`Couldn't load your games. Try again.`,
            tone: 'danger',
            id: 'account-replays',
          });
        }
      );
    void read(true);
    // The room files a game just after it ends, so one that ended a moment
    // ago may not be listed yet: read again shortly.
    const timers = REREAD_AFTER_MS.map((delay) =>
      setTimeout(() => void read(false), delay)
    );
    return () => {
      live = false;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [account, t]);
  if (!account) return null;
  const when = new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const replace = (id: string, change: Partial<AccountReplay> | null) =>
    setReplays((current) =>
      current?.flatMap((replay) =>
        replay.id !== id
          ? [replay]
          : change === null
            ? []
            : [{ ...replay, ...change }]
      )
    );
  const act = (id: string, run: () => Promise<void>) => {
    setBusy(id);
    run().finally(() => setBusy(undefined));
  };
  const star = (replay: AccountReplay) =>
    act(replay.id, async () => {
      try {
        await setReplayStarred(replay.id, !replay.starred);
        replace(replay.id, { starred: !replay.starred });
      } catch (error) {
        toast({
          title:
            error instanceof AccountRequestError && error.code === 'star_limit'
              ? t`50 games are starred. Unstar one first.`
              : t`Couldn't change that. Try again.`,
          tone: 'warning',
          id: 'account-replays',
        });
      }
    });
  const share = (replay: AccountReplay) =>
    act(replay.id, async () => {
      try {
        const link = await shareAccountReplay(replay.id);
        replace(replay.id, { shareLink: link });
        const copied = await copyText(link);
        toast({
          title: copied ? t`Link copied` : t`Couldn't copy the link`,
          tone: copied ? 'success' : 'warning',
          id: 'account-replays',
        });
      } catch {
        toast({
          title: t`Couldn't share that. Try again.`,
          tone: 'danger',
          id: 'account-replays',
        });
      }
    });
  const remove = (replay: AccountReplay) =>
    act(replay.id, async () => {
      try {
        await deleteAccountReplay(replay.id);
        replace(replay.id, null);
        toast({ title: t`Game deleted`, id: 'account-replays' });
      } catch {
        toast({
          title: t`Couldn't delete that. Try again.`,
          tone: 'danger',
          id: 'account-replays',
        });
      }
    });
  const watch = (replay: AccountReplay) => {
    leave();
    void watchReplay({ kind: 'own', id: replay.id });
  };
  if (replays === undefined) {
    return <div className="account-replays__loading" aria-busy="true" />;
  }
  return (
    <>
      {replays.length === 0 ? (
        <p className="account-replays__empty">
          {t`Games you play signed in show up here.`}
        </p>
      ) : (
        <SettingsGroup>
          {replays.map((replay) => {
            const opponent = opponentOf(replay);
            const title =
              replay.mode === 'solo'
                ? t`Solo game`
                : opponent
                  ? t({
                      message: `vs ${opponent}`,
                      comment: 'A game against the named player',
                    })
                  : t`Online game`;
            const moves = replay.moves;
            const detail = `${when.format(replay.filedAt)} · ${t`${plural(moves, { one: '# move', other: '# moves' })}`}`;
            const disabled = busy === replay.id;
            return (
              <div
                key={replay.id}
                className="settings-row account-replay"
                data-replay={replay.id}
              >
                <button
                  type="button"
                  className="account-replay__watch"
                  disabled={!table.ready || table.loading}
                  onClick={() => watch(replay)}
                >
                  <span className="settings-row__text">
                    <span className="settings-row__label">{title}</span>
                    <span className="settings-row__subtitle">{detail}</span>
                  </span>
                </button>
                <Tooltip content={replay.starred ? t`Unstar` : t`Star to keep`}>
                  <button
                    type="button"
                    className="account-replay__action"
                    data-action="star"
                    aria-label={replay.starred ? t`Unstar` : t`Star to keep`}
                    aria-pressed={replay.starred}
                    disabled={disabled}
                    onClick={() => star(replay)}
                  >
                    <StarIcon
                      aria-hidden="true"
                      weight={replay.starred ? 'fill' : 'bold'}
                    />
                  </button>
                </Tooltip>
                <Tooltip content={t`Copy share link`}>
                  <button
                    type="button"
                    className="account-replay__action"
                    data-action="share"
                    aria-label={t`Copy share link`}
                    disabled={disabled}
                    onClick={() => share(replay)}
                  >
                    <LinkSimpleIcon aria-hidden="true" weight="bold" />
                  </button>
                </Tooltip>
                {replay.starred ? null : (
                  <Tooltip content={t`Delete`}>
                    <button
                      type="button"
                      className="account-replay__action"
                      data-action="delete"
                      data-danger="true"
                      aria-label={t`Delete`}
                      disabled={disabled}
                      onClick={() => remove(replay)}
                    >
                      <TrashIcon aria-hidden="true" weight="bold" />
                    </button>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </SettingsGroup>
      )}
      <p className="account-replays__fine">
        {table.ready
          ? t`The last 100 are kept. Starred games stay.`
          : t`Watch from your Solo table. The last 100 are kept, and starred games stay.`}
      </p>
    </>
  );
};
