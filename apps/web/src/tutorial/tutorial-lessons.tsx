import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { MatchViewState, ViewCard } from '@ptcgsim/game-core';
import { Trans } from '@lingui/react/macro';
import type { ReactNode } from 'react';

import { chordHint, commandsChordHint, parseChord } from '../hotkeys/chords.js';
import { hotkeyAction } from '../hotkeys/hotkey-catalogue.js';
import {
  TUTORIAL_BASIC_POKEMON,
  TUTORIAL_CARDS,
  tutorialCardKeyOf,
  type TutorialCardKey,
} from './tutorial-cards.js';
import { controlLabel } from './tutorial-labels.js';
import {
  isLoadedSeat,
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
  basicInHand,
  topCard,
  zoneCards,
  zoneId,
  type InputMode,
  type TutorialWorld,
} from './tutorial-world.js';

/** The palette's own key as the shortcuts sheet shows it, by default. */
const DEFAULT_COMMANDS_KEY = chordHint(
  parseChord(hotkeyAction('table.commands').defaultChord)!,
  'other'
);

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

/**
 * The midgame's Pidgey benched from the hand: more Pidgey on the Bench
 * than the lesson deals there (one), however long ago. Pidgey dropped
 * anywhere else is not.
 */
const pidgeyBenched = (world: TutorialWorld): boolean => {
  const seat = MIDGAME_SCENARIO.you;
  const dealt = isLoadedSeat(seat)
    ? 0
    : (seat.bench ?? []).filter((spot) => spot.card === 'pidgey').length;
  return (
    benchStacks(world.view, world.you).filter(
      (stack) =>
        countCards(world.view, stack.evolutionCards.slice(0, 1), 'pidgey') > 0
    ).length > dealt
  );
};

/** Whether a card is a Basic Pokémon, one put into play by itself. */
const isBasic = (world: TutorialWorld, card: ViewCard | undefined): boolean => {
  const key = card ? tutorialCardKeyOf(world.view, card) : undefined;
  return key !== undefined && TUTORIAL_BASIC_POKEMON.has(key);
};

/**
 * A Pokémon benched since the step began: a Pokémon new to the table
 * (the Active pushed to the Bench by another put in its place isn't, nor
 * one the room renamed, turned face down or brought back by an Undo) whose
 * bottom card wasn't in play then (one put back from the attached cards'
 * window, as a new Pokémon, was). Of `key` if given, else any Basic.
 */
const newlyBenched = (world: TutorialWorld, key?: TutorialCardKey): boolean => {
  const stacksThen = new Set(
    [
      activeStack(world.start, world.you),
      ...benchStacks(world.start, world.you),
    ].flatMap((stack) => (stack ? [stack.id] : []))
  );
  // On the Bench then (the Active's card, back in the hand by an Undo and
  // benched from there, is benched; the Active pushed to the Bench keeps
  // its own stack, which isn't new).
  const inPlay = new Set(
    benchStacks(world.start, world.you).flatMap((stack) =>
      [...(stack?.evolutionCards ?? []), ...(stack?.attachmentCards ?? [])].map(
        (card) => card.id
      )
    )
  );
  return benchStacks(world.view, world.you).some((stack) => {
    const bottom = stack.evolutionCards[0];
    return (
      bottom !== undefined &&
      !stacksThen.has(stack.id) &&
      !inPlay.has(bottom.id) &&
      (key === undefined
        ? isBasic(world, bottom)
        : tutorialCardKeyOf(world.view, bottom) === key)
    );
  });
};

/** Pidgey gone from the hand without the step done: said, as Charmeleon is. */
const pidgeyLeftHand = (world: TutorialWorld): ReactNode =>
  !findCard(world.view, zoneCards(world.view, world.you, 'hand'), 'pidgey') ? (
    <Trans>{name('pidgey')} has left your hand.</Trans>
  ) : null;

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

/**
 * Your Charmander, wherever it is (moved to the Bench by a swap, evolved):
 * the Pokémon whose bottom card is Charmander.
 */
const charmanderIn = (world: TutorialWorld, view: MatchViewState) =>
  [activeStack(view, world.you), ...benchStacks(view, world.you)].find(
    (stack) =>
      stack?.evolutionCards[0] !== undefined &&
      tutorialCardKeyOf(view, stack.evolutionCards[0]) === 'charmander'
  );

/** Charmander gone from play (discarded, back in the hand): said. */
const charmanderGone = (world: TutorialWorld): ReactNode =>
  charmanderIn(world, world.view) ? null : (
    <Trans>{name('charmander')} has left play.</Trans>
  );

/** Charmander's top card, for a drag onto it. */
const charmanderTarget = (world: TutorialWorld): TutorialTarget | null => {
  const top = topCard(charmanderIn(world, world.view));
  return top ? { card: top.id } : null;
};

const activeTopTarget = (
  world: TutorialWorld,
  playerId: string
): TutorialTarget | null => {
  const top = topCard(activeStack(world.view, playerId));
  return top ? { card: top.id } : null;
};

/** Every card of a Pokémon in play, by its id on the table. */
/** The damage or condition controls open on their Active, not another. */
const markersOnTheirActive = (world: TutorialWorld): boolean =>
  world.screen.markerControlsCard !== null &&
  stackCardIds(activeStack(world.view, world.them)).includes(
    world.screen.markerControlsCard
  );

const stackCardIds = (stack: ReturnType<typeof activeStack>): string[] =>
  stack
    ? [...stack.evolutionCards, ...stack.attachmentCards].map((card) => card.id)
    : [];

/**
 * A Basic benched before Start's Bench step asked, still on the Bench (its
 * Pokémon keeps its id through a swap; one taken off since doesn't count).
 */
const benchedBefore = (world: TutorialWorld): boolean => {
  const then = new Set(
    benchStacks(world.start, world.you)
      .filter((stack) => {
        const bottom = stack.evolutionCards[0];
        const key = bottom ? tutorialCardKeyOf(world.start, bottom) : undefined;
        return key !== undefined && TUTORIAL_BASIC_POKEMON.has(key);
      })
      .map((stack) => stack.id)
  );
  return benchStacks(world.view, world.you).some((stack) => then.has(stack.id));
};

/** A Basic Pokémon in your Active Spot (an Energy put there is none). */
const basicInActive = (world: TutorialWorld): boolean =>
  (activeStack(world.view, world.you)?.evolutionCards ?? []).some((card) =>
    isBasic(world, card)
  );

/**
 * Your seat dealt: its Prize cards out, or a hand. A Reset or an Undo of
 * Set up takes both back.
 */
const dealt = (world: TutorialWorld): boolean =>
  zoneCards(world.view, world.you, 'prizes').length > 0 ||
  zoneCards(world.view, world.you, 'hand').length > 0;

/** The setup step's own line, for a seat with nothing dealt. */
const pressSetUp = (): ReactNode => (
  <Trans>
    Press <strong>{controlLabel('setUp')}</strong>: it shuffles your deck and
    deals your hand.
  </Trans>
);

/** A Basic to the Active Spot: from the hand, or (its only Basic put there
 * first) the Bench. */
const toActive = (
  world: TutorialWorld
): { readonly from: TutorialTarget; readonly to: TutorialTarget } | null => {
  const card =
    basicInHand(world.view, world.you) ??
    topCard(
      benchStacks(world.view, world.you).find((stack) =>
        stack.evolutionCards.some((entry) => isBasic(world, entry))
      )
    );
  return card
    ? { from: { card: card.id }, to: slot(world.you, 'active') }
    : null;
};

/**
 * Nothing in the Active, the line that helps: not set up (an Undo or a
 * Reset since), Set up deals the hand again; set up but no Basic anywhere
 * -- in the hand, the Active or the Bench (an Energy put there is none) --
 * a mulligan.
 */
const activeStuck = (world: TutorialWorld): ReactNode =>
  !dealt(world) ? (
    pressSetUp()
  ) : basicInHand(world.view, world.you) === undefined &&
    ![
      activeStack(world.view, world.you),
      ...benchStacks(world.view, world.you),
    ].some((stack) =>
      (stack?.evolutionCards ?? []).some((card) => isBasic(world, card))
    ) ? (
    <Trans>
      No Basic Pokémon in your hand: that is a mulligan. Choose{' '}
      <strong>{controlLabel('setUpAgain')}</strong> under {controlLabel('more')}
      .
    </Trans>
  ) : null;

/** A seat set up: its six Prize cards out and a hand dealt. */
const setUp = (world: TutorialWorld, view: TutorialWorld['view']): boolean =>
  zoneCards(view, world.you, 'prizes').length === 6 &&
  zoneCards(view, world.you, 'hand').length >= 7;

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
          Press <strong>{controlLabel('setUp')}</strong>: it shuffles your deck
          and deals your hand.
        </Trans>
      ),
      targets: () => [railAction('setupButton')],
      // The table set up since the step began, or Set up pressed (again,
      // after Back) since then.
      done: (world) =>
        (!setUp(world, world.start) && setUp(world, world.view)) ||
        happened(world, 'PlayerSetup', world.you),
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
          Drag a Basic Pokémon from your hand onto your{' '}
          <strong>Active Spot</strong>.
        </Trans>
      ),
      drag: toActive,
      // A Basic Pokémon among its cards: not an Energy or a Stage put there
      // alone (one with a Basic put on it after shows the Basic).
      done: basicInActive,
      stuck: activeStuck,
    },
    {
      id: 'bench',
      text: () => (
        <Trans>
          Put another on your <strong>Bench</strong>. Up to five fit there.
        </Trans>
      ),
      // The Active first if it has gone meanwhile (an Undo, a deal again),
      // as the step before puts it there.
      drag: (world) => {
        if (!basicInActive(world)) return toActive(world);
        const card = basicInHand(world.view, world.you);
        return card
          ? { from: { card: card.id }, to: slot(world.you, 'bench') }
          : null;
      },
      // Or no Basic left in a hand dealt: not a hand taken back by a Reset
      // or an Undo of Set up, which says to set up again. Either way with a
      // Basic in the Active Spot.
      // Or one benched already, before the step asked (Start deals an empty
      // Bench: only the player put it there).
      done: (world) =>
        basicInActive(world) &&
        (newlyBenched(world) ||
          benchedBefore(world) ||
          (dealt(world) && basicInHand(world.view, world.you) === undefined)),
      stuck: (world) =>
        basicInActive(world)
          ? null
          : (activeStuck(world) ?? (
              <Trans>
                Drag a Basic Pokémon from your hand onto your{' '}
                <strong>Active Spot</strong>.
              </Trans>
            )),
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
            <strong>{controlLabel('read')}</strong>.
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
            <strong>{controlLabel('actions')}</strong>: everything a card can
            do.
          </Trans>
        ) : (
          <Trans>
            Right-click <strong>{name('charmander')}</strong>: everything a card
            can do.
          </Trans>
        ),
      targets: (world) => present([charmanderTarget(world)]),
      stuck: charmanderGone,
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
      // On Charmander wherever it is: the Active swapped meanwhile, the line
      // still names it.
      drag: (world) => {
        const from = cardIn(world, world.you, 'hand', 'fireEnergy');
        const to = charmanderTarget(world);
        return from && to ? { from, to } : null;
      },
      // A Fire Energy on Charmander now that wasn't on it as the step began
      // (Charmander put back in play since is a new Pokémon, Energy and all).
      done: (world) => {
        const before = new Set(
          (charmanderIn(world, world.start)?.attachmentCards ?? []).map(
            (card) => card.id
          )
        );
        return (charmanderIn(world, world.view)?.attachmentCards ?? []).some(
          (card) =>
            !before.has(card.id) &&
            tutorialCardKeyOf(world.view, card) === 'fireEnergy'
        );
      },
      stuck: (world) =>
        charmanderGone(world) ??
        (!findCard(
          world.view,
          zoneCards(world.view, world.you, 'hand'),
          'fireEnergy'
        ) ? (
          <Trans>That Energy has left your hand.</Trans>
        ) : null),
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
        const to = charmanderTarget(world);
        return from && to ? { from, to } : null;
      },
      // Charmeleon over Charmander, wherever it is: not Charmeleon put in
      // play by itself, or on another Pokémon.
      done: (world) =>
        [
          activeStack(world.view, world.you),
          ...benchStacks(world.view, world.you),
        ].some((stack) => {
          const keys = (stack?.evolutionCards ?? []).map((card) =>
            tutorialCardKeyOf(world.view, card)
          );
          const charmander = keys.indexOf('charmander');
          return (
            charmander >= 0 &&
            keys.indexOf('charmeleon', charmander) > charmander
          );
        }),
      stuck: (world) =>
        charmanderGone(world) ??
        (!findCard(
          world.view,
          zoneCards(world.view, world.you, 'hand'),
          'charmeleon'
        ) ? (
          <Trans>{name('charmeleon')} has left your hand.</Trans>
        ) : null),
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
      // Or benched already, before the step asked.
      done: (world) => newlyBenched(world, 'pidgey') || pidgeyBenched(world),
      stuck: pidgeyLeftHand,
    },
    {
      id: 'undo',
      text: () => (
        <Trans>
          Changed your mind? <strong>{controlLabel('undo')}</strong> takes back
          your last move.
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
            <strong>{controlLabel('actions')}</strong>.
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
        (world.screen.markerControls !== null && markersOnTheirActive(world)) ||
        (activeStack(world.view, world.them)?.damage ?? 0) > 0,
    },
    {
      id: 'counter',
      text: () => (
        <Trans comment="{0} is the Damage counter menu item's label">
          Choose <strong>{controlLabel('damageCounter')}</strong>.
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
        (world.screen.markerControls === 'damage' &&
          markersOnTheirActive(world)) ||
        (activeStack(world.view, world.them)?.damage ?? 0) > 0,
    },
    {
      id: 'sixty',
      text: () => (
        <Trans comment="60 is the damage on the Pokémon, not a number of cards; + is the button on screen, not a keyboard key">
          Set the damage to <strong>60</strong>: type it, or press{' '}
          <strong>+</strong>.
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
            Now make it <strong>Poisoned</strong>: tap it,{' '}
            <strong>{controlLabel('actions')}</strong>, then{' '}
            <strong>{controlLabel('specialCondition')}</strong>.
          </Trans>
        ) : (
          <Trans>
            Now make it <strong>Poisoned</strong>: right-click it, then{' '}
            <strong>{controlLabel('specialCondition')}</strong>.
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
      // The whole Pokémon: a card moved alone off it (a key, the menu, a
      // long press) leaves the rest by the table, not Knocked Out.
      done: (world) => {
        const discard = zoneCards(world.view, world.them, 'discard');
        return (['kirlia', 'ralts', 'psychicEnergy'] as const).every(
          (key) => countCards(world.view, discard, key) > 0
        );
      },
      // Kirlia there but the step not done: the rest is left out, by the
      // table, in its window or back in play.
      stuck: (world) =>
        countCards(
          world.view,
          zoneCards(world.view, world.them, 'discard'),
          'kirlia'
        ) > 0 ? (
          <Trans>
            Put the rest of it, <strong>{name('ralts')}</strong> and its Energy,
            in their discard pile too.
          </Trans>
        ) : null,
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
      // Into the hand, not anywhere else: a card the hand didn't hold as
      // the step began (whatever else left it meanwhile).
      done: (world) => {
        const held = new Set(
          zoneCards(world.start, world.you, 'hand').map((card) => card.id)
        );
        return (
          zoneCards(world.view, world.you, 'prizes').length <
            zoneCards(world.start, world.you, 'prizes').length &&
          zoneCards(world.view, world.you, 'hand').some(
            (card) => !held.has(card.id)
          )
        );
      },
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
      // Or taken already (at the draw, the deck open), none left in it.
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
          ) ||
        (cardIn(world, world.you, 'hand', 'rareCandy') !== null &&
          cardIn(world, world.you, 'deck', 'rareCandy') === null),
    },
    {
      id: 'shuffle',
      text: () => (
        <Trans comment="{0} is the Shuffle button's label">
          When you are done, press <strong>{controlLabel('shuffle')}</strong> to
          shuffle your deck.
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
          Start your turn with <strong>{controlLabel('turn')}</strong>. It draws
          your card.
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
        <Trans comment="{0} is the Attack button's label, {1} the Pass button's">
          Press <strong>{controlLabel('attack')}</strong> to attack and end your
          turn, or <strong>{controlLabel('pass')}</strong> to end it without
          attacking.
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
        <Trans comment="{0} is the Flip button's label, which turns the table around">
          On your own you play both sides. Press{' '}
          <strong>{controlLabel('flip')}</strong> to turn the table to theirs.
        </Trans>
      ),
      targets: () => [railAction('flipBoardButton')],
      done: (world) => world.flipped,
    },
    {
      id: 'their-turn',
      text: () => (
        <Trans>
          Their side is yours now: start their turn with{' '}
          <strong>{controlLabel('turn')}</strong>.
        </Trans>
      ),
      targets: () => [railAction('turnButton')],
      done: (world) => happened(world, 'TurnStarted', world.them),
    },
    {
      id: 'flip-back',
      text: () => (
        <Trans comment="{0} is the Flip button's label, which turns the table around">
          Press <strong>{controlLabel('flip')}</strong> to turn back to your
          side.
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
      // Or benched already: Back to this step, after it.
      done: (world) => newlyBenched(world, 'pidgey') || pidgeyBenched(world),
      stuck: pidgeyLeftHand,
    },
    {
      id: 'palette',
      text: (world) => {
        // Its default key, `, is a dead key on German, French or Spanish
        // keyboards and missing on Italian ones: Ctrl+K opens it on all.
        const own = world.keys('table.commands');
        const key =
          own !== undefined && own !== DEFAULT_COMMANDS_KEY
            ? own
            : commandsChordHint();
        return key ? (
          <Trans>
            Press <kbd>{key}</kbd> for{' '}
            <strong>{controlLabel('commands')}</strong>: every action, by name.
          </Trans>
        ) : (
          <Trans>
            Open <strong>{controlLabel('commands')}</strong>: every action, by
            name.
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
          It stays open for another draw. Press <kbd>Esc</kbd> twice to close
          it.
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
            Every key is under{' '}
            <strong>{controlLabel('keyboardShortcuts')}</strong>, in the menu.
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
          Tap <strong>{controlLabel('commands')}</strong>: every action, by
          name.
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
        <Trans comment="{0} is the Deck button's label, which opens the deck screen">
          <strong>{controlLabel('deck')}</strong>: build, import or pick a deck
          for each side.
        </Trans>
      ),
      targets: () => [barButton('deckImportButton')],
    },
    {
      id: 'online',
      text: () => (
        <Trans>
          <strong>{controlLabel('playOnline')}</strong>: send a friend a link to
          your table.
        </Trans>
      ),
      targets: () => [barButton('p2Button')],
    },
    {
      id: 'log',
      text: () => (
        <Trans>
          <strong>{controlLabel('log')}</strong>: every move, and the chat.
        </Trans>
      ),
      targets: () => [{ selectors: ['#activityButton'] }],
    },
    {
      id: 'settings',
      text: () => (
        <Trans>
          <strong>{controlLabel('settings')}</strong>: the table's look, the
          theme and the language.
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
