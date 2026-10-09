import { CardsIcon } from '@phosphor-icons/react/dist/csr/Cards';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/csr/DiscordLogo';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { KeyboardIcon } from '@phosphor-icons/react/dist/csr/Keyboard';
import { PlayCircleIcon } from '@phosphor-icons/react/dist/csr/PlayCircle';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import changelogMarkup from './legacy-changelog.html?raw';

import '../design/panel-controls.css';
import './welcome.css';

const TUTORIAL_EMBED_URL =
  'https://www.youtube.com/embed/t3qAhO_p3mk?si=jxysgkLxaAoaSw1I';
const REPOSITORY_URL = 'https://github.com/xxmichaellong/ptcg-sim';
const DISCORD_URL = 'https://discord.gg/jMfhQa38mh';
const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/xxmichaellong?o=esc';
const PAYPAL_URL =
  'https://www.paypal.com/donate/?hosted_button_id=VWFSCL73GDHF4';
const LOGO_URL = '/v2/assets/blank-logo.png';

type WelcomePage = 'tutorial' | 'donations' | 'changelog';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

/**
 * One of the welcome pages (tutorial, release notes, sponsors) as a modal
 * sheet. As in v1, a click anywhere on it -- or Escape -- closes it; the
 * close button makes that visible and takes focus while it is open.
 */
const WelcomeSheet = ({
  id,
  label,
  labelledBy,
  className,
  onClose,
  children,
}: {
  readonly id: string;
  readonly label?: string;
  readonly labelledBy?: string;
  readonly className?: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) => {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      id={id}
      className={`welcome-overlay${className ? ` ${className}` : ''}`}
      data-open="true"
      role="dialog"
      aria-modal="true"
      {...(labelledBy
        ? { 'aria-labelledby': labelledBy }
        : { 'aria-label': label })}
      onClick={onClose}
    >
      <div className="welcome-sheet">
        <button
          ref={closeButton}
          type="button"
          className="ds-icon-button welcome-sheet-close"
          aria-label="Close"
          onClick={onClose}
        >
          <XIcon {...decorative} weight="bold" />
        </button>
        {children}
      </div>
    </div>
  );
};

/**
 * The opening card of the Solo panel (`#chatbox` in v1's index.ejs): what the
 * sim is, how to start, the tutorial video, the Discord, and the Sponsors &
 * Donations page. It sits at the top of the activity feed; v1's Clear battle
 * log wipes it with the rest of the panel, which the surface reproduces.
 */
export const LegacyWelcome = ({
  buildId = import.meta.env.VITE_PTCGSIM_BUILD_ID || 'v2',
  onLoadDeck,
}: {
  readonly buildId?: string;
  /** Opens the Deck tab; the primary action is shown only when given. */
  readonly onLoadDeck?: () => void;
}) => {
  const [page, setPage] = useState<WelcomePage | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (page === null) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPage(null);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [page]);
  useEffect(() => {
    if (page !== null) return;
    // Focus goes back to whatever opened the page, if it is still there.
    const previous = opener.current;
    opener.current = null;
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  }, [page]);

  const open = (next: WelcomePage, toggle = false): void => {
    if (page === null && document.activeElement instanceof HTMLElement) {
      opener.current = document.activeElement;
    }
    setPage((current) => (toggle && current === next ? null : next));
  };
  const close = (): void => setPage(null);

  return (
    <div className="welcome-card">
      <header className="welcome-hero">
        <img
          className="welcome-logo"
          src={LOGO_URL}
          alt=""
          width="52"
          height="52"
          decoding="async"
        />
        <div className="welcome-heading">
          <strong className="welcome-title">Welcome to PTCG-sim!</strong>
          <button
            id="changelogLink"
            type="button"
            className="welcome-version"
            aria-expanded={page === 'changelog'}
            aria-haspopup="dialog"
            onClick={() => open('changelog', true)}
          >
            <SparkleIcon {...decorative} weight="fill" />
            <span className="welcome-version-build">{buildId}</span>
            <span className="welcome-version-label">What&apos;s new</span>
          </button>
        </div>
      </header>
      <p className="welcome-lead">
        PTCG-sim is an{' '}
        <a
          className="ds-link"
          href={REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
        >
          open-source
        </a>{' '}
        Pokémon Trading Card Game (Pokémon TCG) tabletop simulator. It supports
        single player and online multiplayer.
      </p>
      <ul className="welcome-steps">
        <li>
          <CardsIcon {...decorative} />
          <span>
            Use the <strong>Deck</strong> tab above to import your deck, then
            press <strong>Set Up</strong> to start a game.
          </span>
        </li>
        <li>
          <KeyboardIcon {...decorative} />
          <span>
            Drag or use keybinds (hold{' '}
            <kbd className="ds-kbd shift-font">Shift</kbd>) to move cards.
          </span>
        </li>
        <li>
          <FloppyDiskIcon {...decorative} />
          <span>
            See the <strong>Options</strong> button below to import, export, and
            replay games.
          </span>
        </li>
      </ul>
      <div className="welcome-actions">
        {onLoadDeck && (
          <button
            type="button"
            className="ds-button ds-button--primary welcome-action-primary"
            onClick={onLoadDeck}
          >
            <CardsIcon {...decorative} weight="bold" />
            Load a deck
          </button>
        )}
        <button
          id="tutorialButton"
          type="button"
          className="ds-button ds-button--secondary"
          aria-haspopup="dialog"
          onClick={() => open('tutorial')}
        >
          <PlayCircleIcon {...decorative} weight="bold" />
          Watch Tutorial
        </button>
        <a
          id="discordLink"
          className="ds-button ds-button--secondary"
          href={DISCORD_URL}
          target="_blank"
          rel="noreferrer"
        >
          <DiscordLogoIcon {...decorative} weight="fill" />
          Join our Discord
        </a>
      </div>
      <footer id="links" className="welcome-footer">
        <button
          id="donationsLink"
          type="button"
          className="ds-link welcome-footer-link"
          aria-haspopup="dialog"
          onClick={() => open('donations')}
        >
          <HeartIcon {...decorative} weight="fill" />
          Sponsors &amp; Donations
        </button>
        <span className="welcome-footer-note">Happy testing!</span>
      </footer>
      {page === 'tutorial' && (
        <WelcomeSheet
          id="videoContainer"
          label="PTCG-sim tutorial"
          className="welcome-overlay--video"
          onClose={close}
        >
          <div className="welcome-video">
            <iframe
              title="PTCG-sim tutorial"
              width="560"
              height="315"
              src={TUTORIAL_EMBED_URL}
              frameBorder="0"
              allowFullScreen
            />
          </div>
        </WelcomeSheet>
      )}
      {page === 'changelog' && (
        // v1's `#changelog` page: the shipped release notes, authored as
        // static markup in the repository and toggled by the version link.
        <WelcomeSheet
          id="changelog"
          labelledBy="changelogTitle"
          onClose={close}
        >
          <p id="changelogTitle" className="welcome-sheet-title">
            Release notes
          </p>
          <div
            className="welcome-sheet-body"
            dangerouslySetInnerHTML={{ __html: changelogMarkup }}
          />
        </WelcomeSheet>
      )}
      {page === 'donations' && (
        <WelcomeSheet
          id="donationsPage"
          labelledBy="donationsTitle"
          onClose={close}
        >
          <div className="welcome-sheet-body">
            <h2 id="donationsTitle">Sponsors &amp; Donations</h2>
            <p>
              Hi everyone! I&apos;m Michael/Xiao Xiao Long. I&apos;m a
              21-year-old from Guelph, Canada, who started programming in the
              fall of 2023. I&apos;ve been playing the Pokémon TCG for over 8
              years, and I spent the last 3 months building PTCG-sim, a free
              tool for the community to use to test and play our favorite card
              game.
            </p>
            <p>
              I publicly launched the sim on Christmas, and it has already grown
              an incredible community of players and developers. There&apos;s a
              lot more to do, and I could use as much help as I can get!
            </p>
            <p>
              Should you find joy in using the sim and wish to support its
              ongoing development, you can sponsor me/the project through one of
              the links below. However, please know that sponsorship is
              completely optional. Your enjoyment of the sim is contribution
              enough, and I&apos;m thrilled to have you as part of our community
              :)
            </p>
            <p>-XXL &lt;3</p>
            <h3>
              <a href={GITHUB_SPONSORS_URL} target="_blank" rel="noreferrer">
                Github Sponsors Link
              </a>
            </h3>
            <h3>
              <a href={PAYPAL_URL} target="_blank" rel="noreferrer">
                Paypal Donation Link
              </a>
            </h3>
            <strong>SPONSOR TIERS</strong>
            <br />
            <br />
            <strong>$5/mo - SoulSilver Tier</strong>
            <ul>
              <li>
                Custom flair on Discord &amp; open reign on self-nicknames.
              </li>
              <li>Access to early beta testing.</li>
              <li>
                Shoutout in every changelog during the time you are subscribed
                for.
              </li>
              <li>
                Get a sponsor tag on your GitHub profile (if sponsoring via
                GitHub, not applicable for sponsors through PayPal. Currently in
                the process of getting my GH sponsor page approved 😛).
              </li>
              <li>My eternal thanks!!!!!</li>
            </ul>
            <strong>$25/mo - HeartGold Tier</strong>
            <ul>
              <li>Receive all of the benefits of the previous tiers.</li>
              <li>
                Access to an exclusive Discord channel for priority
                suggestions/feature proposals/troubleshooting support.
              </li>
            </ul>
            <strong>$100/mo - Platinum Tier</strong>
            <ul>
              <li>Receive all of the benefits of the previous tiers.</li>
              <li>
                Seriously do not think anyone will subscribe to this, but I
                would be immensely grateful.
              </li>
              <li>Direct access to me (I will give you my phone number).</li>
              <li>
                I&apos;ll sign, kiss, and mail you a signed bulk card of your
                choice (if I have it lol).
              </li>
            </ul>
            <strong>$15 - One-time Donation</strong>
            <ul>
              <li>Shoutout in the next changelog.</li>
              <li>My eternal thanks!!!!!</li>
            </ul>
          </div>
        </WelcomeSheet>
      )}
    </div>
  );
};
