import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { InfoIcon } from '@phosphor-icons/react/dist/csr/Info';
import { ListIcon } from '@phosphor-icons/react/dist/csr/List';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { i18n } from '@lingui/core';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
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
import { CardImage } from './CardImage.js';
import { deckCardImageOf } from './deck-home-covers.js';
import type { DeckImportLine } from './deck-import.js';
import {
  categoryName,
  formatName,
  trainerTypeName,
  trainerTypePlural,
} from './deck-labels.js';
import { DECK_SCREEN_PREFERENCES } from './deck-screen-preferences.js';
import { useZoomSource, type ZoomCard } from './useHoverZoom.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

const GROUPS: readonly CardCategory[] = ['Pokémon', 'Trainer', 'Energy'];

const TRAINER_SUBGROUPS = ['Supporter', 'Item', 'Tool', 'Stadium'];

const percent = (value: number): string => {
  const digits = value < 0.1 ? 1 : 0;
  return new Intl.NumberFormat(i18n.locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
};

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
  readonly onZoomSourceGone: (element: HTMLElement) => void;
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
  onZoomSourceGone,
}: DeckListPanelProps) => {
  const { t } = useLingui();
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
  const format = formatName(check.format.id);
  const errorCount = check.errors.length;
  const total = check.total;
  const missingLines = missing.length;
  const basics = stats.basics;
  const mulligan = percent(stats.mulligan);
  const groupCardsLabel = (category: CardCategory): string =>
    category === 'Pokémon'
      ? t`Pokémon cards`
      : category === 'Trainer'
        ? t`Trainer cards`
        : t`Energy cards`;

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
      onZoomSourceGone={onZoomSourceGone}
    />
  );

  return (
    <section
      className="deck-panel"
      aria-label={t({ message: 'Deck', context: 'the deck being built' })}
    >
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
                <Trans comment="format is a deck format: Standard, Expanded…">
                  Ready for {format}
                </Trans>
              </>
            ) : (
              <>
                <WarningCircleIcon {...decorative} weight="fill" />
                {t({
                  message: plural(errorCount, {
                    one: `# thing to fix for ${format}`,
                    other: `# things to fix for ${format}`,
                  }),
                  comment: 'format is a deck format: Standard, Expanded…',
                })}
              </>
            )}
          </span>
          <div
            className="deck-panel__view ptcgsim-segmented-control"
            role="radiogroup"
            aria-label={t`Show the deck as`}
          >
            {(
              [
                [
                  'list',
                  t({ message: 'List', context: 'show the deck as' }),
                  t`Show the deck as list`,
                  ListIcon,
                ],
                [
                  'images',
                  t({ message: 'Images', context: 'show the deck as' }),
                  t`Show the deck as images`,
                  SquaresFourIcon,
                ],
              ] as const
            ).map(([value, label, tooltip, Icon]) => (
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
                <Tooltip content={tooltip}>
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
          aria-label={t`Cards in deck`}
          aria-valuemin={0}
          aria-valuemax={size}
          aria-valuenow={Math.min(check.total, size)}
          aria-valuetext={t`${total} of ${size} cards`}
        >
          <span style={{ inlineSize: `${(fill * 100).toFixed(2)}%` }} />
        </div>
        <ul className="deck-check__split">
          {GROUPS.map((category) => (
            <li key={category} data-group={category}>
              {categoryName(category)}{' '}
              <strong className="ds-number">{groupTotals[category]}</strong>
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
              {t`${plural(missingLines, {
                one: '# line not found',
                other: '# lines not found',
              })}`}
            </strong>
            <Tooltip content={t`Dismiss`}>
              <button
                type="button"
                className="ds-icon-button"
                aria-label={t`Dismiss`}
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
                  <Trans>Find it</Trans>
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
            <Trans>No cards yet. Paste a list anywhere here.</Trans>
          </p>
        ) : (
          GROUPS.map((category) => {
            const entries = sorted.filter(
              (entry) => entry.card.category === category
            );
            if (entries.length === 0) return null;
            const subgroups =
              category === 'Trainer' && deckView === 'list'
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
                key={category}
                className="deck-group"
                aria-label={groupCardsLabel(category)}
              >
                <h3 className="deck-group__title">
                  {categoryName(category)}{' '}
                  <span className="ds-number">{groupTotals[category]}</span>
                </h3>
                {subgroups && subgroups.length > 1 ? (
                  subgroups.map((subgroup) => (
                    <div key={subgroup.kind} className="deck-subgroup">
                      <h4 className="deck-subgroup__title">
                        {trainerTypeName(subgroup.kind)}{' '}
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
            <Trans>
              Opening hand · {basics} Basic Pokémon · {mulligan} mulligan
            </Trans>
          </summary>
          <dl>
            <div>
              <dt>
                <Trans>Mulligan (no Basic in 7)</Trans>
              </dt>
              <dd className="ds-number">{mulligan}</dd>
            </div>
            <div>
              <dt>
                <Trans>Exactly one Basic</Trans>
              </dt>
              <dd className="ds-number">{percent(stats.oneBasic)}</dd>
            </div>
            {Object.entries(stats.byTrainerType).map(([kind, count]) => (
              <div key={kind}>
                <dt>{trainerTypePlural(kind)}</dt>
                <dd className="ds-number">{count}</dd>
              </div>
            ))}
            <div>
              <dt>
                <Trans>Basic / Special Energy</Trans>
              </dt>
              <dd className="ds-number">
                {stats.basicEnergy} / {stats.specialEnergy}
              </dd>
            </div>
            {stats.unknownPokemon > 0 ? (
              <div>
                <dt>
                  <Trans>Pokémon added by hand</Trans>
                </dt>
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
  const { t } = useLingui();
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
        {opening ? t`Deal again` : t`Deal a sample hand`}
      </button>
      {opening ? (
        <div className="deck-sample__deal">
          <p className="deck-sample__label">
            {opening.hand.some(isBasicPokemon)
              ? t({ message: 'Hand', context: 'a sample opening hand' })
              : t`Hand · mulligan`}
          </p>
          <ul className="deck-sample__cards" aria-label={t`Sample hand`}>
            {opening.hand.map((card, index) => (
              <li key={`${card.id}-${index}`}>
                <CardImage {...deckCardImageOf(card)} alt={card.name} />
              </li>
            ))}
          </ul>
          <p className="deck-sample__label">
            <Trans context="Prize cards">Prizes</Trans>
          </p>
          <ul
            className="deck-sample__cards deck-sample__cards--prizes"
            aria-label={t`Sample Prizes`}
          >
            {opening.prizes.map((card, index) => (
              <li key={`${card.id}-${index}`}>
                <CardImage {...deckCardImageOf(card)} alt={card.name} />
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
  onZoomSourceGone,
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
  readonly onZoomSourceGone: (element: HTMLElement) => void;
}) => {
  const { t } = useLingui();
  const { card, count } = entry;
  const source = useZoomSource(card, onZoomSourceGone);
  const cardName = card.name;
  const stop = (event: MouseEvent, run: () => void): void => {
    event.stopPropagation();
    run();
  };
  const print =
    card.set && card.number ? `${card.set} ${card.number}` : t`Added by hand`;
  const removeOne = t`Remove one ${cardName}`;
  const addOne = t`Add one ${cardName}`;
  const stepper = (
    <span className="deck-row__stepper">
      <Tooltip content={removeOne}>
        <button
          type="button"
          className="deck-row__step"
          aria-label={removeOne}
          onClick={(event) => stop(event, () => onRemove(card))}
        >
          <MinusIcon {...decorative} weight="bold" />
        </button>
      </Tooltip>
      <span className="deck-row__count ds-number" aria-hidden="true">
        {count}
      </span>
      <Tooltip content={addOne}>
        <button
          type="button"
          className="deck-row__step"
          aria-label={addOne}
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
        ref={source}
        type="button"
        className="deck-row__card"
        aria-label={t({
          message: `${count} × ${cardName} (${print}). Details`,
          comment: 'A deck row: copies × card name (set and number)',
        })}
        onClick={() => onInspect(card)}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') onZoom(card, event.currentTarget);
        }}
        onPointerLeave={onZoomEnd}
      >
        <span className="deck-row__art">
          <CardImage
            {...deckCardImageOf(card)}
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
              {cover ? (
                <span className="deck-row__cover">
                  {' '}
                  · <Trans context="the deck's cover card">cover</Trans>
                </span>
              ) : null}
            </span>
            <span className="deck-row__print">{print}</span>
          </span>
        ) : null}
      </button>
      {stepper}
    </li>
  );
};
