import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { checkDeck, deckTotals, type DeckCard } from '@ptcgsim/deck-core';
import { useMemo, useState } from 'react';
import { CardImage, limitlessScanOf } from './CardImage.js';
import {
  CardDetails,
  cardDetailsFacts,
  type InspectedCard,
} from './CardDetails.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import type { DeckImportLine } from './deck-import.js';
import type { DeckDraft } from './deck-library.js';
import { categoryName, formatName } from './deck-labels.js';
import { SEAT_NAMES } from './deck-screen-shared.js';
import type { DeckBuilderTarget } from './deck-builder-store.js';
import { useCardCatalog } from './useCardCatalog.js';

/** A complete deck, with the same card inspector, without changing a seat. */
export const DeckQuickView = ({
  deck,
  missing = [],
  catalog,
  target,
  onAnswer,
}: {
  readonly deck: DeckDraft;
  readonly missing?: readonly DeckImportLine[];
  readonly catalog: CardCatalogSource;
  readonly target: DeckBuilderTarget;
  readonly onAnswer: (answer: string | null) => void;
}) => {
  const { t } = useLingui();
  const state = useCardCatalog(catalog);
  const [inspected, setInspected] = useState<InspectedCard>();
  const facts = useMemo(
    () =>
      cardDetailsFacts(
        state.status === 'ready' ? state.catalog : undefined,
        inspected,
        deck.cards
      ),
    [state, inspected, deck.cards]
  );
  const missingLines = missing.length;
  const total = deckTotals(deck.cards).total;
  const check = checkDeck(deck.cards, deck.format);
  const seat = SEAT_NAMES[target];
  const inspect = (card: DeckCard): void =>
    setInspected({ kind: 'deck', card });
  return (
    <div className="deck-quick-view">
      <p className="deck-quick-view__summary ds-number">
        {formatName(deck.format)} · {total}/{check.format.deckSize}
      </p>
      <div className="deck-quick-view__list">
        {missingLines > 0 ? (
          <div className="deck-missing" role="status">
            <strong>{t`${plural(missingLines, { one: '# line not found', other: '# lines not found' })}`}</strong>
            <ul>
              {missing.map((line, index) => (
                <li key={`${line.name}-${index}`}>
                  <span className="ds-number">{line.quantity}</span> {line.name}
                  {line.print ? (
                    <span className="deck-missing__print"> {line.print}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {(['Pokémon', 'Trainer', 'Energy', 'Unknown'] as const).map(
          (category) => {
            const entries = deck.cards.filter(
              ({ card }) => card.category === category
            );
            if (entries.length === 0) return null;
            const count = entries.reduce((sum, entry) => sum + entry.count, 0);
            return (
              <section key={category}>
                <h3>
                  {category === 'Unknown'
                    ? t`Other cards`
                    : categoryName(category)}{' '}
                  <span className="ds-number">{count}</span>
                </h3>
                <ul className="deck-quick-view__grid">
                  {entries.map(({ card, count }) => (
                    <li key={card.id}>
                      <button
                        type="button"
                        onClick={() => inspect(card)}
                        aria-label={t`${card.name}, ${count} in deck`}
                      >
                        <CardImage
                          src={card.imageSmall ?? card.image}
                          fallback={limitlessScanOf(card, 'small')}
                          alt={card.name}
                          loading="lazy"
                        />
                        <span className="deck-quick-view__count ds-number">
                          {count}
                        </span>
                        <span className="deck-quick-view__name">
                          {card.name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          }
        )}
      </div>
      <div className="ptcgsim-ui-dialog__actions">
        <button
          type="button"
          className="ds-button ds-button--secondary"
          onClick={() => onAnswer(null)}
        >{t`Close`}</button>
        <button
          type="button"
          className="ds-button ds-button--secondary"
          onClick={() => onAnswer('edit')}
        >{t`Edit deck`}</button>
        <button
          type="button"
          className="ds-button ds-button--primary"
          disabled={total === 0}
          onClick={() => onAnswer('use')}
        >{t`Use on ${seat}`}</button>
      </div>
      <CardDetails
        aboveDialog
        inspected={inspected}
        facts={facts}
        deck={deck.cards}
        coverId={deck.coverId}
        readOnly
        onClose={() => setInspected(undefined)}
        onShow={(card) => setInspected({ kind: 'catalog', card })}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onSwapPrint={() => undefined}
        onSetCover={() => undefined}
      />
    </div>
  );
};
