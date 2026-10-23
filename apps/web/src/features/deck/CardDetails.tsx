import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { StarIcon } from '@phosphor-icons/react/dist/csr/Star';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
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
import {
  categoryName,
  energyCardName,
  energyTypeName,
  formatName,
  stageName,
  tagName,
  trainerTypeName,
} from './deck-labels.js';

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

const Legality = ({ card }: { readonly card: CatalogCard }) => {
  const { t } = useLingui();
  return (
    <ul className="deck-card-details__legality" aria-label={t`Legality`}>
      {(
        [
          ['standard', card.legal.standard],
          ['expanded', card.legal.expanded],
          ['unlimited', !card.set.pocket],
        ] as const
      ).map(([format, legal]) => (
        <li key={format} data-legal={legal ? 'true' : 'false'}>
          {legal ? (
            <CheckIcon {...decorative} weight="bold" />
          ) : (
            <XIcon {...decorative} weight="bold" />
          )}
          {formatName(format)}
        </li>
      ))}
    </ul>
  );
};

const CardText = ({ card }: { readonly card: CatalogCard }) => {
  const { t } = useLingui();
  const hp = card.hp;
  const evolvesFrom = card.evolvesFrom;
  const weakness = card.weakness ? energyTypeName(card.weakness) : '—';
  const resistance = card.resistance ? energyTypeName(card.resistance) : '—';
  const retreat = card.retreat ?? 0;
  const mark = card.regulationMark;
  const illustrator = card.illustrator;
  return (
    <div className="deck-card-details__text">
      <p className="deck-card-details__kind">
        {[
          categoryName(card.category),
          card.stage ? stageName(card.stage) : undefined,
          card.trainerType ? trainerTypeName(card.trainerType) : undefined,
          card.energyType ? energyCardName(card.energyType) : undefined,
          ...card.tags.filter((tag) => tag !== card.stage).map(tagName),
        ]
          .filter(Boolean)
          .join(' · ')}
        {hp ? (
          <span className="deck-card-details__hp"> · {t`${hp} HP`}</span>
        ) : null}
      </p>
      {evolvesFrom ? (
        <p className="deck-card-details__muted">
          <Trans>Evolves from {evolvesFrom}</Trans>
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
          <span>
            <Trans>Weakness {weakness}</Trans>
          </span>
          <span>
            <Trans>Resistance {resistance}</Trans>
          </span>
          <span>
            <Trans>Retreat {retreat}</Trans>
          </span>
        </p>
      ) : null}
      <p className="deck-card-details__muted">
        {card.set.name} · {card.set.code ?? card.set.id} {card.number}
        {card.rarity ? ` · ${card.rarity}` : ''}
        {mark
          ? ` · ${t({ message: `Mark ${mark}`, comment: "A card's regulation mark" })}`
          : ''}
        {illustrator
          ? ` · ${t({ message: `Illus. ${illustrator}`, comment: "The card's illustrator, abbreviated" })}`
          : ''}
      </p>
    </div>
  );
};

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
  const { t } = useLingui();
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
  const deckCopies = deckPrint ? copiesOf(deckPrint.id) : 0;
  const printCount = prints.length;
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
                <Tooltip content={t`Remove one`}>
                  <button
                    type="button"
                    className="deck-row__step"
                    aria-label={t`Remove one ${name}`}
                    disabled={count === 0}
                    onClick={() => onRemove(target)}
                  >
                    <MinusIcon {...decorative} weight="bold" />
                  </button>
                </Tooltip>
                <span
                  className="deck-row__count ds-number"
                  aria-label={t`${count} in deck`}
                >
                  {count}
                </span>
                <Tooltip content={t`Add one`}>
                  <button
                    type="button"
                    className="deck-row__step"
                    aria-label={t`Add one ${name}`}
                    onClick={() => onAdd(target)}
                  >
                    <PlusIcon {...decorative} weight="bold" />
                  </button>
                </Tooltip>
              </span>
              <span className="deck-card-details__in-deck">
                <Trans comment="After the number of copies in the deck">
                  in deck
                </Trans>
              </span>
              {count > 0 && shownId ? (
                <Tooltip content={t`Show this card on the deck`}>
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
                    {coverId === shownId ? t`Deck cover` : t`Make cover`}
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
                <Trans>Added by hand · legality not checked</Trans>
              </p>
            )}
            {prints.length > 1 ? (
              <div className="deck-card-details__prints">
                <h3>
                  {deckPrint && catalogCard && deckPrint.id !== catalogCard.id
                    ? t`${plural(printCount, { one: '# print · the deck has another one', other: '# prints · the deck has another one' })}`
                    : t`${plural(printCount, { one: '# print', other: '# prints' })}`}
                </h3>
                <ul>
                  {prints.map((print) => {
                    const inDeck = copiesOf(print.id);
                    const printName = `${print.set.name} ${print.number}`;
                    return (
                      <li key={print.id}>
                        <Tooltip
                          content={`${printName}${print.rarity ? ` · ${print.rarity}` : ''}`}
                        >
                          <button
                            type="button"
                            className="deck-card-details__print"
                            aria-pressed={print.id === catalogCard?.id}
                            aria-label={
                              inDeck > 0
                                ? t`${printName}, ${inDeck} in deck`
                                : printName
                            }
                            onClick={() => onShow(print)}
                          >
                            <CardImage
                              src={print.imageSmall}
                              fallback={limitlessScanOf(
                                {
                                  name: print.name,
                                  image: print.imageSmall,
                                  set: print.set.code,
                                  number: print.number,
                                },
                                'small'
                              )}
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
                    {t`Use this print for the ${deckCopies} in the deck`}
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
