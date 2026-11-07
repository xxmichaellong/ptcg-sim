import { energyTypeName } from '../features/deck/deck-labels.js';
import './energy.css';

/** The eleven types an Energy symbol can be (deck-core's `EnergyType`). */
export type EnergySymbolType =
  | 'Grass'
  | 'Fire'
  | 'Water'
  | 'Lightning'
  | 'Psychic'
  | 'Fighting'
  | 'Darkness'
  | 'Metal'
  | 'Fairy'
  | 'Dragon'
  | 'Colorless';

/** Each type's letter, as card text writes it ({R} is Fire). */
export const ENERGY_SYMBOL_LETTER: Readonly<Record<EnergySymbolType, string>> =
  {
    Grass: 'G',
    Fire: 'R',
    Water: 'W',
    Lightning: 'L',
    Psychic: 'P',
    Fighting: 'F',
    Darkness: 'D',
    Metal: 'M',
    Fairy: 'Y',
    Dragon: 'N',
    Colorless: 'C',
  };

const TYPE_OF_LETTER: ReadonlyMap<string, EnergySymbolType> = new Map(
  (Object.entries(ENERGY_SYMBOL_LETTER) as [EnergySymbolType, string][]).map(
    ([type, letter]) => [letter, type]
  )
);

/** Where each type sits in the symbols' sprite (energy.css). */
const SPRITE_INDEX: Readonly<Record<EnergySymbolType, number>> = {
  Grass: 0,
  Fire: 1,
  Water: 2,
  Lightning: 3,
  Psychic: 4,
  Fighting: 5,
  Darkness: 6,
  Metal: 7,
  Fairy: 8,
  Dragon: 9,
  Colorless: 10,
};

/**
 * An Energy symbol, as the cards print it. Silent where what is beside it
 * names the type (a cost's own words say it); `named` says the type itself.
 */
export const EnergySymbol = ({
  type,
  size,
  named = false,
}: {
  readonly type: EnergySymbolType;
  /** Its diameter in pixels; 18 unless said. */
  readonly size?: number;
  readonly named?: boolean;
}) => (
  <span
    className="energy-symbol"
    data-type={type}
    {...(named
      ? { role: 'img', 'aria-label': energyTypeName(type) }
      : { 'aria-hidden': true })}
    style={{
      ['--energy-index' as string]: SPRITE_INDEX[type],
      ...(size ? { ['--energy-size' as string]: `${String(size)}px` } : {}),
    }}
  />
);

/** Rules text with its {R}-style Energy symbols drawn, and read, as types. */
export const RulesText = ({
  text,
  size,
}: {
  readonly text: string;
  readonly size?: number;
}) => (
  <>
    {text.split(/(\{[GRWLPFDMYNC]\})/u).map((part, index) => {
      const type = /^\{([GRWLPFDMYNC])\}$/u.exec(part)?.[1];
      const symbol = type ? TYPE_OF_LETTER.get(type) : undefined;
      return symbol ? (
        <EnergySymbol
          key={index}
          type={symbol}
          named
          {...(size ? { size } : {})}
        />
      ) : (
        <span key={index}>{part}</span>
      );
    })}
  </>
);
