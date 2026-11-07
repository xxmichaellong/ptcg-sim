import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { Collapsible } from '@base-ui/react/collapsible';
import { Combobox } from '@base-ui/react/combobox';
import { NumberField } from '@base-ui/react/number-field';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  ENERGY_TYPES,
  foldText,
  type CatalogCard,
  type EnergyType,
} from '@ptcgsim/deck-core';
import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { OverlayContainerContext } from '../../ui/overlay-host-registry.js';
import { energyTypeName } from './deck-labels.js';
import { EnergySymbol } from './energy-symbol.js';
import {
  readSearchFilters,
  withSearchFilter,
  withoutSearchFilters,
  type SearchFilterKey,
  type SearchFilters,
} from './search-filters.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

/** One entry of a searchable list: a set, or a rarity. */
export interface FilterChoice {
  /** What the query names it by: a set's code, a rarity as spelled. */
  readonly value: string;
  readonly label: string;
  /** Shown beside the label: a set's code. */
  readonly detail?: string;
  /** Folded words a typed value may name it by. */
  readonly keys: readonly string[];
}

export interface FilterChoices {
  readonly sets: readonly FilterChoice[];
  readonly rarities: readonly FilterChoice[];
  readonly marks: readonly string[];
}

export const NO_FILTER_CHOICES: FilterChoices = {
  sets: [],
  rarities: [],
  marks: [],
};

/** The sets (newest first), rarities and regulation marks the catalog has. */
export const filterChoicesOf = (
  cards: readonly CatalogCard[]
): FilterChoices => {
  const sets = new Map<string, CatalogCard['set']>();
  const rarities = new Set<string>();
  const marks = new Set<string>();
  for (const card of cards) {
    const value = card.set.code ?? card.set.id;
    if (!sets.has(value)) sets.set(value, card.set);
    if (card.rarity) rarities.add(card.rarity);
    if (card.regulationMark) marks.add(card.regulationMark.toUpperCase());
  }
  return {
    sets: [...sets]
      .sort(([, left], [, right]) =>
        right.released.localeCompare(left.released)
      )
      .map(([value, set]) => ({
        value,
        label: set.name,
        detail: value,
        keys: [value, set.id, set.name].map(foldText),
      })),
    rarities: [...rarities]
      .sort((left, right) => left.localeCompare(right))
      .map((rarity) => ({
        value: rarity,
        label: rarity,
        keys: [foldText(rarity)],
      })),
    marks: [...marks].sort(),
  };
};

/** Cost symbols: every type but Dragon, which no attack asks for. */
const COST_TYPES = ENERGY_TYPES.filter((type) => type !== 'Dragon');

/** A number with a step down and up: HP, damage. */
const Stepper = ({
  label,
  placeholder,
  value,
  step,
  max,
  onChange,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: number | undefined;
  readonly step: number;
  readonly max: number;
  readonly onChange: (value: number | undefined) => void;
}) => {
  const { t } = useLingui();
  return (
    <NumberField.Root
      className="filter-stepper"
      value={value ?? null}
      min={0}
      max={max}
      step={step}
      format={{ useGrouping: false }}
      onValueChange={(next) => onChange(next ?? undefined)}
    >
      <NumberField.Group className="filter-stepper__group">
        <NumberField.Decrement
          className="filter-stepper__button"
          aria-label={t`Lower ${label}`}
        >
          <MinusIcon {...decorative} weight="bold" />
        </NumberField.Decrement>
        <NumberField.Input
          className="filter-stepper__input"
          aria-label={label}
          placeholder={placeholder}
        />
        <NumberField.Increment
          className="filter-stepper__button"
          aria-label={t`Raise ${label}`}
        >
          <PlusIcon {...decorative} weight="bold" />
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
};

/**
 * A list to search and pick from, any number at a time: what the query
 * names that the list lacks still shows, to take off.
 */
const SearchableList = ({
  label,
  choices,
  value,
  onChange,
}: {
  readonly label: string;
  readonly choices: readonly FilterChoice[];
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
}) => {
  const { t } = useLingui();
  const id = useId();
  const container = useContext(OverlayContainerContext);
  const selected = useMemo(
    () =>
      value.map((typed): FilterChoice => {
        const key = foldText(typed.replaceAll('_', ' '));
        return (
          choices.find((choice) => choice.keys.includes(key)) ?? {
            value: typed,
            label: typed,
            keys: [key],
          }
        );
      }),
    [choices, value]
  );
  return (
    <div className="advanced-filter advanced-filter--list">
      <label htmlFor={id}>{label}</label>
      <Combobox.Root
        multiple
        autoHighlight
        items={choices}
        // Several picked from one search: the list stays open after each.
        onOpenChange={(open, details) => {
          if (!open && details.reason === 'item-press') details.cancel();
        }}
        value={selected}
        onValueChange={(next: FilterChoice[]) =>
          onChange(next.map((choice) => choice.value))
        }
        isItemEqualToValue={(item: FilterChoice, picked: FilterChoice) =>
          item.value === picked.value
        }
        itemToStringLabel={(choice: FilterChoice) =>
          choice.detail ? `${choice.label} ${choice.detail}` : choice.label
        }
      >
        <Combobox.InputGroup className="ds-input filter-list">
          <Combobox.Chips className="filter-list__chips">
            {selected.map((choice) => {
              const name = choice.label;
              return (
                <Combobox.Chip
                  key={choice.value}
                  className="filter-list__chip"
                  aria-label={choice.detail ?? name}
                >
                  {choice.detail ?? name}
                  <Combobox.ChipRemove
                    className="filter-list__chip-remove"
                    aria-label={t`Remove ${name}`}
                  >
                    <XIcon {...decorative} weight="bold" />
                  </Combobox.ChipRemove>
                </Combobox.Chip>
              );
            })}
            <Combobox.Input
              id={id}
              className="filter-list__input"
              placeholder={
                selected.length > 0
                  ? ''
                  : t({ message: 'Any', context: 'filter' })
              }
            />
          </Combobox.Chips>
        </Combobox.InputGroup>
        <Combobox.Portal container={container}>
          <Combobox.Positioner
            className="ptcgsim-action-menu-positioner"
            sideOffset={4}
            align="start"
          >
            <Combobox.Popup className="ptcgsim-action-menu filter-list__popup">
              <Combobox.Empty className="filter-list__empty">
                <Trans>No match</Trans>
              </Combobox.Empty>
              <Combobox.List>
                {(choice: FilterChoice) => (
                  <Combobox.Item
                    key={choice.value}
                    value={choice}
                    className="ptcgsim-action-menu__item"
                  >
                    <span className="ptcgsim-action-menu__icon">
                      <Combobox.ItemIndicator>
                        <CheckIcon {...decorative} weight="bold" />
                      </Combobox.ItemIndicator>
                    </span>
                    <span className="ptcgsim-action-menu__text">
                      {choice.label}
                    </span>
                    {choice.detail ? (
                      <span className="filter-list__detail">
                        {choice.detail}
                      </span>
                    ) : null}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
};

/**
 * Free text written into the query as the player types: what they typed
 * stays as typed (a space at its end too) while the query reads the same.
 */
const QueryText = ({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) => {
  const [draft, setDraft] = useState(value);
  const words = (text: string): string => foldText(text.replaceAll(',', ' '));
  return (
    <label className="advanced-filter">
      <span>{label}</span>
      <input
        className="ds-input"
        value={words(draft) === words(value) ? draft : value}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
      />
    </label>
  );
};

export const SearchFiltersDrawer = ({
  id,
  open,
  text,
  choices,
  onText,
  onClose,
}: {
  readonly id: string;
  readonly open: boolean;
  /** The search box's query, which holds the drawer's filters. */
  readonly text: string;
  readonly choices: FilterChoices;
  readonly onText: (update: (text: string) => string) => void;
  readonly onClose: () => void;
}) => {
  const { t } = useLingui();
  const filters = readSearchFilters(text);
  const set = <Key extends SearchFilterKey>(
    key: Key,
    next: (current: SearchFilters[Key]) => SearchFilters[Key]
  ): void =>
    onText((current) =>
      withSearchFilter(current, key, next(readSearchFilters(current)[key]))
    );
  const hpId = useId();
  const costId = useId();
  const panel = useRef<HTMLDivElement>(null);

  // Where the controls scroll (a phone), the drawer opens into view.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const element = panel.current;
      const scroller = element?.closest<HTMLElement>('.card-search__controls');
      if (!element || !scroller) return;
      const box = scroller.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= box.bottom) return;
      scroller.scrollTo({
        top: scroller.scrollTop + rect.top - box.top - 8,
        behavior:
          document.documentElement.dataset['motion'] === 'reduced'
            ? 'auto'
            : 'smooth',
      });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [open]);

  const costOf = (type: EnergyType): number =>
    filters.cost.filter((symbol) => symbol === type).length;
  const takeOne = (type: EnergyType): void =>
    set('cost', (cost) => {
      const at = cost.lastIndexOf(type);
      return at < 0 ? cost : cost.filter((_, index) => index !== at);
    });
  const onCostKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    type: EnergyType
  ): void => {
    if (['Backspace', 'Delete', '-'].includes(event.key)) {
      event.preventDefault();
      takeOne(type);
    }
  };

  const triState = (key: 'ability' | 'ruleBox', label: string) => (
    <div className="advanced-filter" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="ptcgsim-segmented-control">
        {(
          [
            ['', t({ message: 'Any', context: 'filter' })],
            ['yes', t({ message: 'Yes', context: 'filter' })],
            ['no', t({ message: 'No', context: 'filter' })],
          ] as const
        ).map(([option, optionLabel]) => (
          <span key={option} className="ptcgsim-segmented-control__option">
            <input
              type="radio"
              id={`advanced-${key}-${option || 'any'}`}
              name={`advanced-${key}`}
              checked={filters[key] === option}
              onChange={() => set(key, () => option)}
            />
            <label htmlFor={`advanced-${key}-${option || 'any'}`}>
              {optionLabel}
            </label>
          </span>
        ))}
      </div>
    </div>
  );

  const typeSelect = (key: 'weakness' | 'resistance', label: string) => (
    <label className="advanced-filter">
      <span>{label}</span>
      <select
        className="ds-select"
        value={filters[key]}
        onChange={(event) =>
          set(key, () => event.target.value as SearchFilters[typeof key])
        }
      >
        <option value="">{t({ message: 'Any', context: 'filter' })}</option>
        {key === 'resistance' ? (
          <option value="none">
            {t({ message: 'None', context: 'no Resistance' })}
          </option>
        ) : null}
        {ENERGY_TYPES.filter((type) => type !== 'Colorless').map((type) => (
          <option key={type} value={type}>
            {energyTypeName(type)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      className="card-search__advanced-root"
    >
      <Collapsible.Panel
        ref={panel}
        id={id}
        className="card-search__advanced-panel"
        role="group"
        aria-label={t`More filters`}
      >
        <div className="card-search__advanced">
          <div className="card-search__advanced-grid">
            <div
              className="advanced-filter advanced-filter--pair"
              role="group"
              aria-labelledby={hpId}
            >
              <span id={hpId}>
                <Trans>HP</Trans>
              </span>
              <div className="filter-range">
                <Stepper
                  label={t`Min HP`}
                  placeholder={t`Min`}
                  value={filters.hpMin}
                  step={10}
                  max={400}
                  onChange={(value) => set('hpMin', () => value)}
                />
                <span className="filter-range__to" aria-hidden="true">
                  –
                </span>
                <Stepper
                  label={t`Max HP`}
                  placeholder={t`Max`}
                  value={filters.hpMax}
                  step={10}
                  max={400}
                  onChange={(value) => set('hpMax', () => value)}
                />
              </div>
            </div>
            <div
              className="advanced-filter advanced-filter--pair"
              role="radiogroup"
              aria-label={t`Retreat at most`}
            >
              <span>
                <Trans>Retreat at most</Trans>
              </span>
              <div className="ptcgsim-segmented-control">
                {(['', '0', '1', '2', '3', '4'] as const).map((option) => (
                  <span
                    key={option}
                    className="ptcgsim-segmented-control__option"
                  >
                    <input
                      type="radio"
                      id={`advanced-retreat-${option || 'any'}`}
                      name="advanced-retreat"
                      checked={
                        option === ''
                          ? filters.retreatMax === undefined
                          : filters.retreatMax === Number(option)
                      }
                      onChange={() =>
                        set('retreatMax', () =>
                          option === '' ? undefined : Number(option)
                        )
                      }
                    />
                    <label htmlFor={`advanced-retreat-${option || 'any'}`}>
                      {option === ''
                        ? t({ message: 'Any', context: 'filter' })
                        : option}
                    </label>
                  </span>
                ))}
              </div>
            </div>
            <div
              className="advanced-filter advanced-filter--wide"
              role="group"
              aria-labelledby={costId}
            >
              <span id={costId}>
                <Trans>Attack payable with</Trans>
              </span>
              <div className="filter-cost">
                {COST_TYPES.map((type) => {
                  const count = costOf(type);
                  const name = energyTypeName(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      className="filter-cost__type"
                      aria-label={count > 0 ? t`${name}: ${count}` : name}
                      aria-keyshortcuts="Backspace"
                      data-count={count > 0 ? count : undefined}
                      onClick={() => set('cost', (cost) => [...cost, type])}
                      onKeyDown={(event) => onCostKeyDown(event, type)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        takeOne(type);
                      }}
                    >
                      <EnergySymbol type={type} />
                      {count > 0 ? (
                        <span className="filter-cost__count ds-number">
                          {count}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="ds-icon-button filter-cost__clear"
                  aria-label={t({ message: 'Clear', context: 'attack cost' })}
                  disabled={filters.cost.length === 0}
                  onClick={() => set('cost', () => [])}
                >
                  <XIcon {...decorative} weight="bold" />
                </button>
              </div>
            </div>
            {choices.marks.length > 0 || filters.marks.length > 0 ? (
              <div
                className="advanced-filter advanced-filter--wide"
                role="group"
                aria-label={t`Regulation marks`}
              >
                <span>
                  <Trans>Regulation marks</Trans>
                </span>
                <div className="filter-marks">
                  {[...new Set([...choices.marks, ...filters.marks])]
                    .sort()
                    .map((mark) => (
                      <button
                        key={mark}
                        type="button"
                        className="deck-chip filter-marks__mark"
                        aria-pressed={filters.marks.includes(mark)}
                        onClick={() =>
                          set('marks', (marks) =>
                            marks.includes(mark)
                              ? marks.filter((item) => item !== mark)
                              : [...marks, mark]
                          )
                        }
                      >
                        {mark}
                      </button>
                    ))}
                </div>
              </div>
            ) : null}
            <SearchableList
              label={t({ message: 'Set', context: 'card set' })}
              choices={choices.sets}
              value={filters.sets}
              onChange={(value) => set('sets', () => value)}
            />
            <SearchableList
              label={t`Rarity`}
              choices={choices.rarities}
              value={filters.rarities}
              onChange={(value) => set('rarities', () => value)}
            />
            <div
              className="advanced-filter"
              role="group"
              aria-label={t`Damage at least`}
            >
              <span>
                <Trans>Damage at least</Trans>
              </span>
              <Stepper
                label={t`Damage at least`}
                placeholder="0"
                value={filters.damageMin}
                step={10}
                max={400}
                onChange={(value) => set('damageMin', () => value)}
              />
            </div>
            {typeSelect('weakness', t`Weakness`)}
            {typeSelect('resistance', t`Resistance`)}
            {triState(
              'ability',
              t({ message: 'Ability', context: 'card filter' })
            )}
            {triState('ruleBox', t`Rule Box`)}
            <QueryText
              label={t`Illustrator`}
              value={filters.artist}
              onChange={(value) => set('artist', () => value)}
            />
            <QueryText
              label={t`Evolves from`}
              value={filters.evolvesFrom}
              onChange={(value) => set('evolvesFrom', () => value)}
            />
          </div>
          <div className="card-search__advanced-actions">
            <button
              type="button"
              className="ds-button ds-button--ghost"
              onClick={() => onText(withoutSearchFilters)}
            >
              <Trans context="clear the filters">Reset</Trans>
            </button>
            <button
              type="button"
              className="ds-button ds-button--secondary"
              onClick={onClose}
            >
              <Trans>Done</Trans>
            </button>
          </div>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
};
