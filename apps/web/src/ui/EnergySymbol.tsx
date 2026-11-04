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

/** An Energy symbol: the type's letter on its colour; read by its type. */
export const EnergySymbol = ({
  type,
  size,
}: {
  readonly type: EnergySymbolType;
  /** Its diameter in pixels; 18 unless said. */
  readonly size?: number;
}) => (
  <span
    className="energy-symbol"
    data-type={type}
    aria-hidden="true"
    style={size ? { ['--energy-size' as string]: `${size}px` } : undefined}
  >
    {ENERGY_SYMBOL_LETTER[type]}
  </span>
);

/** Rules text with its {R}-style Energy symbols drawn as symbols. */
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
        <EnergySymbol key={index} type={symbol} {...(size ? { size } : {})} />
      ) : (
        <span key={index}>{part}</span>
      );
    })}
  </>
);
