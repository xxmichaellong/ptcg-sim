import { useEffect, useState } from 'react';

import changelogMarkup from './legacy-changelog.html?raw';

const TUTORIAL_EMBED_URL =
  'https://www.youtube.com/embed/t3qAhO_p3mk?si=jxysgkLxaAoaSw1I';
const REPOSITORY_URL = 'https://github.com/xxmichaellong/ptcg-sim';
const DISCORD_URL = 'https://discord.gg/jMfhQa38mh';
const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/xxmichaellong?o=esc';
const PAYPAL_URL =
  'https://www.paypal.com/donate/?hosted_button_id=VWFSCL73GDHF4';

/**
 * The opening text of v1's Solo panel (`#chatbox` in index.ejs): the welcome
 * spiel, the tutorial video, the Discord link, and the Sponsors & Donations
 * page. It sits at the top of the activity feed; v1's Clear battle log wipes
 * it with the rest of the panel, which the surface reproduces.
 */
export const LegacyWelcome = ({
  buildId = import.meta.env.VITE_PTCGSIM_BUILD_ID || 'v2',
}: {
  readonly buildId?: string;
}) => {
  const [page, setPage] = useState<
    'tutorial' | 'donations' | 'changelog' | null
  >(null);
  useEffect(() => {
    if (page === null) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPage(null);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [page]);
  return (
    <>
      <strong style={{ fontSize: '115%' }}>Welcome to PTCG-sim!</strong>
      <p style={{ fontSize: '105%' }}>
        <strong
          id="changelogLink"
          role="button"
          tabIndex={0}
          aria-expanded={page === 'changelog'}
          onClick={() =>
            setPage((current) => (current === 'changelog' ? null : 'changelog'))
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setPage((current) =>
                current === 'changelog' ? null : 'changelog'
              );
            }
          }}
        >
          {buildId} ⊹ ࣪ ﹏𓊝﹏𓂁﹏⊹ ࣪ ˖
        </strong>
      </p>
      <p style={{ fontSize: '105%' }}>
        PTCG-sim is an{' '}
        <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
          open-source
        </a>{' '}
        Pokémon Trading Card Game (Pokémon TCG) tabletop simulator. It supports
        single player and online multiplayer.
      </p>
      <p style={{ fontSize: '105%' }}>
        Use the <strong>Deck</strong> tab above to import your deck, then press{' '}
        <strong>Set Up</strong> to start a game.
      </p>
      <p style={{ fontSize: '105%' }}>
        Drag or use keybinds (hold <span className="shift-font">shift</span>) to
        move cards.
      </p>
      <p style={{ fontSize: '105%' }}>
        See the <strong>Options</strong> button below to import, export, and
        replay games.
      </p>
      <p style={{ fontSize: '105%' }}>Happy testing!</p>
      <button
        id="tutorialButton"
        type="button"
        style={{ fontSize: '105%' }}
        onClick={() => setPage('tutorial')}
      >
        Watch Tutorial
      </button>
      <br />
      <br />
      <div id="links" style={{ fontSize: '105%' }}>
        <div id="discordLink">
          <strong>
            <a href={DISCORD_URL} target="_blank" rel="noreferrer">
              🎮 Join our Discord
            </a>
          </strong>
        </div>
        <div
          id="donationsLink"
          role="button"
          tabIndex={0}
          onClick={() => setPage('donations')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setPage('donations');
            }
          }}
        >
          🎁 Sponsors &amp; Donations
        </div>
      </div>
      <div id="line" />
      {page === 'tutorial' && (
        <div
          id="videoContainer"
          data-open="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPage(null);
          }}
        >
          <iframe
            title="PTCG-sim tutorial"
            width="560"
            height="315"
            src={TUTORIAL_EMBED_URL}
            frameBorder="0"
            allowFullScreen
          />
        </div>
      )}
      {page === 'changelog' && (
        // v1's `#changelog` page: the shipped release notes, authored as
        // static markup in the repository and toggled by the version link;
        // clicking anywhere on it closes it, as in v1.
        <div
          id="changelog"
          data-open="true"
          onClick={() => setPage(null)}
          dangerouslySetInnerHTML={{ __html: changelogMarkup }}
        />
      )}
      {page === 'donations' && (
        <div id="donationsPage" data-open="true" onClick={() => setPage(null)}>
          <h2>Sponsors &amp; Donations</h2>
          <p>
            Hi everyone! I&apos;m Michael/Xiao Xiao Long. I&apos;m a 21-year-old
            from Guelph, Canada, who started programming in the fall of 2023.
            I&apos;ve been playing the Pokémon TCG for over 8 years, and I spent
            the last 3 months building PTCG-sim, a free tool for the community
            to use to test and play our favorite card game.
          </p>
          <p>
            I publicly launched the sim on Christmas, and it has already grown
            an incredible community of players and developers. There&apos;s a
            lot more to do, and I could use as much help as I can get!
          </p>
          <p>
            Should you find joy in using the sim and wish to support its ongoing
            development, you can sponsor me/the project through one of the links
            below. However, please know that sponsorship is completely optional.
            Your enjoyment of the sim is contribution enough, and I&apos;m
            thrilled to have you as part of our community :)
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
        </div>
      )}
    </>
  );
};
