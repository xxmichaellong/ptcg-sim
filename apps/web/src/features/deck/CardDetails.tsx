import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { StarIcon } from '@phosphor-icons/react/dist/csr/Star';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  catalogCardText,
  countOf,
  findCatalogPrint,
  printsOf,
  type CatalogCard,
  type DeckCard,
  type DeckCardText,
  type DeckList,
  type EnergyType,
  type LoadedCatalog,
} from '@ptcgsim/deck-core';
import {
  resolveCardPresentation,
  sameCardText,
  type CardText,
} from '@ptcgsim/game-core';
import { useEffect, useState } from 'react';

import { readingImageStyle } from '../../ui/card-artwork.js';
import { Sheet } from '../../ui/Sheet.js';
import { Tooltip } from '../../ui/Tooltip.js';
import { CardImage, limitlessScanOf } from './CardImage.js';
import {
  CardTextEditor,
  hasUnnamedMoves,
  isWritableCardText,
  tidyCardText,
} from './CardTextEditor.js';
import { EnergySymbol, RulesText } from './energy-symbol.js';
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
  readonly aboveDialog?: boolean;
  readonly readOnly?: boolean;
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
  /**
   * Gives the deck's entries of the card its own text, or none for its
   * print's again (ADR-043). Without it, the text can't be edited here.
   */
  readonly onEditText?: (
    cardIds: readonly string[],
    text: DeckCardText | undefined
  ) => void;
}

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

/** A Weakness or Resistance: its type's symbol and name, and its amount. */
const Modifier = ({
  type,
  value,
}: {
  readonly type: EnergyType | undefined;
  readonly value: string | undefined;
}) =>
  type ? (
    <>
      <EnergySymbol type={type} />
      {energyTypeName(type)}
      {value ? ` ${value}` : ''}
    </>
  ) : (
    <>—</>
  );

/**
 * What a card says: the catalog's, or the deck's own for it (ADR-043),
 * with the print's set, rarity and the rest when the catalog knows it.
 */
const CardText = ({
  card,
  text,
  category,
  edited,
}: {
  readonly card: CatalogCard | undefined;
  readonly text: DeckCardText;
  readonly category: CatalogCard['category'];
  /** The deck gives it its own text. */
  readonly edited: boolean;
}) => {
  const { t } = useLingui();
  const hp = text.hp;
  const evolvesFrom = text.evolvesFrom;
  const retreat = text.retreat ?? 0;
  const mark = card?.regulationMark;
  const illustrator = card?.illustrator;
  const kind = [
    categoryName(category),
    text.stage ? stageName(text.stage) : undefined,
    card?.trainerType ? trainerTypeName(card.trainerType) : undefined,
    card?.energyType ? energyCardName(card.energyType) : undefined,
    ...(card?.tags ?? []).filter((tag) => tag !== text.stage).map(tagName),
  ].filter(Boolean);
  return (
    <div className="deck-card-details__text">
      <p className="deck-card-details__kind">
        {kind.join(' · ')}
        {hp ? (
          <span className="deck-card-details__hp"> · {t`${hp} HP`}</span>
        ) : null}
        {text.types?.map((type) => (
          <EnergySymbol key={type} type={type} />
        ))}
        {edited ? (
          <span className="deck-card-details__edited">
            <PencilSimpleIcon {...decorative} weight="bold" />
            <Trans comment="A card whose text this deck has changed.">
              Edited
            </Trans>
          </span>
        ) : null}
      </p>
      {evolvesFrom ? (
        <p className="deck-card-details__muted">
          <Trans>Evolves from {evolvesFrom}</Trans>
        </p>
      ) : null}
      {(text.abilities ?? []).map((ability, index) => (
        <div
          key={`${ability.name}-${String(index)}`}
          className="deck-card-details__move"
        >
          <p>
            <span className="deck-card-details__ability">{ability.kind}</span>{' '}
            <strong>{ability.name}</strong>
          </p>
          {ability.text ? (
            <p>
              <RulesText text={ability.text} />
            </p>
          ) : null}
        </div>
      ))}
      {(text.attacks ?? []).map((attack, index) => (
        <div
          key={`${attack.name}-${attack.damage}-${String(index)}`}
          className="deck-card-details__move"
        >
          <p className="deck-card-details__attack">
            <span className="deck-card-details__cost">
              {attack.cost.map((type, at) => (
                <EnergySymbol key={`${type}-${String(at)}`} type={type} />
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
      {text.rules ? (
        <p className="deck-card-details__effect">
          <RulesText text={text.rules} />
        </p>
      ) : null}
      {category === 'Pokémon' &&
      (text.weakness || text.resistance || text.retreat !== undefined) ? (
        <p className="deck-card-details__stats">
          <span>
            {t`Weakness`}{' '}
            <Modifier type={text.weakness} value={text.weaknessValue} />
          </span>
          <span>
            {t`Resistance`}{' '}
            <Modifier type={text.resistance} value={text.resistanceValue} />
          </span>
          <span>
            <Trans>Retreat {retreat}</Trans>
          </span>
        </p>
      ) : null}
      {card ? (
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
      ) : null}
    </div>
  );
};

export const CardDetails = ({
  aboveDialog = false,
  readOnly = false,
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
  onEditText,
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
  // The deck's entries of the card shown: its own (a deck card), or every
  // one of its print (a catalog card in the deck). Its text is theirs.
  const ownIds: readonly string[] =
    inspected?.kind === 'deck'
      ? countOf(deck, inspected.card.id) > 0
        ? [inspected.card.id]
        : []
      : catalogCard
        ? entriesOf(catalogCard.id)
        : [];
  const ownText = deck.find(
    (entry) => ownIds.includes(entry.card.id) && entry.card.text
  )?.card.text;
  const printedText = catalogCard ? catalogCardText(catalogCard) : undefined;
  const category = catalogCard?.category ?? inspected?.card.category;
  // The text being written, while it is: what the card says now to start.
  const [draft, setDraft] = useState<DeckCardText | null>(null);
  const [draftError, setDraftError] = useState('');
  useEffect(() => {
    setDraft(null);
    setDraftError('');
  }, [shownId, inspected?.kind]);
  const saveDraft = (): void => {
    if (!draft || !onEditText) return;
    if (hasUnnamedMoves(draft)) {
      setDraftError(t`Name every Ability and attack.`);
      return;
    }
    const tidy = tidyCardText(draft);
    if (!isWritableCardText(tidy)) {
      setDraftError(t`Some of it is too long.`);
      return;
    }
    // Written back to the print's own text: the print's it is again.
    const same =
      tidy !== undefined &&
      printedText !== undefined &&
      sameCardText(tidy as CardText, tidyCardText(printedText) as CardText);
    onEditText(ownIds, same ? undefined : tidy);
    setDraft(null);
    setDraftError('');
  };
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
      aboveDialog={aboveDialog}
      open={inspected !== undefined}
      onOpenChange={(open) => {
        if (open) return;
        // Esc (or a press beside it) while its text is being written puts
        // the writing away first; the card stays open.
        if (draft) {
          setDraft(null);
          setDraftError('');
          return;
        }
        onClose();
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
                {!readOnly ? (
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
                ) : null}
                <span
                  className="deck-row__count ds-number"
                  aria-label={t`${count} in deck`}
                >
                  {count}
                </span>
                {!readOnly ? (
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
                ) : null}
              </span>
              <span className="deck-card-details__in-deck">
                <Trans comment="After the number of copies in the deck">
                  in deck
                </Trans>
              </span>
              {!readOnly && count > 0 && shownId ? (
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
              {onEditText && ownIds.length > 0 && category && !draft ? (
                <button
                  type="button"
                  className="ds-button ds-button--ghost"
                  data-card-text-edit=""
                  onClick={() => setDraft(ownText ?? printedText ?? {})}
                >
                  <PencilSimpleIcon {...decorative} weight="bold" />
                  {ownText || printedText ? (
                    <Trans comment="Opens a form to change what a card in the deck says.">
                      Edit text
                    </Trans>
                  ) : (
                    <Trans comment="Opens a form to write what a hand-made card says.">
                      Add text
                    </Trans>
                  )}
                </button>
              ) : null}
            </div>
            {draft && category ? (
              <form
                className="deck-card-details__editor"
                // The form bounds what is written itself; the browser's
                // checks (an HP not a step of 10) would only hold it up.
                noValidate
                aria-label={t({
                  message: `${name}'s text`,
                  comment:
                    "The form a card's text is written in. {name} is the card.",
                })}
                onSubmit={(event) => {
                  event.preventDefault();
                  saveDraft();
                }}
              >
                <CardTextEditor
                  category={category}
                  value={draft}
                  onChange={(next) => {
                    setDraft(next);
                    setDraftError('');
                  }}
                />
                <p className="deck-card-details__editor-error" role="alert">
                  {draftError}
                </p>
                <div className="deck-card-details__editor-actions">
                  {printedText && ownText ? (
                    <button
                      type="button"
                      className="ds-button ds-button--ghost"
                      onClick={() => {
                        onEditText?.(ownIds, undefined);
                        setDraft(null);
                      }}
                    >
                      <ArrowCounterClockwiseIcon
                        {...decorative}
                        weight="bold"
                      />
                      <Trans comment="Puts back a card's text as its print has it.">
                        Use the printed text
                      </Trans>
                    </button>
                  ) : null}
                  <span className="deck-card-details__editor-spacer" />
                  <button
                    type="button"
                    className="ds-button ds-button--secondary"
                    onClick={() => {
                      setDraft(null);
                      setDraftError('');
                    }}
                  >
                    <Trans>Cancel</Trans>
                  </button>
                  <button
                    type="submit"
                    className="ds-button ds-button--primary"
                  >
                    <Trans context="save a card's text">Save</Trans>
                  </button>
                </div>
              </form>
            ) : (
              <>
                {catalogCard ? (
                  <Legality card={catalogCard} />
                ) : (
                  <p className="deck-card-details__muted">
                    <Trans>Added by hand · legality not checked</Trans>
                  </p>
                )}
                {category && (ownText ?? printedText) ? (
                  <CardText
                    card={catalogCard}
                    text={(ownText ?? printedText)!}
                    category={category}
                    edited={ownText !== undefined && printedText !== undefined}
                  />
                ) : null}
              </>
            )}
            {prints.length > 1 && !draft ? (
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
                {!readOnly &&
                deckPrint &&
                catalogCard &&
                deckPrint.id !== catalogCard.id ? (
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
