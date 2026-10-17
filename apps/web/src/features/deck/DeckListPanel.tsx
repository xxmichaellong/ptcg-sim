import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { InfoIcon } from '@phosphor-icons/react/dist/csr/Info';
import { ListIcon } from '@phosphor-icons/react/dist/csr/List';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import {
  deckStats,
  describeDeckIssue,
  isBasicPokemon,
  sampleOpening,
  sortDeckList,
  type CardCategory,
  type DeckCard,
  type DeckCheck,
  type DeckEntry,
  type DeckIssue,
  type DeckList,
} from '@ptcgsim/deck-core';
import { useMemo, useState, type MouseEvent } from 'react';

import { preferences } from '../../preferences/preference-store.js';
import { usePreference } from '../../preferences/usePreference.js';
import { Tooltip } from '../../ui/Tooltip.js';
import { CardImage, limitlessScanOf } from './CardImage.js';
import type { DeckImportLine } from './deck-import.js';
import { DECK_SCREEN_PREFERENCES } from './deck-screen-preferences.js';
import type { ZoomCard } from './useHoverZoom.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

const GROUPS: readonly {
  readonly category: CardCategory;
  readonly label: string;
}[] = [
  { category: 'Pokémon', label: 'Pokémon' },
  { category: 'Trainer', label: 'Trainer' },
  { category: 'Energy', label: 'Energy' },
];

const TRAINER_SUBGROUPS = ['Supporter', 'Item', 'Tool', 'Stadium'];

const percent = (value: number): string =>
  `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;

const issueCards = (issue: DeckIssue): readonly string[] =>
  'cardIds' in issue ? issue.cardIds : [];

export interface DeckListPanelProps {
  readonly cards: DeckList;
  readonly check: DeckCheck;
  readonly coverId: string | undefined;
  readonly missing: readonly DeckImportLine[];
  readonly onDismissMissing: () => void;
  readonly onSearchFor: (name: string) => void;
  readonly onAdd: (card: DeckCard) => void;
  readonly onRemove: (card: DeckCard) => void;
  readonly onInspect: (card: DeckCard) => void;
  readonly onZoom: (card: ZoomCard, element: HTMLElement) => void;
  readonly onZoomEnd: () => void;
}

export const DeckListPanel = ({
  cards,
  check,
  coverId,
  missing,
  onDismissMissing,
  onSearchFor,
  onAdd,
  onRemove,
  onInspect,
  onZoom,
  onZoomEnd,
}: DeckListPanelProps) => {
  const { deckView } = usePreference(DECK_SCREEN_PREFERENCES);
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(new Set());
  const sorted = useMemo(() => sortDeckList(cards), [cards]);
  const stats = useMemo(() => deckStats(cards), [cards]);
  const flagged = useMemo(
    () => new Set(check.errors.flatMap(issueCards)),
    [check.errors]
  );
  const size = check.format.deckSize;
  const fill = Math.min(1, check.total / size);
  const issues = [...check.errors, ...check.warnings];

  const groupTotals: Readonly<Record<CardCategory, number>> = {
    Pokémon: stats.pokemon,
    Trainer: stats.trainer,
    Energy: stats.energy,
  };

  const row = (entry: DeckEntry) => (
    <DeckRow
      key={entry.card.id}
      entry={entry}
      view={deckView}
      cover={entry.card.id === coverId}
      flagged={flagged.has(entry.card.id)}
      highlighted={highlight.has(entry.card.id)}
      onAdd={onAdd}
      onRemove={onRemove}
      onInspect={onInspect}
      onZoom={onZoom}
      onZoomEnd={onZoomEnd}
    />
  );

  return (
    <section className="deck-panel" aria-label="Deck">
      <div
        id="deckCheckPanel"
        className="deck-check"
        data-valid={check.valid ? 'true' : 'false'}
        data-complete={check.total === size ? 'true' : undefined}
        data-over={check.total > size ? 'true' : undefined}
      >
        <div className="deck-check__head">
          <span className="deck-check__count">
            <strong className="ds-number">{check.total}</strong>
            <span> / {size}</span>
          </span>
          <span className="deck-check__verdict" aria-live="polite">
            {check.valid ? (
              <>
                <CheckCircleIcon {...decorative} weight="fill" />
                Ready for {check.format.name}
              </>
            ) : (
              <>
                <WarningCircleIcon {...decorative} weight="fill" />
                {check.errors.length}{' '}
                {check.errors.length === 1 ? 'thing' : 'things'} to fix for{' '}
                {check.format.name}
              </>
            )}
          </span>
          <div
            className="deck-panel__view ptcgsim-segmented-control"
            role="radiogroup"
            aria-label="Show the deck as"
          >
            {(
              [
                ['list', 'List', ListIcon],
                ['images', 'Images', SquaresFourIcon],
              ] as const
            ).map(([value, label, Icon]) => (
              <span key={value} className="ptcgsim-segmented-control__option">
                <input
                  type="radio"
                  id={`deckView-${value}`}
                  name="deckView"
                  checked={deckView === value}
                  onChange={() =>
                    preferences().patch(DECK_SCREEN_PREFERENCES, {
                      deckView: value,
                    })
                  }
                />
                <Tooltip content={`Show the deck as ${label.toLowerCase()}`}>
                  <label htmlFor={`deckView-${value}`} aria-label={label}>
                    <Icon {...decorative} weight="bold" />
                  </label>
                </Tooltip>
              </span>
            ))}
          </div>
        </div>
        <div
          className="deck-check__meter"
          role="progressbar"
          aria-label="Cards in deck"
          aria-valuemin={0}
          aria-valuemax={size}
          aria-valuenow={Math.min(check.total, size)}
          aria-valuetext={`${check.total} of ${size} cards`}
        >
          <span style={{ inlineSize: `${(fill * 100).toFixed(2)}%` }} />
        </div>
        <ul className="deck-check__split">
          {GROUPS.map((group) => (
            <li key={group.category} data-group={group.category}>
              {group.label}{' '}
              <strong className="ds-number">
                {groupTotals[group.category]}
              </strong>
            </li>
          ))}
        </ul>
        {issues.length > 0 && check.total > 0 ? (
          <ul className="deck-check__issues">
            {issues.map((issue, index) => {
              const ids = issueCards(issue);
              const warning = index >= check.errors.length;
              return (
                <li
                  key={`${issue.code}-${index}`}
                  data-tone={warning ? 'warning' : 'danger'}
                >
                  {ids.length > 0 ? (
                    <button
                      type="button"
                      className="deck-check__issue"
                      onMouseEnter={() => setHighlight(new Set(ids))}
                      onMouseLeave={() => setHighlight(new Set())}
                      onFocus={() => setHighlight(new Set(ids))}
                      onBlur={() => setHighlight(new Set())}
                      onClick={() => {
                        setHighlight(new Set(ids));
                        document
                          .querySelector(
                            `[data-deck-card="${CSS.escape(ids[0]!)}"]`
                          )
                          ?.scrollIntoView({
                            block: 'nearest',
                            behavior: 'smooth',
                          });
                      }}
                    >
                      {warning ? (
                        <InfoIcon {...decorative} weight="bold" />
                      ) : (
                        <WarningCircleIcon {...decorative} weight="bold" />
                      )}
                      {describeDeckIssue(cards, issue)}
                    </button>
                  ) : (
                    <span className="deck-check__issue">
                      {warning ? (
                        <InfoIcon {...decorative} weight="bold" />
                      ) : (
                        <WarningCircleIcon {...decorative} weight="bold" />
                      )}
                      {describeDeckIssue(cards, issue)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {missing.length > 0 ? (
        <div className="deck-missing" role="status">
          <div className="deck-missing__head">
            <WarningCircleIcon {...decorative} weight="bold" />
            <strong>
              {missing.length} line{missing.length === 1 ? '' : 's'} from the
              list couldn&apos;t be found
            </strong>
            <Tooltip content="Dismiss">
              <button
                type="button"
                className="ds-icon-button"
                aria-label="Dismiss"
                onClick={onDismissMissing}
              >
                <XIcon {...decorative} weight="bold" />
              </button>
            </Tooltip>
          </div>
          <ul>
            {missing.map((line, index) => (
              <li key={`${line.name}-${index}`}>
                <span className="ds-number">{line.quantity}</span> {line.name}
                {line.print ? (
                  <span className="deck-missing__print"> {line.print}</span>
                ) : null}
                <button
                  type="button"
                  className="ds-button ds-button--ghost"
                  onClick={() => onSearchFor(line.name)}
                >
                  <MagnifyingGlassIcon {...decorative} weight="bold" />
                  Find it
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div
        id="nativeDeckBuilderCardsPanel"
        className="deck-panel__cards"
        data-view={deckView}
      >
        {sorted.length === 0 ? (
          <p className="deck-panel__empty">
            No cards yet. A whole list can be pasted anywhere on this screen.
          </p>
        ) : (
          GROUPS.map((group) => {
            const entries = sorted.filter(
              (entry) => entry.card.category === group.category
            );
            if (entries.length === 0) return null;
            const subgroups =
              group.category === 'Trainer' && deckView === 'list'
                ? [
                    ...TRAINER_SUBGROUPS.map((kind) => ({
                      kind,
                      entries: entries.filter(
                        (entry) => entry.card.facts?.trainerType === kind
                      ),
                    })),
                    {
                      kind: 'Other',
                      entries: entries.filter(
                        (entry) =>
                          !TRAINER_SUBGROUPS.includes(
                            entry.card.facts?.trainerType ?? ''
                          )
                      ),
                    },
                  ].filter((subgroup) => subgroup.entries.length > 0)
                : undefined;
            return (
              <section
                key={group.category}
                className="deck-group"
                aria-label={`${group.label} cards`}
              >
                <h3 className="deck-group__title">
                  {group.label}{' '}
                  <span className="ds-number">
                    {groupTotals[group.category]}
                  </span>
                </h3>
                {subgroups && subgroups.length > 1 ? (
                  subgroups.map((subgroup) => (
                    <div key={subgroup.kind} className="deck-subgroup">
                      <h4 className="deck-subgroup__title">
                        {subgroup.kind}{' '}
                        <span className="ds-number">
                          {subgroup.entries.reduce(
                            (sum, entry) => sum + entry.count,
                            0
                          )}
                        </span>
                      </h4>
                      <ul className="deck-rows">{subgroup.entries.map(row)}</ul>
                    </div>
                  ))
                ) : (
                  <ul
                    className={deckView === 'list' ? 'deck-rows' : 'deck-tiles'}
                  >
                    {entries.map(row)}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
      {check.total > 0 && !check.format.pocket ? (
        <details className="deck-stats">
          <summary>
            Opening hand · {stats.basics} Basic Pokémon ·{' '}
            {percent(stats.mulligan)} mulligan
          </summary>
          <dl>
            <div>
              <dt>No Basic in the opening 7 (mulligan)</dt>
              <dd className="ds-number">{percent(stats.mulligan)}</dd>
            </div>
            <div>
              <dt>Exactly one Basic (it has to start)</dt>
              <dd className="ds-number">{percent(stats.oneBasic)}</dd>
            </div>
            {Object.entries(stats.byTrainerType).map(([kind, count]) => (
              <div key={kind}>
                <dt>{kind === 'Other' ? 'Other Trainers' : `${kind}s`}</dt>
                <dd className="ds-number">{count}</dd>
              </div>
            ))}
            <div>
              <dt>Basic / Special Energy</dt>
              <dd className="ds-number">
                {stats.basicEnergy} / {stats.specialEnergy}
              </dd>
            </div>
            {stats.unknownPokemon > 0 ? (
              <div>
                <dt>Pokémon added by hand (stage unknown)</dt>
                <dd className="ds-number">{stats.unknownPokemon}</dd>
              </div>
            ) : null}
          </dl>
          <SampleHand cards={cards} />
        </details>
      ) : null}
    </section>
  );
};

/** Seven cards and six Prizes off the top of a shuffle, dealt again on request. */
const SampleHand = ({ cards }: { readonly cards: DeckList }) => {
  const [deal, setDeal] = useState(0);
  const opening = useMemo(
    () => (deal === 0 ? undefined : sampleOpening(cards)),
    // A new deal on each press, and when the deck changes.
    [cards, deal]
  );
  return (
    <div className="deck-sample">
      <button
        id="deckSampleHandButton"
        type="button"
        className="ds-button ds-button--secondary"
        onClick={() => setDeal((current) => current + 1)}
      >
        {opening ? 'Deal again' : 'Deal a sample hand'}
      </button>
      {opening ? (
        <div className="deck-sample__deal">
          <p className="deck-sample__label">
            Hand
            {opening.hand.some(isBasicPokemon)
              ? ''
              : ' · no Basic Pokémon: a mulligan'}
          </p>
          <ul className="deck-sample__cards" aria-label="Sample hand">
            {opening.hand.map((card, index) => (
              <li key={`${card.id}-${index}`}>
                <CardImage
                  src={card.imageSmall ?? card.image}
                  fallback={limitlessScanOf(card)}
                  alt={card.name}
                />
              </li>
            ))}
          </ul>
          <p className="deck-sample__label">Prizes</p>
          <ul
            className="deck-sample__cards deck-sample__cards--prizes"
            aria-label="Sample Prizes"
          >
            {opening.prizes.map((card, index) => (
              <li key={`${card.id}-${index}`}>
                <CardImage
                  src={card.imageSmall ?? card.image}
                  fallback={limitlessScanOf(card)}
                  alt={card.name}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

const DeckRow = ({
  entry,
  view,
  cover,
  flagged,
  highlighted,
  onAdd,
  onRemove,
  onInspect,
  onZoom,
  onZoomEnd,
}: {
  readonly entry: DeckEntry;
  readonly view: 'list' | 'images';
  readonly cover: boolean;
  readonly flagged: boolean;
  readonly highlighted: boolean;
  readonly onAdd: (card: DeckCard) => void;
  readonly onRemove: (card: DeckCard) => void;
  readonly onInspect: (card: DeckCard) => void;
  readonly onZoom: (card: ZoomCard, element: HTMLElement) => void;
  readonly onZoomEnd: () => void;
}) => {
  const { card, count } = entry;
  const stop = (event: MouseEvent, run: () => void): void => {
    event.stopPropagation();
    run();
  };
  const print =
    card.set && card.number ? `${card.set} ${card.number}` : 'Added by hand';
  const stepper = (
    <span className="deck-row__stepper">
      <Tooltip content={`Remove one ${card.name}`}>
        <button
          type="button"
          className="deck-row__step"
          aria-label={`Remove one ${card.name}`}
          onClick={(event) => stop(event, () => onRemove(card))}
        >
          <MinusIcon {...decorative} weight="bold" />
        </button>
      </Tooltip>
      <span className="deck-row__count ds-number" aria-hidden="true">
        {count}
      </span>
      <Tooltip content={`Add one ${card.name}`}>
        <button
          type="button"
          className="deck-row__step"
          aria-label={`Add one ${card.name}`}
          onClick={(event) => stop(event, () => onAdd(card))}
        >
          <PlusIcon {...decorative} weight="bold" />
        </button>
      </Tooltip>
    </span>
  );
  return (
    <li
      className={view === 'list' ? 'deck-row' : 'deck-tile-card'}
      data-deck-card={card.id}
      data-flagged={flagged ? 'true' : undefined}
      data-highlighted={highlighted ? 'true' : undefined}
    >
      <button
        type="button"
        className="deck-row__card"
        aria-label={`${count} × ${card.name} (${print}). Details`}
        onClick={() => onInspect(card)}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') onZoom(card, event.currentTarget);
        }}
        onPointerLeave={onZoomEnd}
      >
        <span className="deck-row__art">
          <CardImage
            src={card.imageSmall ?? card.image}
            fallback={limitlessScanOf(card)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
          {view === 'images' ? (
            <span className="deck-row__badge ds-number">{count}</span>
          ) : null}
        </span>
        {view === 'list' ? (
          <span className="deck-row__text">
            <span className="deck-row__name">
              {card.name}
              {cover ? <span className="deck-row__cover"> · cover</span> : null}
            </span>
            <span className="deck-row__print">{print}</span>
          </span>
        ) : null}
      </button>
      {stepper}
    </li>
  );
};
