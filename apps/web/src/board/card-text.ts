import {
  catalogCardText,
  findCatalogPrint,
  splitPrint,
} from '@ptcgsim/deck-core';
import type { CardText, ViewCardDefinition } from '@ptcgsim/game-core';
import { useEffect, useState, useSyncExternalStore } from 'react';

import type {
  CardCatalogSource,
  CardCatalogState,
} from '../features/deck/card-catalog-contract.js';
import {
  loadedTableCardCatalog,
  tableCardCatalog,
} from '../features/deck/LazyDeckBuilderSession.js';

/**
 * What the table knows a card says (ADR-043): the deck's own text for it,
 * else its print's from the catalog. `pending` while the catalog that may
 * know it is on its way; `none` once nothing does.
 */
export type ResolvedCardText =
  | { readonly status: 'own'; readonly text: CardText }
  | { readonly status: 'catalog'; readonly text: CardText }
  | { readonly status: 'pending' }
  | { readonly status: 'none' };

type DefinitionFacts = Pick<
  ViewCardDefinition,
  'name' | 'imageUrl' | 'print' | 'text'
>;

/**
 * A card's text: its own, else the catalog's print of it -- by its print
 * id, else (a room from before prints were kept) by its picture's address
 * -- when the print goes by the card's name.
 */
export const resolveCardText = (
  definition: DefinitionFacts | undefined,
  catalog: CardCatalogState
): ResolvedCardText => {
  if (!definition) return { status: 'none' };
  if (definition.text) return { status: 'own', text: definition.text };
  if (catalog.status !== 'ready') {
    return catalog.status === 'failed'
      ? { status: 'none' }
      : { status: 'pending' };
  }
  const print = definition.print ? splitPrint(definition.print) : undefined;
  const found = findCatalogPrint(catalog.catalog, {
    name: definition.name,
    image: definition.imageUrl,
    ...(print ? { set: print.set, number: print.number } : {}),
  });
  return found
    ? { status: 'catalog', text: catalogCardText(found) as CardText }
    : { status: 'none' };
};

const IDLE: CardCatalogState = { status: 'idle' };
const LOADING: CardCatalogState = { status: 'loading' };
const FAILED: CardCatalogState = { status: 'failed' };
const noSubscription = (): (() => void) => () => undefined;

/**
 * The catalog for the table, asked for only while `wanted`: it comes with
 * the deck screen's script, fetched as safely as the warm-up fetches it.
 * Loading until it is here; failed if it can't come.
 */
export const useTableCardCatalog = (wanted: boolean): CardCatalogState => {
  const [source, setSource] = useState<CardCatalogSource | undefined>(
    loadedTableCardCatalog
  );
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    if (!wanted || source) return;
    let live = true;
    void tableCardCatalog().then((found) => {
      if (!live) return;
      if (found) setSource(found);
      else setUnreachable(true);
    });
    return () => {
      live = false;
    };
  }, [wanted, source]);
  const state = useSyncExternalStore(
    source?.subscribe ?? noSubscription,
    source?.getSnapshot ?? (() => IDLE),
    source?.getSnapshot ?? (() => IDLE)
  );
  useEffect(() => {
    if (wanted) source?.load();
  }, [source, wanted]);
  if (!wanted) return state;
  if (!source) return unreachable ? FAILED : LOADING;
  return state.status === 'idle' ? LOADING : state;
};
