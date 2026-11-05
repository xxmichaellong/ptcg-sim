import { useLingui } from '@lingui/react/macro';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import {
  emblemFile,
  emblemPokemonNumber,
  emblemsOf,
  POKEMON_SHEET,
  pokemonNames,
  type EmblemCategory,
} from './card-back-emblems.js';

/** How large a Pokémon's thumbnail is drawn in the picker, in CSS px. */
const THUMB = 44;

/**
 * The sleeve's emblem (ADR-041 §6): every Pokémon (searched by name in the
 * page's language, or by number), the Poké Balls and the Energy types, each
 * the real artwork; or none. A shelf at a time, each a row of radios.
 */
export const EmblemPicker = ({
  name,
  value,
  shelf,
  onShelf,
  onChange,
}: {
  readonly name: string;
  /** The emblem chosen, as it draws (`ball-poke`, never `ball`). */
  readonly value: string;
  readonly shelf: EmblemCategory;
  readonly onShelf: (shelf: EmblemCategory) => void;
  readonly onChange: (emblem: string) => void;
}) => {
  const { t, i18n } = useLingui();
  const ids = useId();
  const [query, setQuery] = useState('');
  const [names, setNames] = useState<readonly string[] | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void pokemonNames(i18n.locale).then(
      (loaded) => {
        if (live) setNames(loaded);
      },
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [i18n.locale]);

  const ballName = (ball: string): string =>
    ({
      poke: t({ message: 'Poké Ball', context: 'item' }),
      great: t({ message: 'Great Ball', context: 'item' }),
      ultra: t({ message: 'Ultra Ball', context: 'item' }),
      master: t({ message: 'Master Ball', context: 'item' }),
      premier: t({ message: 'Premier Ball', context: 'item' }),
      luxury: t({ message: 'Luxury Ball', context: 'item' }),
      dusk: t({ message: 'Dusk Ball', context: 'item' }),
      heal: t({ message: 'Heal Ball', context: 'item' }),
      quick: t({ message: 'Quick Ball', context: 'item' }),
      timer: t({ message: 'Timer Ball', context: 'item' }),
      repeat: t({ message: 'Repeat Ball', context: 'item' }),
      nest: t({ message: 'Nest Ball', context: 'item' }),
      net: t({ message: 'Net Ball', context: 'item' }),
      dive: t({ message: 'Dive Ball', context: 'item' }),
      safari: t({ message: 'Safari Ball', context: 'item' }),
    })[ball] ?? ball;
  const energyName = (energy: string): string =>
    ({
      grass: t({ message: 'Grass', context: 'Pokémon type' }),
      fire: t({ message: 'Fire', context: 'Pokémon type' }),
      water: t({ message: 'Water', context: 'Pokémon type' }),
      lightning: t({ message: 'Lightning', context: 'Pokémon type' }),
      psychic: t({ message: 'Psychic', context: 'Pokémon type' }),
      fighting: t({ message: 'Fighting', context: 'Pokémon type' }),
      darkness: t({ message: 'Darkness', context: 'Pokémon type' }),
      metal: t({ message: 'Metal', context: 'Pokémon type' }),
      fairy: t({ message: 'Fairy', context: 'Pokémon type' }),
      dragon: t({ message: 'Dragon', context: 'Pokémon type' }),
      colorless: t({ message: 'Colorless', context: 'Pokémon type' }),
    })[energy] ?? energy;

  /** An emblem's name, as its radio is read out and shown on hover. */
  const nameOf = (emblem: string): string => {
    const number = emblemPokemonNumber(emblem);
    if (number !== undefined)
      return names?.[number - 1] ?? `#${String(number)}`;
    if (emblem.startsWith('ball-')) return ballName(emblem.slice(5));
    if (emblem.startsWith('energy-')) return energyName(emblem.slice(7));
    return emblem;
  };

  const shown = useMemo(() => {
    const all = emblemsOf(shelf);
    const wanted = query.trim().toLocaleLowerCase();
    if (shelf !== 'pokemon' || !wanted) return all;
    const number = /^#?(\d{1,4})$/u.exec(wanted);
    return all.filter((emblem) => {
      const at = emblemPokemonNumber(emblem)!;
      if (number) return String(at).startsWith(String(Number(number[1])));
      const named = names?.[at - 1];
      return named !== undefined && named.toLocaleLowerCase().includes(wanted);
    });
  }, [names, query, shelf]);

  // The emblem chosen stays in sight as the shelf opens.
  useEffect(() => {
    grid.current
      ?.querySelector<HTMLElement>('input:checked')
      ?.closest('label')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [shelf]);

  const shelves: readonly {
    readonly value: EmblemCategory;
    readonly label: string;
  }[] = [
    {
      value: 'pokemon',
      label: t({ message: 'Pokémon', context: 'sleeve emblems' }),
    },
    {
      value: 'balls',
      label: t({ message: 'Poké Balls', context: 'sleeve emblems' }),
    },
    {
      value: 'energy',
      label: t({ message: 'Energy', context: 'sleeve emblems' }),
    },
  ];

  const thumb = (emblem: string): CSSProperties | undefined => {
    const number = emblemPokemonNumber(emblem);
    if (number === undefined) return undefined;
    const index = number - 1;
    return {
      backgroundImage: `url(${POKEMON_SHEET.url})`,
      backgroundSize: `${String(POKEMON_SHEET.columns * THUMB)}px auto`,
      backgroundPosition: `-${String((index % POKEMON_SHEET.columns) * THUMB)}px -${String(Math.floor(index / POKEMON_SHEET.columns) * THUMB)}px`,
    };
  };

  const choice = (emblem: string, label: string) => (
    <label
      key={emblem}
      className="card-back-emblem"
      title={label}
      data-emblem={emblem}
    >
      <input
        type="radio"
        name={name}
        value={emblem}
        checked={value === emblem}
        aria-label={label}
        onChange={() => onChange(emblem)}
      />
      {emblem === 'none' ? (
        <span className="card-back-emblem__none" aria-hidden="true" />
      ) : emblemPokemonNumber(emblem) !== undefined ? (
        <span
          className="card-back-emblem__thumb"
          style={thumb(emblem)}
          aria-hidden="true"
        />
      ) : (
        <img
          className="card-back-emblem__image"
          src={emblemFile(emblem)}
          alt=""
          loading="lazy"
          draggable={false}
        />
      )}
    </label>
  );

  return (
    <fieldset className="card-back-design__group card-back-emblems">
      <legend className="ptcgsim-form-label">
        {t({ message: 'Emblem', context: 'sleeve' })}
      </legend>
      <div
        className="ptcgsim-segmented-control card-back-emblems__shelves"
        role="radiogroup"
        aria-label={t({ message: 'Emblems', context: 'sleeve' })}
      >
        {shelves.map((each) => (
          <span key={each.value} className="ptcgsim-segmented-control__option">
            <input
              type="radio"
              id={`${ids}-${each.value}`}
              name={`${ids}-shelf`}
              value={each.value}
              checked={shelf === each.value}
              onChange={() => onShelf(each.value)}
            />
            <label htmlFor={`${ids}-${each.value}`}>{each.label}</label>
          </span>
        ))}
      </div>
      {shelf === 'pokemon' ? (
        <label className="card-back-emblems__search">
          <MagnifyingGlassIcon aria-hidden="true" weight="bold" />
          <input
            id="cardBackEmblemSearch"
            type="search"
            className="ptcgsim-ui-field__input"
            placeholder={t`Name or number`}
            aria-label={t`Find a Pokémon`}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      ) : null}
      <div
        ref={grid}
        className="card-back-emblems__grid"
        data-shelf={shelf}
        style={{ ['--emblem-thumb' as string]: `${String(THUMB)}px` }}
      >
        {choice('none', t({ message: 'None', context: 'sleeve emblem' }))}
        {shown.map((emblem) => choice(emblem, nameOf(emblem)))}
        {shown.length === 0 ? (
          <p className="card-back-emblems__empty">{t`No Pokémon by that name`}</p>
        ) : null}
      </div>
    </fieldset>
  );
};
