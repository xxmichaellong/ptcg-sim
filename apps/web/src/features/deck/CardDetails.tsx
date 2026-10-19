import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { StarIcon } from '@phosphor-icons/react/dist/csr/Star';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import {
  countOf,
  findCatalogPrint,
  printsOf,
  type CatalogCard,
  type DeckCard,
  type DeckList,
  type EnergyType,
  type LoadedCatalog,
} from '@ptcgsim/deck-core';
import { resolveCardPresentation } from '@ptcgsim/game-core';

import { readingImageStyle } from '../../ui/card-artwork.js';
import { Sheet } from '../../ui/Sheet.js';
import { Tooltip } from '../../ui/Tooltip.js';
import { CardImage, limitlessScanOf } from './CardImage.js';
import { EnergySymbol } from './CardSearchPanel.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

/** What the inspector shows: a catalogued printing, or a deck's own card. */
export type InspectedCard =
  | { readonly kind: 'catalog'; readonly card: CatalogCard }
  | { readonly kind: 'deck'; readonly card: DeckCard };

/** The catalog's view of the card shown: its printing and every print. */
export interface CardDetailsFacts {
  readonly card: CatalogCard;
  readonly prints: readonly CatalogCard[];
  /**
   * The deck's entries that are each print, by the print's id: its own,
   * or a file's scan kept under its own id (an English and a German one
   * are two entries of one print).
   */
  readonly inDeck: ReadonlyMap<string, readonly string[]>;
}

/**
 * The printing a deck card kept under its own id (a file's scan) is, by
 * its set and number, unless it was made or typed by hand.
 */
const printOfOwnCard = (
  catalog: LoadedCatalog,
  card: DeckCard
): CatalogCard | undefined => {
  if (card.presentation !== undefined) return undefined;
  const print = findCatalogPrint(catalog, card);
  return print?.category === card.category ? print : undefined;
};

/** What the catalog says about an inspected card, if it knows it. */
export const cardDetailsFacts = (
  catalog: LoadedCatalog | undefined,
  inspected: InspectedCard | undefined,
  deck: DeckList = []
): CardDetailsFacts | undefined => {
  if (!catalog || !inspected) return undefined;
  const card =
    inspected.kind === 'catalog'
      ? inspected.card
      : (catalog.byId.get(inspected.card.id) ??
        printOfOwnCard(catalog, inspected.card));
  if (!card) return undefined;
  const prints = printsOf(catalog.cards, card.printGroup);
  const inDeck = new Map<string, string[]>();
  for (const { card: entry } of deck) {
    const print = catalog.byId.get(entry.id) ?? printOfOwnCard(catalog, entry);
    if (!print || !prints.some((candidate) => candidate.id === print.id))
      continue;
    inDeck.set(print.id, [...(inDeck.get(print.id) ?? []), entry.id]);
  }
  return { card, prints, inDeck };
};

export interface CardDetailsProps {
  readonly inspected: InspectedCard | undefined;
  /** From `cardDetailsFacts` (the catalog itself is never a prop). */
  readonly facts: CardDetailsFacts | undefined;
  readonly deck: DeckList;
  readonly coverId: string | undefined;
  readonly onClose: () => void;
  readonly onShow: (card: CatalogCard) => void;
  readonly onAdd: (card: CatalogCard | DeckCard) => void;
  readonly onRemove: (card: CatalogCard | DeckCard) => void;
  /** Swaps the deck's copies of one printing (its entries) for another. */
  readonly onSwapPrint: (fromIds: readonly string[], to: CatalogCard) => void;
  readonly onSetCover: (cardId: string) => void;
}

const SYMBOL_TYPES: Readonly<Record<string, EnergyType>> = {
  G: 'Grass',
  R: 'Fire',
  W: 'Water',
  L: 'Lightning',
  P: 'Psychic',
  F: 'Fighting',
  D: 'Darkness',
  M: 'Metal',
  Y: 'Fairy',
  N: 'Dragon',
  C: 'Colorless',
};

/** Rules text with its {R}-style Energy symbols drawn as symbols. */
const RulesText = ({ text }: { readonly text: string }) => (
  <>
    {text.split(/(\{[GRWLPFDMYNC]\})/u).map((part, index) => {
      const type = /^\{([GRWLPFDMYNC])\}$/u.exec(part)?.[1];
      return type ? (
        <EnergySymbol key={index} type={SYMBOL_TYPES[type]!} />
      ) : (
        <span key={index}>{part}</span>
      );
    })}
  </>
);

const Legality = ({ card }: { readonly card: CatalogCard }) => (
  <ul className="deck-card-details__legality" aria-label="Legality">
    {(
      [
        ['Standard', card.legal.standard],
        ['Expanded', card.legal.expanded],
        ['Unlimited', !card.set.pocket],
      ] as const
    ).map(([format, legal]) => (
      <li key={format} data-legal={legal ? 'true' : 'false'}>
        {legal ? (
          <CheckIcon {...decorative} weight="bold" />
        ) : (
          <XIcon {...decorative} weight="bold" />
        )}
        {format}
      </li>
    ))}
  </ul>
);

const CardText = ({ card }: { readonly card: CatalogCard }) => (
  <div className="deck-card-details__text">
    <p className="deck-card-details__kind">
      {[
        card.category,
        card.stage,
        card.trainerType,
        card.energyType ? `${card.energyType} Energy` : undefined,
        ...card.tags.filter((tag) => tag !== card.stage),
      ]
        .filter(Boolean)
        .join(' · ')}
      {card.hp ? (
        <span className="deck-card-details__hp"> · {card.hp} HP</span>
      ) : null}
    </p>
    {card.evolvesFrom ? (
      <p className="deck-card-details__muted">
        Evolves from {card.evolvesFrom}
      </p>
    ) : null}
    {card.abilities.map((ability) => (
      <div key={ability.name} className="deck-card-details__move">
        <p>
          <span className="deck-card-details__ability">{ability.kind}</span>{' '}
          <strong>{ability.name}</strong>
        </p>
        <p>
          <RulesText text={ability.text} />
        </p>
      </div>
    ))}
    {card.attacks.map((attack) => (
      <div
        key={`${attack.name}-${attack.damage}`}
        className="deck-card-details__move"
      >
        <p className="deck-card-details__attack">
          <span className="deck-card-details__cost">
            {attack.cost.map((type, index) => (
              <EnergySymbol key={`${type}-${index}`} type={type} />
            ))}
          </span>
          <strong>{attack.name}</strong>
          {attack.damage ? (
            <span className="deck-card-details__damage ds-number">
              {attack.damage}
            </span>
          ) : null}
        </p>
        {attack.text ? (
          <p>
            <RulesText text={attack.text} />
          </p>
        ) : null}
      </div>
    ))}
    {card.text ? (
      <p className="deck-card-details__effect">
        <RulesText text={card.text} />
      </p>
    ) : null}
    {card.category === 'Pokémon' ? (
      <p className="deck-card-details__stats">
        <span>Weakness {card.weakness ?? '—'}</span>
        <span>Resistance {card.resistance ?? '—'}</span>
        <span>Retreat {card.retreat ?? 0}</span>
      </p>
    ) : null}
    <p className="deck-card-details__muted">
      {card.set.name} · {card.set.code ?? card.set.id} {card.number}
      {card.rarity ? ` · ${card.rarity}` : ''}
      {card.regulationMark ? ` · Mark ${card.regulationMark}` : ''}
      {card.illustrator ? ` · Illus. ${card.illustrator}` : ''}
    </p>
  </div>
);

export const CardDetails = ({
  inspected,
  facts,
  deck,
  coverId,
  onClose,
  onShow,
  onAdd,
  onRemove,
  onSwapPrint,
  onSetCover,
}: CardDetailsProps) => {
  const catalogCard = facts?.card;
  // The count, Add, Remove and cover are the inspected entry's own: two
  // scans of one printing (an English and a German) are separate entries
  // in a deck, sharing the catalog's facts.
  const target: CatalogCard | DeckCard | undefined =
    inspected?.kind === 'deck'
      ? inspected.card
      : (catalogCard ?? inspected?.card);
  const shownId = target?.id;
  const prints = facts?.prints ?? [];
  const count = shownId ? countOf(deck, shownId) : 0;
  const entriesOf = (printId: string): readonly string[] =>
    facts?.inDeck.get(printId) ?? [];
  const copiesOf = (printId: string): number =>
    entriesOf(printId).reduce((total, id) => total + countOf(deck, id), 0);
  const deckPrint = prints.find((print) => copiesOf(print.id) > 0);
  // A deck's card shows its own scan (a German one stays German); the
  // catalog's facts describe it.
  const image =
    inspected?.kind === 'deck'
      ? inspected.card.image
      : (catalogCard?.image ?? inspected?.card.image ?? '');
  const name = inspected?.card.name ?? '';
  const turns =
    resolveCardPresentation({
      name,
      imageUrl: image,
      presentation: (inspected?.kind === 'deck'
        ? inspected.card.presentation
        : undefined) as never,
    })?.readingQuarterTurns ?? 0;

  return (
    <Sheet
      open={inspected !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={name}
      size="lg"
      id="nativeDeckBuilderCardPreviewScrim"
      className="deck-card-details"
    >
      {inspected && target ? (
        <div className="deck-card-details__body">
          <div
            className="deck-card-details__image"
            data-landscape={turns % 2 === 1 ? 'true' : undefined}
          >
            <CardImage
              id="nativeDeckBuilderCardPreviewImage"
              src={image}
              fallback={
                inspected.kind === 'deck'
                  ? limitlessScanOf({ ...inspected.card, image })
                  : catalogCard
                    ? limitlessScanOf({
                        name,
                        image,
                        set: catalogCard.set.code,
                        number: catalogCard.number,
                      })
                    : undefined
              }
              alt={name}
              style={readingImageStyle(turns)}
            />
          </div>
          <div className="deck-card-details__side">
            <div className="deck-card-details__actions">
              <span className="deck-row__stepper deck-card-details__stepper">
                <Tooltip content="Remove one">
                  <button
                    type="button"
                    className="deck-row__step"
                    aria-label={`Remove one ${name}`}
                    disabled={count === 0}
                    onClick={() => onRemove(target)}
                  >
                    <MinusIcon {...decorative} weight="bold" />
                  </button>
                </Tooltip>
                <span
                  className="deck-row__count ds-number"
                  aria-label={`${count} in deck`}
                >
                  {count}
                </span>
                <Tooltip content="Add one">
                  <button
                    type="button"
                    className="deck-row__step"
                    aria-label={`Add one ${name}`}
                    onClick={() => onAdd(target)}
                  >
                    <PlusIcon {...decorative} weight="bold" />
                  </button>
                </Tooltip>
              </span>
              <span className="deck-card-details__in-deck">in deck</span>
              {count > 0 && shownId ? (
                <Tooltip content="Picture the deck with this card">
                  <button
                    type="button"
                    className="ds-button ds-button--ghost"
                    aria-pressed={coverId === shownId}
                    onClick={() => onSetCover(shownId)}
                  >
                    <StarIcon
                      {...decorative}
                      weight={coverId === shownId ? 'fill' : 'bold'}
                    />
                    {coverId === shownId ? 'Deck cover' : 'Make cover'}
                  </button>
                </Tooltip>
              ) : null}
            </div>
            {catalogCard ? (
              <>
                <Legality card={catalogCard} />
                <CardText card={catalogCard} />
              </>
            ) : (
              <p className="deck-card-details__muted">
                Added by hand: the catalog doesn&apos;t know this card, so its
                legality isn&apos;t checked.
              </p>
            )}
            {prints.length > 1 ? (
              <div className="deck-card-details__prints">
                <h3>
                  {prints.length} prints
                  {deckPrint && catalogCard && deckPrint.id !== catalogCard.id
                    ? ' · the deck has another one'
                    : ''}
                </h3>
                <ul>
                  {prints.map((print) => {
                    const inDeck = copiesOf(print.id);
                    return (
                      <li key={print.id}>
                        <Tooltip
                          content={`${print.set.name} ${print.number}${print.rarity ? ` · ${print.rarity}` : ''}`}
                        >
                          <button
                            type="button"
                            className="deck-card-details__print"
                            aria-pressed={print.id === catalogCard?.id}
                            aria-label={`${print.set.name} ${print.number}${inDeck > 0 ? `, ${inDeck} in deck` : ''}`}
                            onClick={() => onShow(print)}
                          >
                            <CardImage
                              src={print.imageSmall}
                              fallback={limitlessScanOf({
                                name: print.name,
                                image: print.imageSmall,
                                set: print.set.code,
                                number: print.number,
                              })}
                              alt=""
                              loading="lazy"
                            />
                            {inDeck > 0 ? (
                              <span className="deck-row__badge ds-number">
                                {inDeck}
                              </span>
                            ) : null}
                          </button>
                        </Tooltip>
                      </li>
                    );
                  })}
                </ul>
                {deckPrint && catalogCard && deckPrint.id !== catalogCard.id ? (
                  <button
                    type="button"
                    className="ds-button ds-button--secondary"
                    onClick={() =>
                      onSwapPrint(entriesOf(deckPrint.id), catalogCard)
                    }
                  >
                    Use this print for the {copiesOf(deckPrint.id)} in the deck
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
};
