import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { LinkIcon } from '@phosphor-icons/react/dist/csr/Link';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { UserIcon } from '@phosphor-icons/react/dist/csr/User';
import { ROOM_ALIAS_MAX_LENGTH } from '@ptcgsim/protocol';
import { useEffect, useState, type FormEvent } from 'react';

import { Sheet } from '../../ui/Sheet.js';
import {
  roomCodeFieldValue,
  type RoomCodeChangeOutcome,
} from '../room-code.js';
import './room-sheet.css';

const decorative = { 'aria-hidden': true, focusable: false } as const;

export interface RoomPeople {
  /** Each seat's player, by name; `here` while they are connected. */
  readonly players: readonly {
    readonly name: string;
    readonly here: boolean;
  }[];
  readonly watching: number;
}

/**
 * The room (ADR-047), from the bar's room code: the code to read out or
 * copy, the invite link, who is here, the host's choice of another code,
 * and the way out.
 */
export const RoomSheet = ({
  open,
  onOpenChange,
  code,
  asking = false,
  onAskAgain,
  canChange,
  people,
  onCopyCode,
  onInvite,
  onChangeCode,
  onLeave,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly code: string | undefined;
  /** The room is being asked for its code. */
  readonly asking?: boolean;
  /** Asks the room for a code that hasn't come. */
  readonly onAskAgain?: () => void;
  readonly canChange: boolean;
  readonly people: RoomPeople;
  readonly onCopyCode: () => void;
  readonly onInvite: () => void;
  readonly onChangeCode: (value: string) => Promise<RoomCodeChangeOutcome>;
  readonly onLeave?: () => void;
}) => {
  const { t } = useLingui();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<RoomCodeChangeOutcome>();
  // Each time it opens, the field starts empty.
  useEffect(() => {
    if (!open) return;
    setDraft('');
    setOutcome(undefined);
  }, [open]);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (saving || draft.length === 0) return;
    setSaving(true);
    void onChangeCode(draft)
      .then((result) => {
        setOutcome(result);
        if (result === 'changed') setDraft('');
      })
      .finally(() => setSaving(false));
  };
  const status =
    outcome === 'changed'
      ? t`Code changed`
      : outcome === 'code_taken'
        ? t`That code is taken`
        : outcome === 'invalid'
          ? t({
              message: '4–12 letters or digits, no I, O, 0 or 1',
              comment: 'The rule for a room code',
            })
          : outcome === 'not_host'
            ? t`Only the host can change it`
            : outcome === 'failed'
              ? t`Couldn't change it. Try again.`
              : undefined;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t({ message: 'Room', context: 'an online room' })}
      size="sm"
      id="roomSheet"
      className="ptcgsim-room-sheet"
    >
      <div className="room-sheet">
        <section className="room-sheet__code" aria-labelledby="roomCodeLabel">
          <span id="roomCodeLabel" className="room-sheet__label">
            <Trans>Room code</Trans>
          </span>
          <div className="room-sheet__code-row">
            <output
              id="roomCodeValue"
              className="room-sheet__code-value"
              aria-live="polite"
            >
              {code ?? '····'}
            </output>
            <button
              id="copyRoomCodeButton"
              type="button"
              className="ds-button ds-button--secondary"
              disabled={!code}
              onClick={onCopyCode}
            >
              <CopyIcon {...decorative} weight="bold" />
              <Trans context="copy to the clipboard">Copy</Trans>
            </button>
          </div>
          {code ? (
            <button
              id="copyInviteLinkButton"
              type="button"
              className="ds-button ds-button--primary room-sheet__invite"
              onClick={onInvite}
            >
              <LinkIcon {...decorative} weight="bold" />
              <Trans>Copy invite link</Trans>
            </button>
          ) : asking ? (
            // Not here yet: the room is being asked.
            <p id="roomCodeAsking" className="ds-hint" role="status">
              <Trans>Loading…</Trans>
            </p>
          ) : onAskAgain ? (
            // It didn't come (the room was busy, or the network): ask again.
            <button
              id="roomCodeAskAgainButton"
              type="button"
              className="ds-button ds-button--secondary room-sheet__invite"
              onClick={onAskAgain}
            >
              <ArrowClockwiseIcon {...decorative} weight="bold" />
              <Trans>Try again</Trans>
            </button>
          ) : null}
        </section>

        {canChange ? (
          <form className="room-sheet__change" onSubmit={submit}>
            <label className="ds-label" htmlFor="roomCodeEditInput">
              <Trans>Change code</Trans>
            </label>
            <div className="room-sheet__change-row">
              <input
                id="roomCodeEditInput"
                className="ds-input room-sheet__change-input"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={ROOM_ALIAS_MAX_LENGTH}
                placeholder={code ?? ''}
                value={draft}
                disabled={saving}
                aria-describedby={status ? 'roomCodeEditStatus' : undefined}
                onChange={(event) => {
                  setDraft(roomCodeFieldValue(event.target.value));
                  setOutcome(undefined);
                }}
              />
              <button
                id="saveRoomCodeButton"
                type="submit"
                className="ds-button ds-button--secondary"
                disabled={saving || draft.length === 0}
              >
                <Trans context="save a change">Save</Trans>
              </button>
            </div>
            {status ? (
              <p
                id="roomCodeEditStatus"
                className="ds-hint"
                role="status"
                data-outcome={outcome}
              >
                {status}
              </p>
            ) : null}
          </form>
        ) : null}

        <section
          className="room-sheet__people"
          aria-labelledby="roomPeopleLabel"
        >
          <span id="roomPeopleLabel" className="room-sheet__label">
            <Trans context="the people in a room">Here</Trans>
          </span>
          <ul className="room-sheet__people-list">
            {people.players.map((player, index) => (
              <li key={index} data-here={player.here ? 'true' : 'false'}>
                <UserIcon {...decorative} weight="bold" />
                <span>{player.name}</span>
              </li>
            ))}
            {people.players.length < 2 ? (
              <li className="room-sheet__open-seat" data-here="false">
                <UserIcon {...decorative} weight="bold" />
                <span>
                  <Trans>Open seat</Trans>
                </span>
              </li>
            ) : null}
            {people.watching > 0 ? (
              <li data-here="true">
                <EyeIcon {...decorative} weight="bold" />
                <span>
                  {t`${plural(people.watching, { one: '# watching', other: '# watching' })}`}
                </span>
              </li>
            ) : null}
          </ul>
        </section>

        {onLeave ? (
          <button
            id="roomSheetLeaveButton"
            type="button"
            className="ds-button ds-button--ghost room-sheet__leave"
            onClick={onLeave}
          >
            <SignOutIcon {...decorative} weight="bold" />
            <Trans>Leave room</Trans>
          </button>
        ) : null}
      </div>
    </Sheet>
  );
};
