import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { i18n } from '@lingui/core';
import { plural, selectOrdinal, t as translate } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { Tooltip } from '../../ui/Tooltip.js';
import {
  archetypeIconUrl,
  fetchArchetypeFinishes,
  fetchTournament,
  fetchTournaments,
  searchText,
  TOURNAMENT_DATA_SOURCE,
  type DeckSearchResult,
  type TournamentArchetype,
  type TournamentFinish,
  type TournamentStanding,
  type TournamentSummary,
} from './tournament-decks-client.js';
import { wordName } from './deck-home-covers.js';
import { usePaged, useRemote, type Remote } from './tournament-decks-hooks.js';
import { isInputMethodKey } from '../../ui/input-method.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

/** A list from a tournament, as the deck screen loads it. */
export interface TournamentListRequest {
  readonly tournamentId: string;
  readonly playerId: string;
  /** The seat's label for it: "Dragapult — 1st of 67". */
  readonly name: string;
}

export type LoadTournamentList = (
  request: TournamentListRequest,
  mode: 'try' | 'edit'
) => void;

const englishOrdinal = (place: number): string => {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${String(place)}th`;
  switch (place % 10) {
    case 1:
      return `${String(place)}st`;
    case 2:
      return `${String(place)}nd`;
    case 3:
      return `${String(place)}rd`;
    default:
      return `${String(place)}th`;
  }
};

/**
 * A finish as a deck's name: "Dragapult — 1st of 67", the form the current
 * decks already use (the screen words the finish for the page's language).
 */
export const finishName = (
  deck: string,
  placing: number | null,
  players: number
): string =>
  placing === null
    ? deck
    : `${deck} — ${englishOrdinal(placing)} of ${String(players)}`;

/** "1st", in the page's language. */
export const placingLabel = (placing: number | null): string =>
  placing === null
    ? translate({
        message: 'Dropped',
        comment: 'A player who left a tournament',
      })
    : translate({
        comment: 'A tournament placing, as 1st',
        message: `${selectOrdinal(placing, {
          one: '#st',
          two: '#nd',
          few: '#rd',
          other: '#th',
        })}`,
      });

const shortDate = (iso: string): string => {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(i18n.locale, {
    month: 'short',
    day: 'numeric',
    ...(thisYear ? {} : { year: 'numeric' }),
  });
};

/** A major's kind, as a label: none for an online event. */
const kindLabel = (kind: TournamentSummary['kind']): string | undefined => {
  switch (kind) {
    case 'regional':
      return translate({
        message: 'Regional',
        comment: 'An official Regional Championship tournament',
      });
    case 'special':
      return translate({
        message: 'Special Event',
        comment: 'An official Special Event tournament',
      });
    case 'international':
      return translate({
        message: 'International',
        comment: 'An official International Championship tournament',
      });
    case 'worlds':
      return translate({
        message: 'Worlds',
        comment: 'The Pokémon World Championships',
      });
    case 'online':
      return undefined;
  }
};

const formatLabel = (format: string): string =>
  format === 'STANDARD'
    ? translate({ message: 'Standard', context: 'deck format' })
    : format === 'EXPANDED'
      ? translate({ message: 'Expanded', context: 'deck format' })
      : format.charAt(0) + format.slice(1).toLowerCase();

const recordLabel = (record: TournamentFinish['record']): string =>
  `${String(record.wins)}-${String(record.losses)}-${String(record.ties)}`;

/** A deck's Pokémon icons, as Limitless draws them. */
export const ArchetypeIcons = ({
  icons,
}: {
  readonly icons: readonly string[];
}) => (
  <span className="deck-archetype-icons" aria-hidden="true">
    {icons.slice(0, 2).map((icon) => {
      const src = archetypeIconUrl(icon);
      return src ? (
        <img
          key={icon}
          src={src}
          alt=""
          width={32}
          height={32}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden';
          }}
        />
      ) : null;
    })}
  </span>
);

/** The credit every view of tournament data carries. */
export const TournamentCredit = ({ url }: { readonly url?: string }) => (
  <p className="deck-credit">
    <Trans comment="A credit line under tournament decks; source is a site's name (Limitless TCG)">
      Tournament data:{' '}
      <a
        href={url ?? TOURNAMENT_DATA_SOURCE.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {TOURNAMENT_DATA_SOURCE.name}
      </a>
    </Trans>
  </p>
);

/** One finish: where, how, who; pressing it puts the list on the seat. */
const FinishRow = ({
  finish,
  deckName,
  pending,
  onLoad,
}: {
  readonly finish: TournamentFinish;
  readonly deckName: string;
  readonly pending: string | undefined;
  readonly onLoad: LoadTournamentList;
}) => {
  const { t } = useLingui();
  const request: TournamentListRequest = {
    tournamentId: finish.tournament.id,
    playerId: finish.player.id,
    name: finishName(deckName, finish.placing, finish.tournament.players),
  };
  const key = `${request.tournamentId}/${request.playerId}`;
  const place = placingLabel(finish.placing);
  const playerName = finish.player.name;
  const eventName = finish.tournament.name;
  const players = finish.tournament.players;
  return (
    <li className="deck-finish" data-pending={pending === key || undefined}>
      <button
        type="button"
        className="deck-finish__load"
        aria-label={t({
          message: `${deckName}, ${place} of ${players}, ${playerName}: try it`,
          comment:
            'A tournament list to load: the deck, its placing, the event size, the player',
        })}
        onClick={() => onLoad(request, 'try')}
      >
        <span className="deck-finish__place ds-number">{place}</span>
        <span className="deck-finish__event">
          <span className="deck-finish__event-name">{eventName}</span>
          <span className="deck-finish__event-meta">
            {t`${plural(players, { one: '# player', other: '# players' })}`}
            {' · '}
            {shortDate(finish.tournament.date)}
          </span>
        </span>
        <span className="deck-finish__player">{playerName}</span>
        <span className="deck-finish__record ds-number">
          {recordLabel(finish.record)}
        </span>
        {pending === key ? (
          <CircleNotchIcon
            {...decorative}
            weight="bold"
            className="ds-spin deck-finish__spinner"
          />
        ) : null}
      </button>
      <Tooltip content={t`Edit a copy`}>
        <button
          type="button"
          className="deck-icon-button"
          aria-label={t`Save and edit ${wordName(request.name)}`}
          onClick={() => onLoad(request, 'edit')}
        >
          <PencilSimpleIcon {...decorative} weight="bold" />
        </button>
      </Tooltip>
    </li>
  );
};

const statusLine = (
  state: Remote<unknown>,
  empty: string
): string | undefined => {
  switch (state.status) {
    case 'loading':
      return translate`Searching…`;
    case 'unavailable':
      return translate`Tournament decks aren't ready yet`;
    case 'failed':
      return state.busy
        ? translate`Busy for a moment — try again shortly`
        : translate`Deck search is offline`;
    case 'ready':
      return empty;
    default:
      return undefined;
  }
};

/**
 * Why More brought nothing, beside it: a live region kept on the page, its
 * words changed, so a reader hears them.
 */
const MoreFailed = ({
  failed,
  offline,
}: {
  readonly failed: { readonly busy: boolean } | undefined;
  readonly offline: ReactNode;
}) => (
  <p className="deck-results__status deck-more-status" role="status">
    {failed ? (
      failed.busy ? (
        <Trans>Busy for a moment — try again shortly</Trans>
      ) : (
        offline
      )
    ) : null}
  </p>
);

/**
 * What a typed name finds: each matching deck, how it has done, and its
 * best finishes, each a list to load.
 */
export const DeckSearchResults = ({
  query,
  state,
  pending,
  onLoad,
  onAllLists,
}: {
  readonly query: string;
  readonly state: Remote<readonly DeckSearchResult[]>;
  readonly pending: string | undefined;
  readonly onLoad: LoadTournamentList;
  readonly onAllLists: (archetype: TournamentArchetype) => void;
}) => {
  const { t } = useLingui();
  const results =
    state.status === 'ready' || state.status === 'loading'
      ? (state.value ?? [])
      : [];
  const line =
    results.length > 0 && state.status === 'ready'
      ? undefined
      : statusLine(
          state,
          t({
            message: `No decks match “${query}”`,
            comment: 'A deck search with no results; query is what was typed',
          })
        );
  return (
    <div
      className="deck-results"
      role="region"
      aria-label={t`Tournament decks`}
      aria-busy={state.status === 'loading'}
    >
      {line ? (
        <p className="deck-results__status" role="status">
          {state.status === 'loading' ? (
            <CircleNotchIcon
              {...decorative}
              weight="bold"
              className="ds-spin"
            />
          ) : null}
          {line}
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul className="deck-results__list">
          {results.map((result) => {
            const name = result.archetype.name;
            const top8s = result.top8s;
            const lists = result.lists;
            return (
              <li key={result.archetype.id} className="deck-result">
                <div className="deck-result__head">
                  <ArchetypeIcons icons={result.archetype.icons} />
                  <span className="deck-result__name">{name}</span>
                  <span className="deck-result__stats">
                    {t({
                      message: `${plural(top8s, { one: '# top 8', other: '# top 8s' })} · ${plural(lists, { one: '# list', other: '# lists' })}`,
                      comment:
                        'How a deck has done: top 8 finishes and lists seen',
                    })}
                  </span>
                  <button
                    type="button"
                    className="ds-button ds-button--ghost deck-result__all"
                    data-open-archetype={result.archetype.id}
                    onClick={() => onAllLists(result.archetype)}
                  >
                    <Trans>All lists</Trans>
                    <CaretRightIcon
                      {...decorative}
                      weight="bold"
                      className="ds-mirror-rtl"
                    />
                  </button>
                </div>
                <ul className="deck-result__finishes">
                  {result.best.slice(0, 3).map((finish) => (
                    <FinishRow
                      key={`${finish.tournament.id}/${finish.player.id}`}
                      finish={finish}
                      deckName={name}
                      pending={pending}
                      onLoad={onLoad}
                    />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : null}
      {state.status === 'ready' || results.length > 0 ? (
        <TournamentCredit />
      ) : null}
    </div>
  );
};

/**
 * The recent tournaments, online and official majors, newest first, a name
 * filter and a Majors-only toggle above.
 */
export const TournamentsShelf = ({
  open,
  onOpen,
}: {
  readonly open: boolean;
  readonly onOpen: (tournament: TournamentSummary) => void;
}) => {
  const { t } = useLingui();
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [majors, setMajors] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchText(filter)), 250);
    return () => clearTimeout(timer);
  }, [filter]);
  // Asked for once the shelf comes near the screen, not on every opening.
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near || !open) return;
    const node = section.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: '240px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, open]);
  // Once asked for, kept while the screen is put away: it opens again as
  // it was left, the pages More brought included.
  const paged = usePaged(
    near ? `events:${majors ? 'majors' : 'all'}:${query}` : undefined,
    (cursor, options) =>
      fetchTournaments({
        ...options,
        ...(query ? { q: query } : {}),
        minPlayers: 16,
        ...(majors ? { majors: true } : {}),
        ...(cursor ? { cursor } : {}),
      }).then((page) => ({
        items: page.tournaments,
        nextCursor: page.nextCursor,
      }))
  );
  const events = paged.state.status === 'ready' ? paged.state.value : [];
  // A control pressed here that goes as the list changes -- More once the
  // last page is in or the list starts over, Try again once it loads --
  // takes the focus with it: focus that fell to the page goes to the first
  // event More brought, or More again, or else the first event, Try
  // again, or the filter. Nothing else here moves the focus.
  const handOff = useRef<{ readonly from?: number } | undefined>(undefined);
  const showMore = (): void => {
    if (paged.loadingMore || !paged.hasMore) return;
    handOff.current = { from: events.length };
    paged.more();
  };
  const tryAgain = (): void => {
    handOff.current = {};
    paged.retry();
  };
  useEffect(() => {
    const pending = handOff.current;
    if (pending === undefined) return;
    if (paged.loadingMore || paged.state.status === 'loading') return;
    handOff.current = undefined;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const node = section.current;
    if (!node) return;
    const opened = [
      ...node.querySelectorAll<HTMLElement>('[data-open-tournament]'),
    ];
    const more = node.querySelector<HTMLElement>('.deck-show-more');
    (pending.from === undefined
      ? (opened[0] ?? more)
      : (opened[pending.from] ?? more ?? opened.at(-1))
    )?.focus();
    if (document.activeElement === document.body) {
      (
        node.querySelector<HTMLElement>('.deck-results__status button') ??
        node.querySelector<HTMLElement>('#deckTournamentFilter')
      )?.focus();
    }
  }, [events.length, paged.loadingMore, paged.state.status]);
  return (
    <section
      ref={section}
      className="deck-home__section deck-shelf"
      aria-labelledby="deckTournamentsTitle"
    >
      <div className="deck-section-head">
        <h2 id="deckTournamentsTitle" className="deck-section-title">
          <Trans>Tournaments</Trans>
        </h2>
        <div className="deck-section-tools">
          <label className="deck-filter">
            <MagnifyingGlassIcon {...decorative} weight="bold" />
            <input
              id="deckTournamentFilter"
              type="search"
              className="ds-input"
              placeholder={t`Find an event`}
              aria-label={t`Find a tournament`}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              // Esc clears what was typed first, as the finder does; only
              // an empty field gives it to the screen.
              onKeyDown={(event) => {
                if (isInputMethodKey(event.nativeEvent)) return;
                if (event.key === 'Escape' && filter !== '') {
                  event.preventDefault();
                  setFilter('');
                }
              }}
            />
          </label>
          <button
            id="deckMajorsToggle"
            type="button"
            className="ds-button ds-button--ghost deck-majors"
            aria-pressed={majors}
            onClick={() => setMajors((shown) => !shown)}
          >
            <Trans comment="Shows only official major tournaments (Regionals, Internationals, Worlds)">
              Majors
            </Trans>
          </button>
        </div>
      </div>
      <div className="deck-paper deck-events">
        {paged.state.status === 'ready' && events.length > 0 ? (
          <ul className="deck-events__list" aria-label={t`Tournaments`}>
            {events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  className="deck-event"
                  data-open-tournament={event.id}
                  data-lists={
                    event.hasLists === null ? undefined : String(event.hasLists)
                  }
                  onClick={() => onOpen(event)}
                >
                  <span className="deck-event__date">
                    {shortDate(event.date)}
                  </span>
                  <span className="deck-event__name">{event.name}</span>
                  <span className="deck-event__meta">
                    {[
                      kindLabel(event.kind),
                      formatLabel(event.format),
                      t`${plural(event.players, { one: '# player', other: '# players' })}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {event.hasLists !== false ? null : (
                    <span className="deck-event__nolists">
                      <Trans>No lists</Trans>
                    </span>
                  )}
                  <CaretRightIcon
                    {...decorative}
                    weight="bold"
                    className="deck-event__go ds-mirror-rtl"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="deck-results__status" role="status">
            {paged.state.status === 'loading' ? (
              <>
                <CircleNotchIcon
                  {...decorative}
                  weight="bold"
                  className="ds-spin"
                />
                <Trans>Loading events…</Trans>
              </>
            ) : paged.state.status === 'failed' ? (
              <>
                {paged.state.busy ? (
                  <Trans>Busy for a moment — try again shortly</Trans>
                ) : (
                  <Trans>Tournaments are offline</Trans>
                )}{' '}
                <button type="button" className="ds-link" onClick={tryAgain}>
                  <Trans>Try again</Trans>
                </button>
              </>
            ) : paged.state.status === 'ready' ? (
              query ? (
                t({
                  message: `No events match “${query}”`,
                  comment: 'An event search with no results',
                })
              ) : (
                <Trans>No events yet</Trans>
              )
            ) : null}
          </p>
        )}
        {paged.hasMore ? (
          <button
            type="button"
            className="ds-button ds-button--ghost deck-show-more"
            // Not disabled: a disabled button drops the focus to the page.
            aria-disabled={paged.loadingMore || undefined}
            onClick={showMore}
          >
            {paged.loadingMore ? (
              <CircleNotchIcon
                {...decorative}
                weight="bold"
                className="ds-spin"
              />
            ) : null}
            <Trans context="show more tournaments">More</Trans>
          </button>
        ) : null}
        <MoreFailed
          failed={paged.moreFailed}
          offline={<Trans>Tournaments are offline</Trans>}
        />
        <TournamentCredit />
      </div>
    </section>
  );
};

/** The header of a tournament's or a deck's own view. */
const SubHead = ({
  onBack,
  title,
  meta,
  link,
  icons,
}: {
  readonly onBack: () => void;
  readonly title: string;
  readonly meta?: string;
  readonly link?: string;
  readonly icons?: readonly string[];
}) => {
  const { t } = useLingui();
  return (
    <div className="deck-subhead">
      <Tooltip content={t`Back to the decks`}>
        <button
          id="deckSubviewBackButton"
          type="button"
          className="ds-button ds-button--ghost deck-subhead__back"
          aria-label={t`Back to the decks`}
          onClick={onBack}
        >
          <CaretLeftIcon
            {...decorative}
            weight="bold"
            className="ds-mirror-rtl"
          />
          <span className="deck-subhead__back-label">
            <Trans context="go back to the saved decks">Decks</Trans>
          </span>
        </button>
      </Tooltip>
      {icons ? <ArchetypeIcons icons={icons} /> : null}
      <div className="deck-subhead__title">
        {/* Focused as the view opens: what it is, read out first. */}
        <h2 tabIndex={-1}>{title}</h2>
        {meta ? <p>{meta}</p> : null}
      </div>
      {link ? (
        <a
          className="ds-button ds-button--ghost"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Trans comment="Open this on the site it comes from">Limitless</Trans>
          <ArrowSquareOutIcon {...decorative} weight="bold" />
        </a>
      ) : null}
    </div>
  );
};

/** A tournament's standings: every player's place, deck and list. */
/**
 * Keeps the focus in a view when the control that held it goes (All time,
 * More, Try again): on the view's heading, where Esc and the keys still
 * reach the deck screen.
 */
const useFocusKept = (
  root: RefObject<HTMLElement | null>,
  changes: readonly unknown[]
): void => {
  useEffect(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    root.current
      ?.querySelector<HTMLElement>('.deck-subhead__title h2')
      ?.focus({ preventScroll: true });
  }, changes);
};

export const TournamentView = ({
  tournament,
  pending,
  onBack,
  onLoad,
}: {
  readonly tournament: Pick<TournamentSummary, 'id' | 'name'>;
  readonly pending: string | undefined;
  readonly onBack: () => void;
  readonly onLoad: LoadTournamentList;
}) => {
  const { t } = useLingui();
  const { state, retry } = useRemote(tournament.id, (options) =>
    fetchTournament(tournament.id, options)
  );
  const detail = state.status === 'ready' ? state.value : undefined;
  const view = useRef<HTMLDivElement>(null);
  useFocusKept(view, [state.status]);
  const players = detail?.tournament.players ?? 0;
  const meta = detail
    ? [
        shortDate(detail.tournament.date),
        kindLabel(detail.tournament.kind),
        formatLabel(detail.tournament.format),
        t`${plural(players, { one: '# player', other: '# players' })}`,
        detail.tournament.organizer,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;
  return (
    <div ref={view} className="deck-subview" data-subview="tournament">
      <SubHead
        onBack={onBack}
        title={detail?.tournament.name ?? tournament.name}
        {...(meta ? { meta } : {})}
        {...(detail ? { link: detail.tournament.url } : {})}
      />
      <div className="deck-paper deck-standings">
        {detail ? (
          <>
            <ol className="deck-standings__list" aria-label={t`Standings`}>
              {detail.standings.map((standing) => (
                <StandingRow
                  key={standing.player.id}
                  standing={standing}
                  tournament={detail.tournament}
                  pending={pending}
                  onLoad={onLoad}
                />
              ))}
            </ol>
            <TournamentCredit url={detail.tournament.url} />
          </>
        ) : (
          <RemoteStatus state={state} retry={retry} />
        )}
      </div>
    </div>
  );
};

const RemoteStatus = ({
  state,
  retry,
}: {
  readonly state: Remote<unknown>;
  readonly retry: () => void;
}) => (
  <p className="deck-results__status" role="status">
    {state.status === 'loading' ? (
      <>
        <CircleNotchIcon {...decorative} weight="bold" className="ds-spin" />
        <Trans>Loading…</Trans>
      </>
    ) : state.status === 'failed' ? (
      <>
        {state.busy ? (
          <Trans>Busy for a moment — try again shortly</Trans>
        ) : (
          <Trans>Couldn&apos;t load this</Trans>
        )}{' '}
        <button type="button" className="ds-link" onClick={retry}>
          <Trans>Try again</Trans>
        </button>
      </>
    ) : state.status === 'unavailable' ? (
      <Trans>Tournament decks aren&apos;t ready yet</Trans>
    ) : null}
  </p>
);

const StandingRow = ({
  standing,
  tournament,
  pending,
  onLoad,
}: {
  readonly standing: TournamentStanding;
  readonly tournament: TournamentSummary;
  readonly pending: string | undefined;
  readonly onLoad: LoadTournamentList;
}) => {
  const { t } = useLingui();
  const deck = standing.archetype?.name ?? t`Unknown deck`;
  const request: TournamentListRequest = {
    tournamentId: tournament.id,
    playerId: standing.player.id,
    name: finishName(deck, standing.placing, tournament.players),
  };
  const key = `${request.tournamentId}/${request.playerId}`;
  const place = placingLabel(standing.placing);
  const playerName = standing.player.name;
  return (
    <li
      className="deck-standing"
      data-dropped={standing.dropped || undefined}
      data-pending={pending === key || undefined}
    >
      <span className="deck-standing__place ds-number">{place}</span>
      <span className="deck-standing__player">{playerName}</span>
      <span className="deck-standing__deck">
        {standing.archetype ? (
          <ArchetypeIcons icons={standing.archetype.icons} />
        ) : null}
        <span>{deck}</span>
      </span>
      <span className="deck-standing__record ds-number">
        {recordLabel(standing.record)}
      </span>
      <span className="deck-standing__actions">
        {standing.hasList ? (
          <>
            <button
              type="button"
              className="ds-button ds-button--secondary deck-standing__load"
              aria-label={t({
                message: `${deck}, ${place}, ${playerName}: try it`,
                comment:
                  "A player's list in a tournament's standings: the deck, the placing, the player",
              })}
              // Not disabled: a disabled button drops the focus to the page.
              aria-disabled={pending === key || undefined}
              onClick={() => {
                if (pending !== key) onLoad(request, 'try');
              }}
            >
              {pending === key ? (
                <CircleNotchIcon
                  {...decorative}
                  weight="bold"
                  className="ds-spin"
                />
              ) : null}
              <Trans context="put a tournament list on the seat">Load</Trans>
            </button>
            <Tooltip content={t`Edit a copy`}>
              <button
                type="button"
                className="deck-icon-button"
                aria-label={t`Save and edit ${wordName(request.name)}`}
                onClick={() => onLoad(request, 'edit')}
              >
                <PencilSimpleIcon {...decorative} weight="bold" />
              </button>
            </Tooltip>
          </>
        ) : (
          <span className="deck-standing__nolist">
            <Trans>No list</Trans>
          </span>
        )}
      </span>
    </li>
  );
};

/** The server's widest window of days: every finish it holds. */
const ALL_TIME_DAYS = 3650;

/** Every finish one deck has, best first, a page at a time. */
export const ArchetypeView = ({
  archetype,
  pending,
  onBack,
  onLoad,
}: {
  readonly archetype: TournamentArchetype;
  readonly pending: string | undefined;
  readonly onBack: () => void;
  readonly onLoad: LoadTournamentList;
}) => {
  const { t } = useLingui();
  // Recent finishes first; a deck with none recent (which search shows from
  // all time) lists all its finishes, as its search result did. Its older
  // ones (the search result counts every list) are a press away.
  const allTimeFor = useRef<string | null>(null);
  const [fellBack, setFellBack] = useState(false);
  const [older, setOlder] = useState(false);
  const allTime = older || fellBack;
  const paged = usePaged(
    older ? `${archetype.id}:all` : archetype.id,
    async (cursor, options) => {
      const read = (wide: boolean) =>
        fetchArchetypeFinishes(archetype.id, {
          ...options,
          ...(cursor ? { cursor } : {}),
          ...(wide ? { since: ALL_TIME_DAYS } : {}),
        });
      let page = await read(older || allTimeFor.current === archetype.id);
      if (
        !cursor &&
        !older &&
        page.finishes.length === 0 &&
        allTimeFor.current !== archetype.id
      ) {
        allTimeFor.current = archetype.id;
        setFellBack(true);
        page = await read(true);
      }
      return { items: page.finishes, nextCursor: page.nextCursor };
    }
  );
  const finishes = useMemo(
    () => (paged.state.status === 'ready' ? paged.state.value : []),
    [paged.state]
  );
  const view = useRef<HTMLDivElement>(null);
  // More gone with the last page: the focus goes on to the first list it
  // brought, where the player was reading, not up to the heading out of
  // sight. The row itself, not its Load: a second Enter there would put a
  // list on the seat.
  const moreFrom = useRef<number | undefined>(undefined);
  useEffect(() => {
    const from = moreFrom.current;
    if (from === undefined || paged.loadingMore) return;
    moreFrom.current = undefined;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const row = view.current?.querySelectorAll<HTMLElement>(
      '.deck-result__finishes > li'
    )[from];
    if (!row) return;
    row.tabIndex = -1;
    row.focus();
  }, [finishes.length, paged.loadingMore]);
  useFocusKept(view, [paged.state.status, paged.hasMore, allTime]);
  return (
    <div ref={view} className="deck-subview" data-subview="archetype">
      <SubHead onBack={onBack} title={archetype.name} icons={archetype.icons} />
      <div className="deck-paper deck-standings">
        {paged.state.status === 'ready' ? (
          <>
            <ul
              className="deck-result__finishes"
              aria-label={t`Lists for ${archetype.name}`}
            >
              {finishes.map((finish) => (
                <FinishRow
                  key={`${finish.tournament.id}/${finish.player.id}`}
                  finish={finish}
                  deckName={archetype.name}
                  pending={pending}
                  onLoad={onLoad}
                />
              ))}
            </ul>
            {/* Keyed apart: More gone with the last page, the focus goes to
                the heading (useFocusKept), never left on All time in its
                place for the next Enter to throw the pages away. */}
            {paged.hasMore ? (
              <button
                key="more"
                type="button"
                className="ds-button ds-button--ghost deck-show-more"
                // Not disabled: a disabled button drops the focus to the page.
                aria-disabled={paged.loadingMore || undefined}
                onClick={() => {
                  if (!paged.loadingMore) moreFrom.current = finishes.length;
                  paged.more();
                }}
              >
                <Trans context="show more lists">More</Trans>
              </button>
            ) : !allTime && finishes.length > 0 ? (
              <button
                key="all-time"
                type="button"
                id="deckAllTimeButton"
                className="ds-button ds-button--ghost deck-show-more"
                onClick={() => setOlder(true)}
              >
                <Trans context="a deck's lists from every date">All time</Trans>
              </button>
            ) : null}
            <MoreFailed
              failed={paged.moreFailed}
              offline={<Trans>Couldn&apos;t load this</Trans>}
            />
            <TournamentCredit />
          </>
        ) : (
          <RemoteStatus state={paged.state} retry={paged.retry} />
        )}
      </div>
    </div>
  );
};
