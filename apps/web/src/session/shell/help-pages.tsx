import { Trans, useLingui } from '@lingui/react/macro';
import { useSyncExternalStore } from 'react';

import { Sheet } from '../../ui/Sheet.js';
import changelogMarkup from '../legacy-changelog.html?raw';
import './help-pages.css';

/**
 * The help pages (release notes, and Sponsors & Donations), opened from the
 * menu, Settings or the table's welcome card. One host for the page shows
 * whichever is asked for. (v1's tutorial video gave way to tutorial mode,
 * ADR-038.)
 */
export type HelpPage = 'changelog' | 'donations';
export const REPOSITORY_URL = 'https://github.com/xxmichaellong/ptcg-sim';
export const DISCORD_URL = 'https://discord.gg/jMfhQa38mh';
export const TWITTER_URL = 'https://x.com/xxmichaellong';
export const TWITTER_HANDLE = '@xxmichaellong';
const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/xxmichaellong?o=esc';
const PAYPAL_URL =
  'https://www.paypal.com/donate/?hosted_button_id=VWFSCL73GDHF4';

/**
 * A sponsor tier's heading, `$5/mo - SoulSilver Tier`: the price per month
 * is worded for the language, the tier keeps its name.
 */
const SponsorTier = ({
  price,
  tier,
}: {
  readonly price: string;
  readonly tier: string;
}) => (
  <Trans comment="price is an amount in US dollars, like $5; tier is a sponsor tier's name, kept in English">
    {price}/mo - {tier}
  </Trans>
);

/** The one-time donation's heading, `$15 - One-time Donation`. */
const OneTimeDonation = ({ price }: { readonly price: string }) => (
  <Trans comment="price is an amount in US dollars, like $15">
    {price} - One-time Donation
  </Trans>
);

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
 * welcome card name the notes by it. The notes themselves are v1's, kept in
 * English; the fallback only stands in if they ever lose their heading.
 */
export const RELEASE_NAME =
  /<h2>\s*(v\d+(?:\.\d+)*)/u.exec(changelogMarkup)?.[1] ?? 'Release notes';

const IDS: Readonly<Record<HelpPage, string>> = {
  changelog: 'changelog',
  donations: 'donationsPage',
};

/** The page's one help sheet. */
export const HelpSheetHost = () => {
  const { t } = useLingui();
  const page = useSyncExternalStore(subscribe, () => current);
  const titles: Readonly<Record<HelpPage, string>> = {
    changelog: RELEASE_NAME,
    donations: t`Sponsors & Donations`,
  };
  return (
    <Sheet
      open={page !== null}
      onOpenChange={(open) => {
        if (!open) closeHelpPage();
      }}
      title={page ? titles[page] : ''}
      size="md"
      className="ptcgsim-help-sheet"
      {...(page ? { id: IDS[page] } : {})}
    >
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
          {/* The owner's own note: translated faithfully, signature,
              links and tier names as they are. */}
          <p>
            <Trans comment="The developer's personal note on the Sponsors & Donations page">
              Hi everyone! I&apos;m Michael/Xiao Xiao Long. I&apos;m a
              21-year-old from Guelph, Canada, who started programming in the
              fall of 2023. I&apos;ve been playing the Pokémon TCG for over 8
              years, and I spent the last 3 months building PTCG-sim, a free
              tool for the community to use to test and play our favorite card
              game.
            </Trans>
          </p>
          <p>
            <Trans comment="The developer's personal note on the Sponsors & Donations page">
              I publicly launched the sim on Christmas, and it has already grown
              an incredible community of players and developers. There&apos;s a
              lot more to do, and I could use as much help as I can get!
            </Trans>
          </p>
          <p>
            <Trans comment="The developer's personal note on the Sponsors & Donations page">
              Should you find joy in using the sim and wish to support its
              ongoing development, you can sponsor me/the project through one of
              the links below. However, please know that sponsorship is
              completely optional. Your enjoyment of the sim is contribution
              enough, and I&apos;m thrilled to have you as part of our community
              :)
            </Trans>
          </p>
          <p>-XXL &lt;3</p>
          <h3>
            <a href={GITHUB_SPONSORS_URL} target="_blank" rel="noreferrer">
              <Trans>Github Sponsors Link</Trans>
            </a>
          </h3>
          <h3>
            <a href={PAYPAL_URL} target="_blank" rel="noreferrer">
              <Trans>Paypal Donation Link</Trans>
            </a>
          </h3>
          <p>
            <Trans comment="TWITTER_HANDLE is the developer's X (Twitter) handle, @xxmichaellong">
              For news and what&apos;s coming, follow me on X:{' '}
              <a
                id="donationsTwitterLink"
                href={TWITTER_URL}
                target="_blank"
                rel="noreferrer"
              >
                {TWITTER_HANDLE}
              </a>
            </Trans>
          </p>
          <strong>
            <Trans>SPONSOR TIERS</Trans>
          </strong>
          <br />
          <br />
          <strong>
            <SponsorTier price="$5" tier="SoulSilver Tier" />
          </strong>
          <ul>
            <li>
              <Trans>
                Custom flair on Discord &amp; open reign on self-nicknames.
              </Trans>
            </li>
            <li>
              <Trans>Access to early beta testing.</Trans>
            </li>
            <li>
              <Trans>
                Shoutout in every changelog during the time you are subscribed
                for.
              </Trans>
            </li>
            <li>
              <Trans>
                Get a sponsor tag on your GitHub profile (if sponsoring via
                GitHub, not applicable for sponsors through PayPal. Currently in
                the process of getting my GH sponsor page approved 😛).
              </Trans>
            </li>
            <li>
              <Trans>My eternal thanks!!!!!</Trans>
            </li>
          </ul>
          <strong>
            <SponsorTier price="$25" tier="HeartGold Tier" />
          </strong>
          <ul>
            <li>
              <Trans>Receive all of the benefits of the previous tiers.</Trans>
            </li>
            <li>
              <Trans>
                Access to an exclusive Discord channel for priority
                suggestions/feature proposals/troubleshooting support.
              </Trans>
            </li>
          </ul>
          <strong>
            <SponsorTier price="$100" tier="Platinum Tier" />
          </strong>
          <ul>
            <li>
              <Trans>Receive all of the benefits of the previous tiers.</Trans>
            </li>
            <li>
              <Trans>
                Seriously do not think anyone will subscribe to this, but I
                would be immensely grateful.
              </Trans>
            </li>
            <li>
              <Trans>
                Direct access to me (I will give you my phone number).
              </Trans>
            </li>
            <li>
              <Trans>
                I&apos;ll sign, kiss, and mail you a signed bulk card of your
                choice (if I have it lol).
              </Trans>
            </li>
          </ul>
          <strong>
            <OneTimeDonation price="$15" />
          </strong>
          <ul>
            <li>
              <Trans>Shoutout in the next changelog.</Trans>
            </li>
            <li>
              <Trans>My eternal thanks!!!!!</Trans>
            </li>
          </ul>
        </div>
      ) : null}
    </Sheet>
  );
};
