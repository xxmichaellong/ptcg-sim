import { useSyncExternalStore } from 'react';

import { Sheet } from '../../ui/Sheet.js';
import changelogMarkup from '../legacy-changelog.html?raw';
import './help-pages.css';

/**
 * The help pages (v1's tutorial video, release notes, and Sponsors &
 * Donations), opened from the menu, Settings or the table's welcome card.
 * One host for the page shows whichever is asked for.
 */
export type HelpPage = 'tutorial' | 'changelog' | 'donations';

const TUTORIAL_EMBED_URL =
  'https://www.youtube.com/embed/t3qAhO_p3mk?si=jxysgkLxaAoaSw1I';
export const REPOSITORY_URL = 'https://github.com/xxmichaellong/ptcg-sim';
export const DISCORD_URL = 'https://discord.gg/jMfhQa38mh';
export const TWITTER_URL = 'https://x.com/xxmichaellong';
export const TWITTER_HANDLE = '@xxmichaellong';
const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/xxmichaellong?o=esc';
const PAYPAL_URL =
  'https://www.paypal.com/donate/?hosted_button_id=VWFSCL73GDHF4';

let current: HelpPage | null = null;
const listeners = new Set<() => void>();
const publish = (page: HelpPage | null): void => {
  if (page === current) return;
  current = page;
  for (const listener of listeners) listener();
};

export const openHelpPage = (page: HelpPage): void => publish(page);
export const closeHelpPage = (): void => publish(null);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The release the notes lead with (`v1.6`): the menu, Settings and the
 * welcome card name the notes by it.
 */
export const RELEASE_NAME =
  /<h2>\s*(v\d+(?:\.\d+)*)/u.exec(changelogMarkup)?.[1] ?? 'Release notes';

const TITLES: Readonly<Record<HelpPage, string>> = {
  tutorial: 'How to play on PTCG-sim',
  changelog: RELEASE_NAME,
  donations: 'Sponsors & Donations',
};

const IDS: Readonly<Record<HelpPage, string>> = {
  tutorial: 'videoContainer',
  changelog: 'changelog',
  donations: 'donationsPage',
};

/** The page's one help sheet. */
export const HelpSheetHost = () => {
  const page = useSyncExternalStore(subscribe, () => current);
  return (
    <Sheet
      open={page !== null}
      onOpenChange={(open) => {
        if (!open) closeHelpPage();
      }}
      title={page ? TITLES[page] : ''}
      size={page === 'tutorial' ? 'lg' : 'md'}
      className="ptcgsim-help-sheet"
      {...(page ? { id: IDS[page] } : {})}
    >
      {page === 'tutorial' ? (
        <div className="ptcgsim-help-video">
          <iframe
            title="PTCG-sim tutorial"
            width="560"
            height="315"
            src={TUTORIAL_EMBED_URL}
            frameBorder="0"
            allowFullScreen
          />
        </div>
      ) : null}
      {page === 'changelog' ? (
        // v1's `#changelog` page: the shipped release notes, authored as
        // static markup in the repository.
        <div
          className="ptcgsim-help-article"
          dangerouslySetInnerHTML={{ __html: changelogMarkup }}
        />
      ) : null}
      {page === 'donations' ? (
        <div className="ptcgsim-help-article">
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
          <p>
            For news and what&apos;s coming, follow me on X:{' '}
            <a
              id="donationsTwitterLink"
              href={TWITTER_URL}
              target="_blank"
              rel="noreferrer"
            >
              {TWITTER_HANDLE}
            </a>
          </p>
          <strong>SPONSOR TIERS</strong>
          <br />
          <br />
          <strong>$5/mo - SoulSilver Tier</strong>
          <ul>
            <li>Custom flair on Discord &amp; open reign on self-nicknames.</li>
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
              Seriously do not think anyone will subscribe to this, but I would
              be immensely grateful.
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
      ) : null}
    </Sheet>
  );
};
