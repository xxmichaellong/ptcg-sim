import type { MatchViewState, ViewCard } from '@ptcgsim/game-core';

import { tutorialCardKeyOf, type TutorialCardKey } from './tutorial-cards.js';

/**
 * What a lesson step reads (ADR-038): the table as the room last published
 * it, the table when the step began, the log lines since, and what is open
 * on screen. A step is done when what it asked for is true, however it was
 * done -- a drag, the card's menu, a key or the palette.
 */

export type InputMode = 'mouse' | 'touch';

/** What is open on screen, read from the page. */
export interface TutorialScreen {
  /** The card or stack being read in the large preview, if any. */
  readonly preview: boolean;
  /** The card whose actions menu is open (its table id), if any. */
  readonly cardMenu: string | null;
  /** The damage or condition controls, if open. */
  readonly markerControls: 'damage' | 'specialCondition' | null;
  /** The pile open in its viewer (deck, discard...), if any. */
  readonly pile: string | null;
  readonly palette: boolean;
  readonly deckScreen: boolean;
  /** A sheet or dialog (Settings, Play online, the keys) over the table. */
  readonly sheet: boolean;
}

export interface TutorialWorld {
  readonly view: MatchViewState;
  /** The table as it was when the step began. */
  readonly start: MatchViewState;
  readonly you: string;
  readonly them: string;
  readonly mode: InputMode;
  /** The log's events since the step began, oldest first. */
  readonly events: readonly {
    readonly type: string;
    readonly playerId?: string;
  }[];
  /** The table turned round: the other seat at the bottom. */
  readonly flipped: boolean;
  readonly screen: TutorialScreen;
}

export const zoneId = (playerId: string, kind: string): string =>
  `zone:${playerId}:${kind}`;

export const zoneCards = (
  view: MatchViewState,
  playerId: string,
  kind: string
): readonly ViewCard[] => view.zones[zoneId(playerId, kind)]?.cards ?? [];

/** The seat's Active Pokémon, if it has one. */
export const activeStack = (view: MatchViewState, playerId: string) => {
  const id = view.boards[playerId]?.activeStackId;
  return id ? view.stacks[id] : undefined;
};

export const benchStacks = (view: MatchViewState, playerId: string) =>
  (view.boards[playerId]?.benchStackIds ?? []).flatMap((id) =>
    view.stacks[id] ? [view.stacks[id]] : []
  );

/** The card on top of a Pokémon: what it is now. */
export const topCard = (
  stack: ReturnType<typeof activeStack>
): ViewCard | undefined => stack?.evolutionCards.at(-1);

/** The first card of this kind among these, if any. */
export const findCard = (
  view: MatchViewState,
  cards: readonly ViewCard[],
  key: TutorialCardKey
): ViewCard | undefined =>
  cards.find((card) => tutorialCardKeyOf(view, card) === key);

export const countCards = (
  view: MatchViewState,
  cards: readonly ViewCard[],
  key: TutorialCardKey
): number =>
  cards.filter((card) => tutorialCardKeyOf(view, card) === key).length;

/** The first Pokémon in a seat's hand, if any. */
export const pokemonInHand = (
  view: MatchViewState,
  playerId: string
): ViewCard | undefined =>
  zoneCards(view, playerId, 'hand').find(
    (card) =>
      card.kind === 'known' &&
      view.definitions[card.definitionId]?.category === 'Pokémon'
  );

/** Whether an event of this kind (by this seat) was logged since the step began. */
export const happened = (
  world: TutorialWorld,
  type: string,
  playerId?: string
): boolean =>
  world.events.some(
    (event) =>
      event.type === type &&
      (playerId === undefined || event.playerId === playerId)
  );

/** Reads what is open on screen from the page. */
export const readScreen = (document: Document): TutorialScreen => {
  const menu = document.querySelector<HTMLElement>(
    '[data-legacy-card-context-menu="true"]'
  );
  const controls = document
    .querySelector<HTMLElement>(
      '.ptcgsim-marker-controls[data-marker-controls]'
    )
    ?.getAttribute('data-marker-controls');
  const pile = document.querySelector<HTMLElement>(
    '[data-legacy-zone-browser="true"][data-zone-browser-kind]'
  );
  return {
    preview:
      document.querySelector('[data-legacy-card-preview="true"]') !== null,
    cardMenu: menu?.dataset.contextCardId ?? null,
    markerControls:
      controls === 'damage' || controls === 'specialCondition'
        ? controls
        : null,
    pile: pile?.dataset.zoneBrowserKind ?? null,
    palette: document.querySelector('[data-command-palette]') !== null,
    deckScreen:
      document.querySelector('.ptcgsim-deck-layer[data-open="true"]') !== null,
    sheet:
      document.querySelector(
        '.ptcgsim-sheet[data-open], .ptcgsim-ui-dialog[data-open]'
      ) !== null,
  };
};

export const sameScreen = (
  left: TutorialScreen,
  right: TutorialScreen
): boolean =>
  left.preview === right.preview &&
  left.cardMenu === right.cardMenu &&
  left.markerControls === right.markerControls &&
  left.pile === right.pile &&
  left.palette === right.palette &&
  left.deckScreen === right.deckScreen &&
  left.sheet === right.sheet;
