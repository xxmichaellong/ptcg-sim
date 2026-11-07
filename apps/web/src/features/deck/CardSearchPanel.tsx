import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { FadersHorizontalIcon } from '@phosphor-icons/react/dist/csr/FadersHorizontal';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { QuestionIcon } from '@phosphor-icons/react/dist/csr/Question';
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  CATALOG_SORTS,
  ENERGY_TYPES,
  parseCardQuery,
  ruleName,
  searchCatalog,
  type CatalogCard,
  type CatalogSort,
  type DeckFormatId,
  type DeckList,
  type EnergyType,
  type QueryClause,
} from '@ptcgsim/deck-core';
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { preferences } from '../../preferences/preference-store.js';
import { usePreference } from '../../preferences/usePreference.js';
import { Tooltip } from '../../ui/Tooltip.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { CardImage, limitlessScanOf } from './CardImage.js';
import {
  categoryName,
  energyKindName,
  energyTypeName,
  formatName,
  sortName,
  stageName,
  tagName,
  trainerTypeName,
} from './deck-labels.js';
import { DECK_SCREEN_PREFERENCES } from './deck-screen-preferences.js';
import { EnergySymbol } from './energy-symbol.js';
import { searchFilterCount, withoutSearchFilters } from './search-filters.js';
import {
  filterChoicesOf,
  NO_FILTER_CHOICES,
  SearchFiltersDrawer,
} from './SearchFiltersDrawer.js';
import { useCardCatalog } from './useCardCatalog.js';
import { useZoomSource, type ZoomCard } from './useHoverZoom.js';
import type { WarmCardImage } from './warm-card-images.js';
import { isInputMethodKey } from '../../ui/input-method.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

/** Results drawn at a time; more as the grid scrolls. */
const PAGE = 90;

/** A result's picture as its <img> asks for it. */
export const resultImageOf = (card: CatalogCard): WarmCardImage => ({
  src: card.imageSmall,
  fallback: limitlessScanOf(
    {
      name: card.name,
      image: card.imageSmall,
      set: card.set.code,
      number: card.number,
    },
    'small'
  ),
});

type Kind = 'Pokémon' | 'Trainer' | 'Energy';

export interface Chips {
  readonly kinds: readonly Kind[];
  readonly stages: readonly string[];
  readonly tags: readonly string[];
  readonly trainerTypes: readonly string[];
  readonly energyKinds: readonly string[];
  readonly types: readonly EnergyType[];
}

const NO_CHIPS: Chips = {
  kinds: [],
  stages: [],
  tags: [],
  trainerTypes: [],
  energyKinds: [],
  types: [],
};

const POKEMON_STAGES = ['Basic', 'Stage 1', 'Stage 2'];
const POKEMON_TAGS = [
  'ex',
  'V',
  'VSTAR',
  'VMAX',
  'Tera',
  'Radiant',
  'Ancient',
  'Future',
  'Mega',
];
const TRAINER_TYPES = ['Supporter', 'Item', 'Tool', 'Stadium'];
const STAGE_QUERY: Readonly<Record<string, string>> = {
  Basic: 'basic',
  'Stage 1': 'stage1',
  'Stage 2': 'stage2',
};
const TAG_QUERY: Readonly<Record<string, string>> = {
  ex: 'ex',
  V: 'v',
  VSTAR: 'vstar',
  VMAX: 'vmax',
  Tera: 'tera',
  Radiant: 'radiant',
  Ancient: 'ancient',
  Future: 'future',
  Mega: 'mega',
  'ACE SPEC': 'ace',
};

const toggle = <Value,>(
  list: readonly Value[],
  value: Value
): readonly Value[] =>
  list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];

const clause = (
  field: QueryClause['field'],
  values: readonly string[],
  operator: QueryClause['operator'] = ':',
  negate = false
): QueryClause => ({ field, operator, values, ...(negate ? { negate } : {}) });

/**
 * The chips as query clauses: the same language typed queries use. (The
 * More filters drawer writes its own into the query: search-filters.ts.)
 */
export const searchFilterClauses = (
  chips: Chips,
  legality: DeckFormatId | undefined
): readonly QueryClause[] => {
  const clauses: QueryClause[] = [];
  if (chips.kinds.length > 0) {
    clauses.push(
      clause(
        'type',
        chips.kinds.map((kind) => kind.toLowerCase().replace('é', 'e'))
      )
    );
  }
  if (chips.stages.length > 0) {
    clauses.push(
      clause(
        'stage',
        chips.stages.map((stage) => STAGE_QUERY[stage] ?? stage)
      )
    );
  }
  if (chips.tags.length > 0) {
    clauses.push(
      clause(
        'is',
        chips.tags.map((tag) => TAG_QUERY[tag] ?? tag)
      )
    );
  }
  if (chips.trainerTypes.length > 0) {
    clauses.push(
      clause(
        'type',
        chips.trainerTypes.map((kind) => kind.toLowerCase())
      )
    );
  }
  if (chips.energyKinds.length > 0) {
    clauses.push(
      clause(
        'type',
        chips.energyKinds.map((kind) => `${kind.toLowerCase()} energy`)
      )
    );
  }
  if (chips.types.length > 0) clauses.push(clause('type', chips.types));
  if (legality) clauses.push(clause('format', [legality]));
  return clauses;
};

/** The cards a search finds, in the order the panel shows them. */
export const searchResults = (
  cards: readonly CatalogCard[],
  search: {
    readonly query: string;
    readonly chips: Chips;
    readonly legality: DeckFormatId | undefined;
    readonly sort: CatalogSort;
    readonly allPrints: boolean;
  }
) =>
  searchCatalog(cards, parseCardQuery(search.query), {
    clauses: searchFilterClauses(search.chips, search.legality),
    sort: search.sort,
    unique: search.allPrints ? 'prints' : 'cards',
  });

/**
 * What the panel shows before anything is searched for: the cards legal in
 * `format`, in the player's order.
 */
export const openingSearchResults = (
  cards: readonly CatalogCard[],
  format: DeckFormatId,
  order: { readonly sort: CatalogSort; readonly allPrints: boolean }
) =>
  searchResults(cards, {
    query: '',
    chips: NO_CHIPS,
    legality: format,
    ...order,
  });

const Chip = ({
  label,
  pressed,
  onToggle,
  title,
  className,
  children,
}: {
  readonly label: string;
  readonly pressed: boolean;
  readonly onToggle: () => void;
  readonly title?: string;
  readonly className?: string;
  readonly children?: ReactNode;
}) => {
  const button = (
    <button
      type="button"
      className={`deck-chip${className ? ` ${className}` : ''}`}
      aria-pressed={pressed}
      {...(title ? { 'aria-label': title } : {})}
      onClick={onToggle}
    >
      {children ?? label}
    </button>
  );
  return title ? <Tooltip content={title}>{button}</Tooltip> : button;
};

/**
 * Example queries and what they find. The queries are Limitless's search
 * syntax and stay as typed; only their meanings are translated.
 */
const SYNTAX_HELP: readonly (readonly [string, MessageDescriptor])[] = [
  ['charizard', msg`Name contains the words`],
  ['"boss’s orders"', msg`Name contains the phrase`],
  ['t:fire s:basic', msg`Fire type, Basic`],
  ['is:ex,v', msg`ex or V (comma = or)`],
  ['-is:ex', msg`not ex (minus = not)`],
  ['hp>=200 rc<=1', msg`HP and retreat`],
  ['ac<=cc', msg`An attack payable with two Energy`],
  ['text:draw_3_cards', msg`Exact phrase in the rules text`],
  ['has:ability w:none', msg`Has an Ability, no Weakness`],
  ['reg>=h f:standard', msg`Regulation mark, format`],
  ['e:PAL a:"5ban"', msg`Set code, illustrator`],
  ['o:hp u:prints', msg`Sort by HP, show every print`],
];

export interface CardSearchPanelProps {
  readonly catalog: CardCatalogSource;
  readonly deck: DeckList;
  readonly format: DeckFormatId;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly onAdd: (card: CatalogCard) => void;
  readonly onRemove: (card: CatalogCard) => void;
  readonly onInspect: (card: CatalogCard) => void;
  readonly onCustomCard: () => void;
  readonly onZoom: (card: ZoomCard, element: HTMLElement) => void;
  readonly onZoomEnd: () => void;
  readonly onZoomSourceGone: (element: HTMLElement) => void;
  readonly onScroll: () => void;
}

export const CardSearchPanel = ({
  catalog,
  deck,
  format,
  searchRef,
  onAdd,
  onRemove,
  onInspect,
  onCustomCard,
  onZoom,
  onZoomEnd,
  onZoomSourceGone,
  onScroll,
}: CardSearchPanelProps) => {
  const { t } = useLingui();
  const catalogState = useCardCatalog(catalog);
  const screenPreferences = usePreference(DECK_SCREEN_PREFERENCES);
  const [text, setText] = useState('');
  const [chips, setChips] = useState<Chips>(NO_CHIPS);
  const [legalOnly, setLegalOnly] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const drawerId = useId();
  const sentinel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const legality: DeckFormatId | undefined = legalOnly ? format : undefined;
  const query = useDeferredValue(text);
  const deferredChips = useDeferredValue(chips);
  const loaded =
    catalogState.status === 'ready' ? catalogState.catalog : undefined;

  const result = useMemo(() => {
    if (!loaded) return undefined;
    return searchResults(loaded.cards, {
      query,
      chips: deferredChips,
      legality,
      sort: screenPreferences.sort,
      allPrints: screenPreferences.allPrints,
    });
  }, [
    deferredChips,
    legality,
    loaded,
    query,
    screenPreferences.allPrints,
    screenPreferences.sort,
  ]);

  // A new search starts at the top.
  useEffect(() => {
    setShown(PAGE);
    grid.current?.scrollTo({ top: 0 });
  }, [result]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !result || shown >= result.cards.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown((current) => current + PAGE);
        }
      },
      { root: grid.current, rootMargin: '600px' }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [result, shown]);

  const inDeckByName = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { card, count } of deck) {
      const key = ruleName(card);
      counts.set(key, (counts.get(key) ?? 0) + count);
    }
    return counts;
  }, [deck]);

  const drawerCount = searchFilterCount(text);
  const filterChoices = useMemo(
    () => (loaded ? filterChoicesOf(loaded.cards) : NO_FILTER_CHOICES),
    [loaded]
  );
  const kinds = chips.kinds;
  const only = (kind: Kind): boolean => kinds.length === 1 && kinds[0] === kind;
  const filterCount =
    kinds.length +
    chips.stages.length +
    chips.tags.length +
    chips.trainerTypes.length +
    chips.energyKinds.length +
    chips.types.length +
    drawerCount;

  const clearFilters = (): void => {
    setChips(NO_CHIPS);
    setText(withoutSearchFilters);
  };

  const setKind = (kind: Kind): void => {
    setChips((current) => {
      const next = toggle(current.kinds, kind);
      // Sub-filters belong to one kind; they go when it does.
      return {
        ...current,
        kinds: next,
        stages:
          next.length === 1 && next[0] === 'Pokémon' ? current.stages : [],
        tags:
          next.length === 1 && (next[0] === 'Pokémon' || next[0] === 'Trainer')
            ? current.tags
            : [],
        trainerTypes:
          next.length === 1 && next[0] === 'Trainer'
            ? current.trainerTypes
            : [],
        energyKinds:
          next.length === 1 && next[0] === 'Energy' ? current.energyKinds : [],
      };
    });
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (isInputMethodKey(event.nativeEvent)) return;
    if (event.key === 'Enter') {
      const first = result?.cards[0];
      if (first) {
        event.preventDefault();
        onAdd(first);
      }
    } else if (event.key === 'ArrowDown') {
      const firstButton =
        grid.current?.querySelector<HTMLButtonElement>('.card-result');
      if (firstButton) {
        event.preventDefault();
        firstButton.focus();
      }
    } else if (event.key === 'Escape' && text) {
      event.preventDefault();
      event.stopPropagation();
      setText('');
    }
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !target.classList.contains('card-result')
    )
      return;
    const buttons = [
      ...(grid.current?.querySelectorAll<HTMLButtonElement>('.card-result') ??
        []),
    ];
    const index = buttons.indexOf(target as HTMLButtonElement);
    if (index < 0) return;
    const columns = Math.max(
      1,
      Math.round(
        (grid.current?.clientWidth ?? 1) /
          (target.getBoundingClientRect().width || 1)
      )
    );
    // Right to left, the grid fills from the right: the arrow pointing that
    // way goes on to the next card.
    const forward = getComputedStyle(target).direction === 'rtl' ? -1 : 1;
    const step: Record<string, number> = {
      ArrowRight: forward,
      ArrowLeft: -forward,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    const card = result?.cards[index];
    if (event.key in step) {
      const next = index + step[event.key]!;
      if (next < 0 && event.key === 'ArrowUp') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const button = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
      if (button) {
        event.preventDefault();
        button.focus();
      }
    } else if (
      card &&
      (event.key === '-' || event.key === 'Backspace' || event.key === 'Delete')
    ) {
      event.preventDefault();
      onRemove(card);
    } else if (
      card &&
      (event.key === 'i' || (event.key === 'Enter' && event.shiftKey))
    ) {
      event.preventDefault();
      onInspect(card);
    }
  };

  const formatLabel = formatName(format);
  const summary = (() => {
    if (!result) return '';
    const count = result.cards.length;
    if (legality) {
      const legalIn = formatName(legality);
      return screenPreferences.allPrints
        ? t`${plural(count, { one: `# print · legal in ${legalIn}`, other: `# prints · legal in ${legalIn}` })}`
        : t`${plural(count, { one: `# card · legal in ${legalIn}`, other: `# cards · legal in ${legalIn}` })}`;
    }
    return screenPreferences.allPrints
      ? t`${plural(count, { one: '# print', other: '# prints' })}`
      : t`${plural(count, { one: '# card', other: '# cards' })}`;
  })();

  return (
    <section className="card-search" aria-label={t`Find cards`}>
      <div className="card-search__controls">
        <div className="card-search__row">
          <label className="card-search__field">
            <MagnifyingGlassIcon {...decorative} weight="bold" />
            <input
              ref={searchRef}
              id="nativeDeckBuilderSearchInput"
              className="ds-input card-search__input"
              type="search"
              autoComplete="off"
              spellCheck={false}
              aria-label={t`Search cards`}
              aria-describedby="cardSearchHint"
              placeholder={t`Search cards`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onSearchKeyDown}
            />
          </label>
          <Tooltip content={t`Search syntax`}>
            <button
              type="button"
              className="ds-icon-button"
              aria-label={t`Search syntax`}
              aria-expanded={showHelp}
              onClick={() => setShowHelp((current) => !current)}
            >
              <QuestionIcon {...decorative} weight="bold" />
            </button>
          </Tooltip>
          <Tooltip content={t`Sort results`}>
            <label className="card-search__sort">
              <span className="ds-visually-hidden">
                <Trans>Sort by</Trans>
              </span>
              <select
                id="nativeDeckBuilderSortBy"
                className="ds-select"
                value={screenPreferences.sort}
                onChange={(event) =>
                  preferences().patch(DECK_SCREEN_PREFERENCES, {
                    sort: event.target.value as CatalogSort,
                  })
                }
              >
                {CATALOG_SORTS.map((sort) => (
                  <option key={sort} value={sort}>
                    {sortName(sort)}
                  </option>
                ))}
              </select>
            </label>
          </Tooltip>
          <Tooltip
            content={
              screenPreferences.allPrints
                ? t`Show one per card`
                : t`Show every print`
            }
          >
            <button
              type="button"
              className="ds-icon-button"
              aria-label={t`Show every print`}
              aria-pressed={screenPreferences.allPrints}
              onClick={() =>
                preferences().patch(DECK_SCREEN_PREFERENCES, {
                  allPrints: !screenPreferences.allPrints,
                })
              }
            >
              <StackIcon {...decorative} weight="bold" />
            </button>
          </Tooltip>
          <Tooltip content={t`More filters`}>
            <button
              type="button"
              className="ds-icon-button card-search__more"
              aria-label={t`More filters`}
              aria-expanded={showAdvanced}
              aria-controls={drawerId}
              data-active={drawerCount > 0 ? 'true' : undefined}
              onClick={() => setShowAdvanced((current) => !current)}
            >
              <FadersHorizontalIcon {...decorative} weight="bold" />
              {drawerCount > 0 ? (
                <span className="card-search__badge ds-number">
                  {drawerCount}
                </span>
              ) : null}
            </button>
          </Tooltip>
        </div>
        {showHelp ? (
          <div className="card-search__help" role="note">
            <p>
              <Trans>Uses Limitless TCG&apos;s search syntax.</Trans>
            </p>
            <dl>
              {SYNTAX_HELP.map(([example, meaning]) => (
                <div key={example}>
                  <dt>
                    <button
                      type="button"
                      className="card-search__example"
                      onClick={() => setText(example)}
                    >
                      {example}
                    </button>
                  </dt>
                  <dd>{i18n._(meaning)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        <div
          className="card-search__chips"
          role="group"
          aria-label={t`Filters`}
        >
          {(['Pokémon', 'Trainer', 'Energy'] as const).map((kind) => (
            <Chip
              key={kind}
              label={categoryName(kind)}
              pressed={kinds.includes(kind)}
              onToggle={() => setKind(kind)}
            />
          ))}
          {only('Pokémon') ? (
            <>
              <span className="card-search__divider" aria-hidden="true" />
              {POKEMON_STAGES.map((stage) => (
                <Chip
                  key={stage}
                  label={stageName(stage)}
                  pressed={chips.stages.includes(stage)}
                  onToggle={() =>
                    setChips((current) => ({
                      ...current,
                      stages: toggle(current.stages, stage),
                    }))
                  }
                />
              ))}
              <span className="card-search__divider" aria-hidden="true" />
              {POKEMON_TAGS.map((tag) => (
                <Chip
                  key={tag}
                  label={tagName(tag)}
                  pressed={chips.tags.includes(tag)}
                  onToggle={() =>
                    setChips((current) => ({
                      ...current,
                      tags: toggle(current.tags, tag),
                    }))
                  }
                />
              ))}
            </>
          ) : null}
          {only('Trainer') ? (
            <>
              <span className="card-search__divider" aria-hidden="true" />
              {TRAINER_TYPES.map((kind) => (
                <Chip
                  key={kind}
                  label={trainerTypeName(kind)}
                  pressed={chips.trainerTypes.includes(kind)}
                  onToggle={() =>
                    setChips((current) => ({
                      ...current,
                      trainerTypes: toggle(current.trainerTypes, kind),
                    }))
                  }
                />
              ))}
              <Chip
                label="ACE SPEC"
                pressed={chips.tags.includes('ACE SPEC')}
                onToggle={() =>
                  setChips((current) => ({
                    ...current,
                    tags: toggle(current.tags, 'ACE SPEC'),
                  }))
                }
              />
            </>
          ) : null}
          {only('Energy') ? (
            <>
              <span className="card-search__divider" aria-hidden="true" />
              {(['Basic', 'Special'] as const).map((kind) => (
                <Chip
                  key={kind}
                  label={energyKindName(kind)}
                  pressed={chips.energyKinds.includes(kind)}
                  onToggle={() =>
                    setChips((current) => ({
                      ...current,
                      energyKinds: toggle(current.energyKinds, kind),
                    }))
                  }
                />
              ))}
            </>
          ) : null}
        </div>
        <div
          className="card-search__types"
          role="group"
          aria-label={t({ message: 'Type', context: 'Pokémon type' })}
        >
          {ENERGY_TYPES.map((type) => (
            <Chip
              key={type}
              label={energyTypeName(type)}
              title={energyTypeName(type)}
              className="deck-chip--energy"
              pressed={chips.types.includes(type)}
              onToggle={() =>
                setChips((current) => ({
                  ...current,
                  types: toggle(current.types, type),
                }))
              }
            >
              <EnergySymbol type={type} />
            </Chip>
          ))}
        </div>
        <SearchFiltersDrawer
          id={drawerId}
          open={showAdvanced}
          text={text}
          choices={filterChoices}
          onText={setText}
          onClose={() => setShowAdvanced(false)}
        />
        <div className="card-search__status" id="cardSearchHint">
          <span
            id="nativeDeckBuilderSearchStatus"
            className="card-search__summary"
            aria-live="polite"
          >
            {catalogState.status === 'ready' ? summary : null}
          </span>
          <label className="card-search__legal">
            <input
              type="checkbox"
              className="ds-switch"
              checked={legalOnly}
              onChange={(event) => setLegalOnly(event.target.checked)}
            />
            <Trans comment="formatLabel is a deck format: Standard, Expanded…">
              Only {formatLabel}-legal
            </Trans>
          </label>
          {filterCount > 0 ? (
            <button
              type="button"
              className="ds-button ds-button--ghost card-search__clear"
              onClick={clearFilters}
            >
              <XIcon {...decorative} weight="bold" />
              <Trans>Clear filters</Trans>
            </button>
          ) : null}
          <button
            id="nativeDeckBuilderAddCustomCard"
            type="button"
            className="ds-button ds-button--ghost card-search__clear"
            aria-description={t`Add a card that isn't listed`}
            onClick={onCustomCard}
          >
            <PlusIcon {...decorative} weight="bold" />
            <Trans>Custom card</Trans>
          </button>
        </div>
      </div>
      <div
        ref={grid}
        id="nativeDeckBuilderSearchResults"
        className="card-search__results"
        onScroll={onScroll}
        onKeyDown={onGridKeyDown}
      >
        {catalogState.status === 'ready' && result ? (
          result.cards.length === 0 ? (
            <div className="card-search__empty">
              <p>{text ? t`No cards match “${text}”.` : t`No cards match.`}</p>
              <div className="card-search__empty-actions">
                {legalOnly ? (
                  <button
                    type="button"
                    className="ds-button ds-button--secondary"
                    onClick={() => setLegalOnly(false)}
                  >
                    <Trans>Search every format</Trans>
                  </button>
                ) : null}
                {filterCount > 0 ? (
                  <button
                    type="button"
                    className="ds-button ds-button--secondary"
                    onClick={clearFilters}
                  >
                    <Trans>Clear filters</Trans>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ds-button ds-button--ghost"
                  onClick={onCustomCard}
                >
                  <PlusIcon {...decorative} weight="bold" />
                  <Trans>Make a custom card</Trans>
                </button>
              </div>
            </div>
          ) : (
            <>
              <ul className="card-search__grid" aria-label={t`Cards found`}>
                {result.cards.slice(0, shown).map((card) => (
                  <CardResult
                    key={card.id}
                    card={card}
                    inDeck={inDeckByName.get(ruleName(card)) ?? 0}
                    prints={result.printCounts.get(card.printGroup) ?? 1}
                    showPrints={!screenPreferences.allPrints}
                    onAdd={onAdd}
                    onRemove={onRemove}
                    onInspect={onInspect}
                    onZoom={onZoom}
                    onZoomEnd={onZoomEnd}
                    onZoomSourceGone={onZoomSourceGone}
                  />
                ))}
              </ul>
              {shown < result.cards.length ? (
                <div ref={sentinel} className="card-search__sentinel" />
              ) : null}
              <p className="card-search__footer">
                <Trans>
                  Shift+click removes one · Right-click for details · Enter adds
                  the top result
                </Trans>
              </p>
            </>
          )
        ) : (
          <CatalogStatus
            state={catalogState.status}
            onRetry={() => catalog.retry()}
          />
        )}
      </div>
    </section>
  );
};

const CatalogStatus = ({
  state,
  onRetry,
}: {
  readonly state: 'idle' | 'loading' | 'failed' | 'ready';
  readonly onRetry: () => void;
}) =>
  state === 'failed' ? (
    <div className="card-search__empty" role="alert">
      <p>
        <Trans>Cards didn&apos;t load.</Trans>
      </p>
      <button
        type="button"
        className="ds-button ds-button--secondary"
        onClick={onRetry}
      >
        <ArrowClockwiseIcon {...decorative} weight="bold" />
        <Trans>Try again</Trans>
      </button>
    </div>
  ) : (
    <div className="card-search__loading" role="status">
      <CircleNotchIcon {...decorative} weight="bold" className="ds-spin" />
      <Trans>Loading cards…</Trans>
      <div className="card-search__skeleton" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  );

const CardResult = ({
  card,
  inDeck,
  prints,
  showPrints,
  onAdd,
  onRemove,
  onInspect,
  onZoom,
  onZoomEnd,
  onZoomSourceGone,
}: {
  readonly card: CatalogCard;
  readonly inDeck: number;
  readonly prints: number;
  readonly showPrints: boolean;
  readonly onAdd: (card: CatalogCard) => void;
  readonly onRemove: (card: CatalogCard) => void;
  readonly onInspect: (card: CatalogCard) => void;
  readonly onZoom: (card: ZoomCard, element: HTMLElement) => void;
  readonly onZoomEnd: () => void;
  readonly onZoomSourceGone: (element: HTMLElement) => void;
}) => {
  const { t } = useLingui();
  const source = useZoomSource(card, onZoomSourceGone);
  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (event.shiftKey) onRemove(card);
    else onAdd(card);
  };
  const cardName = card.name;
  const print = `${card.set.name} ${card.number}`;
  return (
    <li className="card-result-cell">
      <button
        ref={source}
        type="button"
        className="card-result"
        data-in-deck={inDeck > 0 ? 'true' : undefined}
        aria-label={
          inDeck > 0
            ? t({
                message: `${cardName}, ${print}, ${inDeck} in deck. Add one.`,
                comment: 'A search result: card name, set and number',
              })
            : t({
                message: `${cardName}, ${print}. Add one.`,
                comment: 'A search result: card name, set and number',
              })
        }
        onClick={onClick}
        onContextMenu={(event) => {
          event.preventDefault();
          onZoomEnd();
          onInspect(card);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') onZoom(card, event.currentTarget);
        }}
        onPointerLeave={onZoomEnd}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible'))
            onZoom(card, event.currentTarget);
        }}
        onBlur={onZoomEnd}
      >
        <span className="card-result__frame">
          <CardImage
            {...resultImageOf(card)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
          {inDeck > 0 ? (
            <span className="card-result__count ds-number">{inDeck}</span>
          ) : null}
          <span className="card-result__add" aria-hidden="true">
            <PlusIcon weight="bold" />
          </span>
        </span>
        <span className="card-result__name">{card.name}</span>
        <span className="card-result__set">
          {card.set.code ?? card.set.id} {card.number}
          {showPrints && prints > 1 ? (
            <span className="card-result__prints">
              {' '}
              · {t`${plural(prints, { one: '# print', other: '# prints' })}`}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
};
