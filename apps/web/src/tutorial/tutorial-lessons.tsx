import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ReactNode } from 'react';

import { TUTORIAL_CARDS, type TutorialCardKey } from './tutorial-cards.js';
import {
  MIDGAME_SCENARIO,
  START_SCENARIO,
  type TutorialScenario,
} from './tutorial-scenarios.js';
import {
  activeStack,
  benchStacks,
  countCards,
  findCard,
  happened,
  pokemonInHand,
  topCard,
  zoneCards,
  zoneId,
  type InputMode,
  type TutorialWorld,
} from './tutorial-world.js';

/**
 * The tutorial's lessons (ADR-038): each a few steps on its own starting
 * position. A step says one thing to do, in a line or two, worded for the
 * hand that does it (a mouse or a finger); it lights what to touch, shows
 * a drag where there is one, and is done when the table shows it done --
 * however it was done.
 */

/** Something to light: a card or zone on the table, or an element. */
export type TutorialTarget =
  | { readonly card: string }
  | {
      readonly zone: string;
      /**
       * Only an empty card's room of it, where a dropped card lands on its
       * own (the Bench beside its Pokémon, not on one of them).
       */
      readonly free?: boolean;
    }
  | {
      /** Tried in order: a control can sit in a menu on a small screen. */
      readonly selectors: readonly string[];
    };

export interface TutorialStep {
  readonly id: string;
  readonly text: (world: TutorialWorld) => ReactNode;
  readonly targets?: (world: TutorialWorld) => readonly TutorialTarget[];
  /** A drag to show, from one target to another. */
  readonly drag?: (
    world: TutorialWorld
  ) => { readonly from: TutorialTarget; readonly to: TutorialTarget } | null;
  /** Done when this holds. Without it, a step to read, with Next. */
  readonly done?: (world: TutorialWorld) => boolean;
  /**
   * The table no longer allows the step (its card has gone): what to say
   * instead. The lesson can be started again from the coach.
   */
  readonly stuck?: (world: TutorialWorld) => ReactNode | null;
  /** A step that may be passed over with Next (it has nothing to do). */
  readonly optional?: boolean;
}

export interface TutorialLesson {
  readonly id: string;
  /** Raised when a lesson is rewritten, so it reads as new again. */
  readonly version: number;
  readonly title: MessageDescriptor;
  /** One line for the list of lessons. */
  readonly summary: MessageDescriptor;
  readonly scenario: TutorialScenario;
  /** A lesson for one kind of hand only (the keys need a keyboard). */
  readonly only?: InputMode;
  readonly steps: readonly TutorialStep[];
}

const name = (key: TutorialCardKey): string => TUTORIAL_CARDS[key].name;

/** A card in a seat's zone, lit by its id on the table. */
const cardIn = (
  world: TutorialWorld,
  playerId: string,
  kind: string,
  key: TutorialCardKey
): TutorialTarget | null => {
  const card = findCard(world.view, zoneCards(world.view, playerId, kind), key);
  return card ? { card: card.id } : null;
};

const present = <T,>(values: readonly (T | null | undefined)[]): T[] =>
  values.filter((value): value is T => value !== null && value !== undefined);

const zone = (playerId: string, kind: string): TutorialTarget => ({
  zone: zoneId(playerId, kind),
});

/** A play spot; the Bench's empty room, not one of its Pokémon. */
const slot = (playerId: string, kind: 'active' | 'bench'): TutorialTarget =>
  kind === 'bench'
    ? { zone: `slot:${playerId}:bench`, free: true }
    : { zone: `slot:${playerId}:active` };

/** A rail action, or More where the rail has folded it away. */
const railAction = (id: string): TutorialTarget => ({
  selectors: [`#boardButtonContainer #${id}`, '#moreActionsButton'],
});

/** An app bar button, or the menu that holds it on a phone. */
const barButton = (id: string): TutorialTarget => ({
  selectors: [`.ptcgsim-app-bar #${id}`, '#appMenuButton'],
});

const activeTopTarget = (
  world: TutorialWorld,
  playerId: string
): TutorialTarget | null => {
  const top = topCard(activeStack(world.view, playerId));
  return top ? { card: top.id } : null;
};

/** Every card of a Pokémon in play, by its id on the table. */
const stackCardIds = (stack: ReturnType<typeof activeStack>): string[] =>
  stack
    ? [...stack.evolutionCards, ...stack.attachmentCards].map((card) => card.id)
    : [];

const handSize = (world: TutorialWorld, view = world.view): number =>
  zoneCards(view, world.you, 'hand').length;

// ---- 1. Start a game ------------------------------------------------------

const start: TutorialLesson = {
  id: 'start',
  version: 1,
  title: msg`Start a game`,
  summary: msg`Set up, then put your Pokémon in play`,
  scenario: START_SCENARIO,
  steps: [
    {
      id: 'setup',
      text: () => (
        <Trans>
          Press <strong>Set up</strong>: it shuffles your deck and deals your
          hand.
        </Trans>
      ),
      targets: () => [railAction('setupButton')],
      done: (world) =>
        zoneCards(world.view, world.you, 'prizes').length === 6 &&
        handSize(world) >= 7,
    },
    {
      id: 'hand',
      text: () => (
        <Trans>
          Your hand, and your 6 <strong>Prize cards</strong>, face down.
        </Trans>
      ),
      targets: (world) => [zone(world.you, 'hand'), zone(world.you, 'prizes')],
    },
    {
      id: 'active',
      text: () => (
        <Trans>
          Drag a Pokémon from your hand onto your <strong>Active Spot</strong>.
        </Trans>
      ),
      drag: (world) => {
        const card = pokemonInHand(world.view, world.you);
        return card
          ? { from: { card: card.id }, to: slot(world.you, 'active') }
          : null;
      },
      done: (world) => activeStack(world.view, world.you) !== undefined,
      stuck: (world) =>
        pokemonInHand(world.view, world.you) === undefined &&
        activeStack(world.view, world.you) === undefined ? (
          <Trans>
            No Pokémon in your hand: that is a mulligan. Choose{' '}
            <strong>Set up again</strong> under More.
          </Trans>
        ) : null,
    },
    {
      id: 'bench',
      text: () => (
        <Trans>
          Put another on your <strong>Bench</strong>. Up to five fit there.
        </Trans>
      ),
      drag: (world) => {
        const card = pokemonInHand(world.view, world.you);
        return card
          ? { from: { card: card.id }, to: slot(world.you, 'bench') }
          : null;
      },
      done: (world) =>
        benchStacks(world.view, world.you).length >
          benchStacks(world.start, world.you).length ||
        pokemonInHand(world.view, world.you) === undefined,
      optional: true,
    },
  ],
};

// ---- 2. Look at cards -----------------------------------------------------

const cards: TutorialLesson = {
  id: 'cards',
  version: 1,
  title: msg`Look at cards`,
  summary: msg`Read a card, and open its actions`,
  scenario: MIDGAME_SCENARIO,
  steps: [
    {
      id: 'read',
      text: (world) =>
        world.mode === 'touch' ? (
          <Trans>
            Tap <strong>{name('charmeleon')}</strong> in your hand, then{' '}
            <strong>Read</strong>.
          </Trans>
        ) : (
          <Trans>
            Double-click <strong>{name('charmeleon')}</strong> in your hand to
            read it.
          </Trans>
        ),
      targets: (world) =>
        present([cardIn(world, world.you, 'hand', 'charmeleon')]),
      done: (world) => world.screen.preview,
    },
    {
      id: 'close',
      text: (world) =>
        world.mode === 'touch' ? (
          <Trans>Tap outside the card to put it back.</Trans>
        ) : (
          <Trans>
            Click outside the card, or press <kbd>Esc</kbd>, to put it back.
          </Trans>
        ),
      done: (world) => !world.screen.preview,
    },
    {
      id: 'menu',
      text: (world) =>
        world.mode === 'touch' ? (
          <Trans>
            Tap <strong>{name('charmander')}</strong>, then{' '}
            <strong>Actions</strong>: everything a card can do.
          </Trans>
        ) : (
          <Trans>
            Right-click <strong>{name('charmander')}</strong>: everything a card
            can do.
          </Trans>
        ),
      targets: (world) => present([activeTopTarget(world, world.you)]),
      done: (world) => world.screen.cardMenu !== null,
    },
    {
      id: 'menu-close',
      text: (world) =>
        world.mode === 'touch' ? (
          <Trans>Tap outside the menu to close it.</Trans>
        ) : (
          <Trans>
            Press <kbd>Esc</kbd> or click away to close it.
          </Trans>
        ),
      done: (world) => world.screen.cardMenu === null,
    },
  ],
};

// ---- 3. Attach and evolve -------------------------------------------------

const attach: TutorialLesson = {
  id: 'attach',
  version: 1,
  title: msg`Attach and evolve`,
  summary: msg`Energy, evolutions, Trainers and the Bench`,
  scenario: MIDGAME_SCENARIO,
  steps: [
    {
      id: 'energy',
      text: () => (
        <Trans>
          Drag a <strong>{name('fireEnergy')}</strong> onto {name('charmander')}{' '}
          to attach it.
        </Trans>
      ),
      drag: (world) => {
        const from = cardIn(world, world.you, 'hand', 'fireEnergy');
        const to = activeTopTarget(world, world.you);
        return from && to ? { from, to } : null;
      },
      done: (world) =>
        countCards(
          world.view,
          activeStack(world.view, world.you)?.attachmentCards ?? [],
          'fireEnergy'
        ) >
        countCards(
          world.start,
          activeStack(world.start, world.you)?.attachmentCards ?? [],
          'fireEnergy'
        ),
      stuck: (world) =>
        !findCard(
          world.view,
          zoneCards(world.view, world.you, 'hand'),
          'fireEnergy'
        ) ? (
          <Trans>That Energy has left your hand.</Trans>
        ) : null,
    },
    {
      id: 'evolve',
      text: () => (
        <Trans>
          Evolve it: drag <strong>{name('charmeleon')}</strong> onto{' '}
          {name('charmander')}.
        </Trans>
      ),
      drag: (world) => {
        const from = cardIn(world, world.you, 'hand', 'charmeleon');
        const to = activeTopTarget(world, world.you);
        return from && to ? { from, to } : null;
      },
      done: (world) =>
        [
          activeStack(world.view, world.you),
          ...benchStacks(world.view, world.you),
        ].some(
          (stack) =>
            countCards(world.view, stack?.evolutionCards ?? [], 'charmeleon') >
            0
        ),
      stuck: (world) =>
        !findCard(
          world.view,
          zoneCards(world.view, world.you, 'hand'),
          'charmeleon'
        ) ? (
          <Trans>{name('charmeleon')} has left your hand.</Trans>
        ) : null,
    },
    {
      id: 'trainer',
      text: () => (
        <Trans>
          Play <strong>{name('research')}</strong>: drag it onto the open mat.
          Ending your turn clears it away.
        </Trans>
      ),
      drag: (world) => {
        const from = cardIn(world, world.you, 'hand', 'research');
        return from ? { from, to: zone(world.you, 'board') } : null;
      },
      done: (world) =>
        countCards(
          world.view,
          zoneCards(world.view, world.you, 'board'),
          'research'
        ) > 0 ||
        countCards(
          world.view,
          zoneCards(world.view, world.you, 'discard'),
          'research'
        ) > 0,
    },
    {
      id: 'bench',
      text: () => (
        <Trans>
          Bench <strong>{name('pidgey')}</strong> too.
        </Trans>
      ),
      drag: (world) => {
        const from = cardIn(world, world.you, 'hand', 'pidgey');
        return from ? { from, to: slot(world.you, 'bench') } : null;
      },
      done: (world) =>
        benchStacks(world.view, world.you).length >
        benchStacks(world.start, world.you).length,
    },
    {
      id: 'undo',
      text: () => (
        <Trans>
          Changed your mind? <strong>Undo</strong> takes back your last move.
        </Trans>
      ),
      targets: () => [railAction('undoButton')],
      done: (world) => happened(world, 'UndoApplied'),
    },
  ],
};

// ---- 4. Damage ------------------------------------------------------------

const damage: TutorialLesson = {
  id: 'damage',
  version: 1,
  title: msg`Damage and conditions`,
  summary: msg`Put damage and Poisoned on their Pokémon`,
  scenario: MIDGAME_SCENARIO,
  steps: [
    {
      id: 'menu',
      text: (world) =>
        world.mode === 'touch' ? (
          <Trans>
            Tap their <strong>{name('kirlia')}</strong>, then{' '}
            <strong>Actions</strong>.
          </Trans>
        ) : (
          <Trans>
            Right-click their <strong>{name('kirlia')}</strong>.
          </Trans>
        ),
      targets: (world) => present([activeTopTarget(world, world.them)]),
      // Their Active's own menu, or what it leads to already open.
      done: (world) =>
        (world.screen.cardMenu !== null &&
          stackCardIds(activeStack(world.view, world.them)).includes(
            world.screen.cardMenu
          )) ||
        world.screen.markerControls !== null ||
        (activeStack(world.view, world.them)?.damage ?? 0) > 0,
    },
    {
      id: 'counter',
      text: () => (
        <Trans>
          Choose <strong>Damage counter</strong>.
        </Trans>
      ),
      targets: () => [
        {
          selectors: [
            '[data-legacy-card-context-menu] [data-context-action="setDamage"]',
          ],
        },
      ],
      done: (world) =>
        world.screen.markerControls === 'damage' ||
        (activeStack(world.view, world.them)?.damage ?? 0) > 0,
    },
    {
      id: 'sixty',
      text: () => (
        <Trans>
          Make it <strong>60</strong>: type it, or press <strong>+</strong>.
        </Trans>
      ),
      targets: () => [
        { selectors: ['.ptcgsim-marker-controls[data-marker-controls]'] },
      ],
      done: (world) => activeStack(world.view, world.them)?.damage === 60,
    },
    {
      id: 'poison',
      text: (world) =>
        world.mode === 'touch' ? (
          <Trans>
            Now make it <strong>Poisoned</strong>: <strong>Actions</strong>,
            then <strong>Special condition</strong>.
          </Trans>
        ) : (
          <Trans>
            Now make it <strong>Poisoned</strong>: right-click it, then{' '}
            <strong>Special condition</strong>.
          </Trans>
        ),
      targets: (world) => present([activeTopTarget(world, world.them)]),
      done: (world) =>
        (activeStack(world.view, world.them)?.specialCondition ?? null) !==
        null,
    },
  ],
};

// ---- 5. Knock Out -----------------------------------------------------------

const knockOut: TutorialLesson = {
  id: 'knock-out',
  version: 1,
  title: msg`Knock Out`,
  summary: msg`Discard a Pokémon, take a Prize, bring up the next`,
  scenario: MIDGAME_SCENARIO,
  steps: [
    {
      id: 'discard',
      text: () => (
        <Trans>
          Knock Out their <strong>{name('kirlia')}</strong>: drag it onto their
          discard pile. Its Energy goes with it.
        </Trans>
      ),
      drag: (world) => {
        const from = activeTopTarget(world, world.them);
        return from ? { from, to: zone(world.them, 'discard') } : null;
      },
      done: (world) =>
        countCards(
          world.view,
          zoneCards(world.view, world.them, 'discard'),
          'kirlia'
        ) > 0,
    },
    {
      id: 'prize',
      text: () => (
        <Trans>
          Take a <strong>Prize card</strong>: drag one into your hand.
        </Trans>
      ),
      drag: (world) => {
        const prize = zoneCards(world.view, world.you, 'prizes')[0];
        return prize
          ? { from: { card: prize.id }, to: zone(world.you, 'hand') }
          : null;
      },
      done: (world) =>
        zoneCards(world.view, world.you, 'prizes').length <
        zoneCards(world.start, world.you, 'prizes').length,
    },
    {
      id: 'promote',
      text: () => (
        <Trans>
          They bring up the next: drag a <strong>{name('ralts')}</strong> from
          their Bench to their Active Spot.
        </Trans>
      ),
      drag: (world) => {
        const bench = benchStacks(world.view, world.them)[0];
        const top = topCard(bench);
        return top
          ? { from: { card: top.id }, to: slot(world.them, 'active') }
          : null;
      },
      done: (world) => activeStack(world.view, world.them) !== undefined,
    },
  ],
};

// ---- 6. Your deck -----------------------------------------------------------

const deck: TutorialLesson = {
  id: 'deck',
  version: 1,
  title: msg`Your deck`,
  summary: msg`Draw, search and shuffle`,
  scenario: MIDGAME_SCENARIO,
  steps: [
    {
      id: 'draw',
      text: (world) =>
        world.mode === 'touch' ? (
          <Trans>Draw a card: drag the top of your deck into your hand.</Trans>
        ) : (
          <Trans>
            Draw a card: drag the top of your deck into your hand, or press{' '}
            <kbd>1</kbd>.
          </Trans>
        ),
      drag: (world) => ({
        from: zone(world.you, 'deck'),
        to: zone(world.you, 'hand'),
      }),
      done: (world) =>
        handSize(world) > handSize(world, world.start) &&
        zoneCards(world.view, world.you, 'deck').length <
          zoneCards(world.start, world.you, 'deck').length,
    },
    {
      id: 'search',
      text: (world) =>
        world.mode === 'touch' ? (
          <Trans>Tap your deck to look through it.</Trans>
        ) : (
          <Trans>Click your deck to look through it.</Trans>
        ),
      targets: (world) => [zone(world.you, 'deck')],
      done: (world) => world.screen.pile === 'deck',
    },
    {
      id: 'take',
      text: () => (
        <Trans>
          Find <strong>{name('rareCandy')}</strong> and drag it into your hand.
        </Trans>
      ),
      // The card itself in the open deck, or the deck while it is shut.
      targets: (world) => [
        {
          selectors: [
            `[data-zone-browser-kind="deck"] button[data-overlay-card-id][aria-label^="${name('rareCandy')}"]`,
            '[data-zone-browser-kind="deck"]',
            `.ptcgsim-zone[data-zone-id="${zoneId(world.you, 'deck')}"]`,
          ],
        },
      ],
      done: (world) =>
        countCards(
          world.view,
          zoneCards(world.view, world.you, 'hand'),
          'rareCandy'
        ) >
        countCards(
          world.start,
          zoneCards(world.start, world.you, 'hand'),
          'rareCandy'
        ),
    },
    {
      id: 'shuffle',
      text: () => (
        <Trans>
          <strong>Shuffle</strong> your deck when you are done.
        </Trans>
      ),
      targets: () => [
        {
          selectors: [
            '[data-zone-browser-kind="deck"] [data-zone-action="shuffleDeck"]',
            `[data-zone-kind="deck"][data-zone-side="local"]`,
          ],
        },
      ],
      done: (world) => happened(world, 'ZoneShuffled', world.you),
    },
  ],
};

// ---- 7. Turns ---------------------------------------------------------------

const turns: TutorialLesson = {
  id: 'turns',
  version: 1,
  title: msg`Turns`,
  summary: msg`Start a turn, flip a coin, attack`,
  scenario: MIDGAME_SCENARIO,
  steps: [
    {
      id: 'turn',
      text: () => (
        <Trans>
          Start your turn with <strong>Turn</strong>. It draws your card.
        </Trans>
      ),
      targets: () => [railAction('turnButton')],
      done: (world) => happened(world, 'TurnStarted'),
    },
    {
      id: 'coin',
      text: () => <Trans>Flip a coin: press your coin.</Trans>,
      targets: () => [
        {
          selectors: [
            '[data-table-coin="local"] button',
            '#boardButtonContainer #flipCoinButton',
            '#moreActionsButton',
          ],
        },
      ],
      done: (world) => happened(world, 'CoinFlipped'),
    },
    {
      id: 'attack',
      text: () => (
        <Trans>
          End your turn with <strong>Attack</strong>, or <strong>Pass</strong>{' '}
          without one.
        </Trans>
      ),
      targets: () => [railAction('attackButton'), railAction('passButton')],
      done: (world) =>
        happened(world, 'AttackDeclared') || happened(world, 'PassDeclared'),
    },
  ],
};

// ---- 8. Both sides ----------------------------------------------------------

const bothSides: TutorialLesson = {
  id: 'both-sides',
  version: 1,
  title: msg`Both sides`,
  summary: msg`Play the other side yourself`,
  scenario: MIDGAME_SCENARIO,
  steps: [
    {
      id: 'flip',
      text: () => (
        <Trans>
          On your own you play both sides. <strong>Flip</strong> the table to
          theirs.
        </Trans>
      ),
      targets: () => [railAction('flipBoardButton')],
      done: (world) => world.flipped,
    },
    {
      id: 'their-turn',
      text: () => (
        <Trans>
          Their side is yours now: start their turn with <strong>Turn</strong>.
        </Trans>
      ),
      targets: () => [railAction('turnButton')],
      done: (world) => happened(world, 'TurnStarted', world.them),
    },
    {
      id: 'flip-back',
      text: () => (
        <Trans>
          <strong>Flip</strong> back to your side.
        </Trans>
      ),
      targets: () => [railAction('flipBoardButton')],
      done: (world) => !world.flipped,
    },
  ],
};

// ---- 9. Keys, or Commands on a touch screen ----------------------------------

const keys: TutorialLesson = {
  id: 'keys',
  version: 1,
  title: msg`Keys and commands`,
  summary: msg`Play faster from the keyboard`,
  scenario: MIDGAME_SCENARIO,
  only: 'mouse',
  steps: [
    {
      id: 'bench-key',
      // The player's own key, as they have set it; with it turned off, the
      // drag does it.
      text: (world) => {
        const key = world.keys('card.toBench');
        return key ? (
          <Trans>
            Click <strong>{name('pidgey')}</strong> in your hand, then press{' '}
            <kbd>{key}</kbd> to bench it.
          </Trans>
        ) : (
          <Trans>
            Bench <strong>{name('pidgey')}</strong> from your hand.
          </Trans>
        );
      },
      targets: (world) => present([cardIn(world, world.you, 'hand', 'pidgey')]),
      done: (world) =>
        benchStacks(world.view, world.you).length >
        benchStacks(world.start, world.you).length,
    },
    {
      id: 'palette',
      text: (world) => {
        const key = world.keys('table.commands');
        return key ? (
          <Trans>
            Press <kbd>{key}</kbd> for <strong>Commands</strong>: every action,
            by name.
          </Trans>
        ) : (
          <Trans>
            Open <strong>Commands</strong>: every action, by name.
          </Trans>
        );
      },
      targets: () => [barButton('commandsButton')],
      done: (world) => world.screen.palette,
    },
    {
      id: 'palette-draw',
      text: () => (
        <Trans>
          Type <strong>draw</strong> and press <kbd>Enter</kbd>.
        </Trans>
      ),
      done: (world) => handSize(world) > handSize(world, world.start),
    },
    {
      id: 'palette-close',
      text: () => (
        <Trans>
          It stays open for another draw. Close it with <kbd>Esc</kbd>.
        </Trans>
      ),
      done: (world) => !world.screen.palette,
    },
    {
      id: 'shortcuts',
      text: (world) => {
        const key = world.keys('table.shortcuts');
        return key ? (
          <Trans>
            Press <kbd>{key}</kbd> any time for every key.
          </Trans>
        ) : (
          <Trans>
            Every key is under <strong>Keyboard shortcuts</strong>, in the menu.
          </Trans>
        );
      },
    },
  ],
};

const commands: TutorialLesson = {
  id: 'commands',
  version: 1,
  title: msg`Commands`,
  summary: msg`Find any action by name`,
  scenario: MIDGAME_SCENARIO,
  only: 'touch',
  steps: [
    {
      id: 'palette',
      text: () => (
        <Trans>
          Tap <strong>Commands</strong>: every action, by name.
        </Trans>
      ),
      targets: () => [barButton('commandsButton')],
      done: (world) => world.screen.palette,
    },
    {
      id: 'palette-draw',
      text: () => (
        <Trans>
          Type <strong>draw</strong>, then tap the first row.
        </Trans>
      ),
      done: (world) => handSize(world) > handSize(world, world.start),
    },
    {
      id: 'palette-close',
      text: () => (
        <Trans>It stays open for another draw. Tap outside to close it.</Trans>
      ),
      done: (world) => !world.screen.palette,
    },
  ],
};

// ---- 10. Around the table -----------------------------------------------------

const around: TutorialLesson = {
  id: 'around',
  version: 1,
  title: msg`Around the table`,
  summary: msg`Decks, playing online, the log and Settings`,
  scenario: MIDGAME_SCENARIO,
  steps: [
    {
      id: 'deck',
      text: () => (
        <Trans>
          <strong>Deck</strong>: build, import or pick a deck for each side.
        </Trans>
      ),
      targets: () => [barButton('deckImportButton')],
    },
    {
      id: 'online',
      text: () => (
        <Trans>
          <strong>Play online</strong>: send a friend a link to your table.
        </Trans>
      ),
      targets: () => [barButton('p2Button')],
    },
    {
      id: 'log',
      text: () => (
        <Trans>
          <strong>Log</strong>: every move, and the chat.
        </Trans>
      ),
      targets: () => [{ selectors: ['#activityButton'] }],
    },
    {
      id: 'settings',
      text: () => (
        <Trans>
          <strong>Settings</strong>: the table's look, the theme and the
          language.
        </Trans>
      ),
      targets: () => [barButton('settingsButton')],
    },
    {
      id: 'menu',
      text: () => (
        <Trans>
          This tutorial waits in the <strong>menu</strong> whenever you want it.
        </Trans>
      ),
      targets: () => [{ selectors: ['#appMenuButton'] }],
    },
  ],
};

/** Every lesson, in the order the list offers them. */
export const TUTORIAL_LESSONS: readonly TutorialLesson[] = [
  start,
  cards,
  attach,
  damage,
  knockOut,
  deck,
  turns,
  bothSides,
  keys,
  commands,
  around,
];

/** The lessons for this hand: the keys only where there are keys. */
export const lessonsFor = (mode: InputMode): readonly TutorialLesson[] =>
  TUTORIAL_LESSONS.filter(
    (lesson) => lesson.only === undefined || lesson.only === mode
  );

export const lessonById = (id: string): TutorialLesson | undefined =>
  TUTORIAL_LESSONS.find((lesson) => lesson.id === id);
