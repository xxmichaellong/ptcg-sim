import { CardsIcon } from '@phosphor-icons/react/dist/csr/Cards';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/csr/DiscordLogo';
import { HandPointingIcon } from '@phosphor-icons/react/dist/csr/HandPointing';
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { PlayCircleIcon } from '@phosphor-icons/react/dist/csr/PlayCircle';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';

import { chordKeycaps, detectKeyboardPlatform } from '../../hotkeys/chords.js';
import { useKeymap } from '../../hotkeys/hotkey-preferences.js';
import { openShortcutsDialog } from '../../hotkeys/shortcuts-dialog-state.js';
import { COARSE_POINTER_QUERY, useMediaQuery } from '../../ui/breakpoints.js';
import {
  DISCORD_URL,
  openHelpPage,
  RELEASE_NAME,
  REPOSITORY_URL,
} from './help-pages.js';
import './table-welcome.css';

const LOGO_URL = '/v2/assets/blank-logo.png';
const decorative = { 'aria-hidden': true, focusable: false } as const;

/** How to play, said for the hand the player is holding. */
const PlayTip = () => {
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  const opener = useKeymap().chord('table.shortcuts');
  if (touch) {
    return (
      <>Drag to play. Tap a card for its actions; tap it again to read it.</>
    );
  }
  return (
    <>
      Drag to play. Double-click to read. Right-click for actions.
      {opener ? (
        <>
          {' '}
          Press{' '}
          {chordKeycaps(opener, detectKeyboardPlatform()).map((cap) => (
            <kbd className="ds-kbd" key={cap}>
              {cap}
            </kbd>
          ))}{' '}
          for{' '}
          <button
            type="button"
            className="welcome-shortcuts-link"
            onClick={() => openShortcutsDialog()}
          >
            shortcuts
          </button>
          .
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
  onPlayOnline,
  onDismiss,
}: {
  readonly onLoadDeck?: () => void;
  readonly onPlayOnline?: () => void;
  readonly onDismiss?: () => void;
}) => (
  <section
    className="table-welcome"
    aria-labelledby="tableWelcomeTitle"
    data-table-welcome="true"
  >
    {onDismiss ? (
      <button
        type="button"
        className="ds-icon-button table-welcome__dismiss"
        aria-label="Hide welcome"
        onClick={onDismiss}
      >
        <XIcon {...decorative} weight="bold" />
      </button>
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
        <h2 id="tableWelcomeTitle">Welcome to PTCG-sim</h2>
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
      </div>
    </header>
    <p className="table-welcome__lead">
      An{' '}
      <a
        className="ds-link"
        href={REPOSITORY_URL}
        target="_blank"
        rel="noreferrer"
      >
        open-source
      </a>{' '}
      Pokémon TCG table. Practice both sides, or play a friend online.
    </p>
    <ol className="table-welcome__steps">
      <li>
        <CardsIcon {...decorative} />
        <span>
          Load a <strong>deck</strong>, then press <strong>Set up</strong>.
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
          <CardsIcon {...decorative} weight="bold" />
          Load a deck
        </button>
      ) : null}
      {onPlayOnline ? (
        <button
          type="button"
          className="ds-button ds-button--secondary"
          onClick={onPlayOnline}
        >
          <UsersThreeIcon {...decorative} weight="bold" />
          Play online
        </button>
      ) : null}
    </div>
    <footer className="table-welcome__links">
      <button
        id="tutorialButton"
        type="button"
        className="ds-link"
        aria-haspopup="dialog"
        onClick={() => openHelpPage('tutorial')}
      >
        <PlayCircleIcon {...decorative} weight="bold" />
        Tutorial
      </button>
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
      <button
        id="donationsLink"
        type="button"
        className="ds-link"
        aria-haspopup="dialog"
        onClick={() => openHelpPage('donations')}
      >
        <HeartIcon {...decorative} weight="fill" />
        Sponsors
      </button>
    </footer>
  </section>
);
