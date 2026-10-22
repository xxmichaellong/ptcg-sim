import { Trans, useLingui } from '@lingui/react/macro';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/csr/DiscordLogo';
import { GraduationCapIcon } from '@phosphor-icons/react/dist/csr/GraduationCap';
import { HandPointingIcon } from '@phosphor-icons/react/dist/csr/HandPointing';
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { XLogoIcon } from '@phosphor-icons/react/dist/csr/XLogo';

import { chordKeycaps, detectKeyboardPlatform } from '../../hotkeys/chords.js';
import { useKeymap } from '../../hotkeys/hotkey-preferences.js';
import { openShortcutsDialog } from '../../hotkeys/shortcuts-dialog-state.js';
import { COARSE_POINTER_QUERY, useMediaQuery } from '../../ui/breakpoints.js';
import { DeckIcon } from '../../ui/DeckIcon.js';
import { Tooltip } from '../../ui/Tooltip.js';
import {
  DISCORD_URL,
  openHelpPage,
  RELEASE_NAME,
  REPOSITORY_URL,
  TWITTER_HANDLE,
  TWITTER_URL,
} from './help-pages.js';
import './table-welcome.css';

const LOGO_URL = '/v2/assets/blank-logo.png';
const decorative = { 'aria-hidden': true, focusable: false } as const;

/** How to play, said for the hand the player is holding. */
const PlayTip = () => {
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  const opener = useKeymap().chord('table.shortcuts');
  // Only what a first visit would not find on its own: dragging and
  // double-clicking are what anyone tries first.
  if (touch) {
    return <Trans>Tap a card for actions; tap again to read it.</Trans>;
  }
  const keys = opener
    ? chordKeycaps(opener, detectKeyboardPlatform()).map((cap) => (
        <kbd className="ds-kbd" key={cap}>
          {cap}
        </kbd>
      ))
    : null;
  return (
    <>
      <Trans>Right-click a card for actions.</Trans>
      {keys ? (
        <>
          {' '}
          <Trans comment="keys shows the key or keys that open the keyboard shortcuts, like ?">
            Press {keys} for{' '}
            <button
              type="button"
              className="welcome-shortcuts-link"
              onClick={() => openShortcutsDialog()}
            >
              shortcuts
            </button>
            .
          </Trans>
        </>
      ) : null}
    </>
  );
};

/**
 * The empty table's welcome (ADR-030): what the sim is and the one thing to
 * do next -- load a deck -- in a card on the felt. It goes away once a deck
 * is on the table; the menu keeps the same help.
 */
export const TableWelcome = ({
  onLoadDeck,
  onTutorial,
  onPlayOnline,
  onDismiss,
}: {
  readonly onLoadDeck?: () => void;
  /** Opens the tutorial's lessons (ADR-038). */
  readonly onTutorial?: () => void;
  readonly onPlayOnline?: () => void;
  readonly onDismiss?: () => void;
}) => {
  const { t } = useLingui();
  return (
    <section
      className="table-welcome"
      aria-labelledby="tableWelcomeTitle"
      data-table-welcome="true"
    >
      {onDismiss ? (
        <Tooltip content={t`Hide welcome`} side="bottom">
          <button
            type="button"
            className="ds-icon-button table-welcome__dismiss"
            aria-label={t`Hide welcome`}
            onClick={onDismiss}
          >
            <XIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
      ) : null}
      <header className="table-welcome__hero">
        <img
          className="table-welcome__logo"
          src={LOGO_URL}
          alt=""
          width="48"
          height="48"
          decoding="async"
        />
        <div>
          <h2 id="tableWelcomeTitle">
            <Trans>Welcome to PTCG-sim</Trans>
          </h2>
          <Tooltip content={t`What's new`} side="bottom">
            <button
              id="changelogLink"
              type="button"
              className="welcome-version"
              aria-haspopup="dialog"
              onClick={() => openHelpPage('changelog')}
            >
              <SparkleIcon {...decorative} weight="fill" />
              <span className="welcome-version-label">{RELEASE_NAME}</span>
            </button>
          </Tooltip>
        </div>
      </header>
      <p className="table-welcome__lead">
        <Trans>
          An{' '}
          <a
            className="ds-link"
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
          >
            open-source
          </a>{' '}
          Pokémon TCG table.
        </Trans>
      </p>
      <ol className="table-welcome__steps">
        <li>
          <DeckIcon {...decorative} />
          <span>
            <Trans>
              Load a <strong>deck</strong>, then press <strong>Set up</strong>.
            </Trans>
          </span>
        </li>
        <li>
          <HandPointingIcon {...decorative} />
          <span>
            <PlayTip />
          </span>
        </li>
      </ol>
      <div className="table-welcome__actions">
        {onLoadDeck ? (
          <button
            id="welcomeLoadDeckButton"
            type="button"
            className="ds-button ds-button--primary"
            onClick={onLoadDeck}
          >
            <DeckIcon {...decorative} weight="bold" />
            <Trans>Load a deck</Trans>
          </button>
        ) : null}
        {onTutorial ? (
          <button
            id="welcomeTutorialButton"
            type="button"
            className="ds-button ds-button--secondary"
            onClick={onTutorial}
          >
            <GraduationCapIcon {...decorative} weight="bold" />
            <Trans>Tutorial</Trans>
          </button>
        ) : null}
        {onPlayOnline ? (
          <button
            type="button"
            className="ds-button ds-button--secondary"
            onClick={onPlayOnline}
          >
            <UsersThreeIcon {...decorative} weight="bold" />
            <Trans>Play online</Trans>
          </button>
        ) : null}
      </div>
      <footer className="table-welcome__links">
        <a
          id="discordLink"
          className="ds-link"
          href={DISCORD_URL}
          target="_blank"
          rel="noreferrer"
        >
          <DiscordLogoIcon {...decorative} weight="fill" />
          Discord
        </a>
        <a
          id="twitterLink"
          className="ds-link"
          href={TWITTER_URL}
          target="_blank"
          rel="noreferrer"
        >
          <XLogoIcon {...decorative} weight="bold" />
          {TWITTER_HANDLE}
        </a>
        <button
          id="donationsLink"
          type="button"
          className="ds-link"
          aria-haspopup="dialog"
          onClick={() => openHelpPage('donations')}
        >
          <HeartIcon {...decorative} weight="fill" />
          <Trans>Sponsors</Trans>
        </button>
      </footer>
    </section>
  );
};
