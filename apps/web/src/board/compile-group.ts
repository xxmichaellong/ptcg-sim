import type {
  CardStepType,
  MatchViewState,
  ViewCardId,
} from '@ptcgsim/game-core';
import {
  cardStepMakesPokemon,
  MAX_CARD_STEPS,
  WireCardStepSchema,
  type WireCardStep,
  type WireGameCommand,
} from '@ptcgsim/protocol';

import { locateViewCardActionSource } from './locateViewCardActionSource.js';
import {
  cardPieceOf,
  partitionPieceSets,
  unfinishedPokemonFor,
  type GroupUnit,
  type PieceSet,
} from './piece-sets.js';
import { predictCardStep } from './predictWireCommand.js';
import { resolveBoardDrop } from './resolveBoardDrop.js';
import { resolveCardAnnotationAction } from './resolveCardAnnotationAction.js';
import { resolveCardPlayMoveAction } from './resolveCardPlayMoveAction.js';
import { resolveCardStadiumMoveAction } from './resolveCardStadiumMoveAction.js';
import { resolveCardZoneMoveAction } from './resolveCardZoneMoveAction.js';
import { resolveDeckRelativeCardAction } from './resolveDeckRelativeAction.js';
import { resolvePublicCardVisibilityAction } from './resolvePublicVisibilityAction.js';
import {
  resolveConditionKeyAction,
  resolveDamageKeyAction,
  resolveStackStateAction,
} from './resolveStackStateAction.js';
import {
  normalizeSelection,
  type SelectionContext,
  type SelectionRefusalReason,
} from './selection.js';

/**
 * Where a key sends each item: to its owner's pile, or its owner's deck
 * (on top, at the bottom, or shuffled in); the staging area is the one of
 * the seat it came from. These are where each goes alone.
 */
export type GroupPlace =
  | 'hand'
  | 'discard'
  | 'lostZone'
  | 'prizes'
  | 'board'
  | 'deckTop'
  | 'deckBottom'
  | 'deckShuffled';

/**
 * What a group is asked to do (ADR-042 §3):
 * - `send`: a key (`h`, `d`, `l`, `p`, Space, `↑`, `↓`, `s`);
 * - `play`: `b` or `a`, onto the board each would go to alone;
 * - `stadium`: `g`;
 * - `drop`: let go of on a place, as a drag names it (a zone, a Bench or
 *   Active Spot, or a Pokémon, which `q`/`e` pick too), at a place among a
 *   zone's cards where it keeps an order;
 * - `damage` (a number key, Alt taking off), `clearDamage` (`0`),
 *   `condition` (`y`, Alt+`y` taking it off), `ability` (`w`), `reveal`
 *   (Alt+`z` reveals, `z` hides) and `rotate` (`r`, Alt+`r` one card).
 */
export type GroupAction =
  | { readonly kind: 'send'; readonly to: GroupPlace }
  | { readonly kind: 'play'; readonly slot: 'active' | 'bench' }
  | { readonly kind: 'stadium' }
  | {
      readonly kind: 'drop';
      readonly targetId: string;
      readonly index?: number;
    }
  | { readonly kind: 'damage'; readonly delta: number }
  | { readonly kind: 'clearDamage' }
  | { readonly kind: 'condition'; readonly remove: boolean }
  | { readonly kind: 'ability' }
  | { readonly kind: 'reveal'; readonly revealed: boolean }
  | { readonly kind: 'rotate'; readonly single: boolean };

/**
 * Why a group can't do it. Beyond a single card's reasons:
 * - `empty`: nothing is selected;
 * - `no_op`: every item is already there;
 * - `one_active`: only one Pokémon (or one set of pieces) can be Active;
 * - `one_stadium`: the Stadium takes one card, or one Stadium's pieces;
 * - `pokemon_to_play`: a Pokémon in play can't join a group going into
 *   play;
 * - `attachments_only`: only cards to attach, and that Pokémon's own
 *   missing pieces, go on a Pokémon together;
 * - `not_in_play`: damage goes only on Pokémon in play;
 * - `active_only`: a Special Condition only on Active Pokémon;
 * - `unpredictable`: the client can't tell what a step leaves, so the
 *   next one can't be told what to expect;
 * - `too_many_steps`: more than one move can carry.
 */
export type GroupRefusalReason =
  | SelectionRefusalReason
  | 'not_player'
  | 'stale_scene'
  | 'stale_target'
  | 'stale_player'
  | 'unsupported_source'
  | 'unsupported_target'
  | 'no_deck'
  | 'empty_deck'
  | 'empty_zone'
  | 'invalid_value'
  | 'no_op'
  | 'empty'
  | 'one_active'
  | 'one_stadium'
  | 'pokemon_to_play'
  | 'attachments_only'
  | 'not_in_play'
  | 'active_only'
  | 'unpredictable'
  | 'too_many_steps';

export type GroupCompilation =
  | {
      readonly ok: true;
      /**
       * What to send: one item's own single command, as it goes alone
       * today; for several, `ApplyCardSteps` (or the one step left when the
       * rest are already there).
       */
      readonly command: WireGameCommand;
      /** Items left out because they are already there. */
      readonly skipped: readonly ViewCardId[];
    }
  | {
      readonly ok: false;
      readonly reason: GroupRefusalReason;
      /** The card it is about, when it is one card's. */
      readonly cardId?: ViewCardId;
    };

type Refusal = Extract<GroupCompilation, { readonly ok: false }>;

type Resolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | { readonly ok: false; readonly reason: GroupRefusalReason };

const refuse = (reason: GroupRefusalReason, cardId?: ViewCardId): Refusal =>
  cardId === undefined ? { ok: false, reason } : { ok: false, reason, cardId };

/**
 * The commands a group's move may be made of: the wire's own list, the one
 * the room checks each step against (game-core's `CARD_STEP_TYPES` stays
 * out of the web bundle).
 */
const STEP_TYPES: ReadonlySet<string> = new Set(
  WireCardStepSchema.options.map((schema) => schema.entries.type.literal)
);

/** A single command a group's move may be made of. */
const isCardStep = (
  command: WireGameCommand
): command is Extract<WireGameCommand, { readonly type: CardStepType }> =>
  STEP_TYPES.has(command.type);

/** Zones whose order a player sets, where a drop picks a place. */
const ARRANGED_ZONE_KINDS = new Set(['hand', 'board', 'prizes']);

/**
 * The steps of one move, each folded onto the view the steps before it
 * left, so each expects the table as the room will find it.
 */
const createSteps = (context: SelectionContext) => {
  let view = context.view;
  const list: WireCardStep[] = [];
  const made: (string | undefined)[] = [];
  const skipped: ViewCardId[] = [];
  const options = { readsEveryHand: context.controlsEverySeat === true };
  return {
    list,
    skipped,
    view: () => view,
    /** False when what the step leaves can't be told. */
    add: (step: WireCardStep): boolean => {
      // Shuffles come last, and nothing after them needs their result.
      if (step.type === 'ShuffleZone') {
        list.push(step);
        made.push(undefined);
        return true;
      }
      const next = predictCardStep(view, step, made, options);
      if (!next) return false;
      list.push(step);
      made.push(next.made);
      view = next.view;
      return true;
    },
  };
};

type Steps = ReturnType<typeof createSteps>;

/** One item's single command into the move: skipped if already there. */
const take = (
  steps: Steps,
  cardId: ViewCardId,
  resolution: Resolution
): Refusal | null => {
  if (!resolution.ok) {
    if (resolution.reason !== 'no_op') return refuse(resolution.reason, cardId);
    steps.skipped.push(cardId);
    return null;
  }
  if (!isCardStep(resolution.command))
    return refuse('unsupported_source', cardId);
  return steps.add(resolution.command) ? null : refuse('unpredictable', cardId);
};

/** The Pokémon an item is, when it is a whole Pokémon in play. */
const wholePokemon = (view: MatchViewState, item: ViewCardId) =>
  Object.values(view.stacks).find(
    (stack) => stack.evolutionCards.at(-1)?.id === item
  );

/** The Pokémon in play a card is part of, whole or attached. */
const pokemonHolding = (view: MatchViewState, cardId: ViewCardId) =>
  Object.values(view.stacks).find(
    (stack) =>
      stack.evolutionCards.some((card) => card.id === cardId) ||
      stack.attachmentCards.some((card) => card.id === cardId)
  );

const zoneOf = (
  view: MatchViewState,
  kind: MatchViewState['zones'][string]['kind'],
  ownerId: string
) =>
  Object.values(view.zones).find(
    (zone) => zone.kind === kind && zone.ownerId === ownerId
  );

/** One item, as it goes alone today: the single command its key or drag sends. */
const compileAlone = (
  context: SelectionContext,
  cardId: ViewCardId,
  action: GroupAction
): Resolution => {
  const { view, actingPlayerId: acting } = context;
  switch (action.kind) {
    case 'send':
      switch (action.to) {
        case 'deckTop':
          return resolveDeckRelativeCardAction(
            view,
            cardId,
            'moveToTop',
            acting
          );
        case 'deckBottom':
          return resolveDeckRelativeCardAction(
            view,
            cardId,
            'moveToBottom',
            acting
          );
        case 'deckShuffled':
          return resolveDeckRelativeCardAction(
            view,
            cardId,
            'shuffleIntoDeck',
            acting
          );
        default:
          return resolveCardZoneMoveAction(view, cardId, action.to, acting);
      }
    case 'play':
      return resolveCardPlayMoveAction(view, cardId, action.slot, acting);
    case 'stadium':
      return resolveCardStadiumMoveAction(view, cardId, undefined, acting);
    case 'drop':
      return resolveBoardDrop(
        view,
        context.scene,
        {
          kind: 'CardDropRequested',
          cardId,
          targetId: action.targetId,
          x: 0,
          y: 0,
          ...(action.index === undefined ? {} : { index: action.index }),
        },
        { eitherSeatsWindows: context.controlsEverySeat === true }
      );
    case 'damage':
      return resolveDamageKeyAction(view, cardId, action.delta);
    case 'clearDamage':
      return resolveStackStateAction(view, cardId, {
        type: 'setDamage',
        damage: null,
      });
    case 'condition':
      return resolveConditionKeyAction(view, cardId, action.remove);
    case 'ability':
      return resolveCardAnnotationAction(view, cardId, {
        type: 'toggleAbilityUsed',
      });
    case 'reveal':
      return resolvePublicCardVisibilityAction(view, cardId, action.revealed);
    case 'rotate':
      return resolveCardAnnotationAction(view, cardId, {
        type: 'rotate',
        single: action.single,
      });
  }
};

/** A Pokémon's pieces play as one; a Stadium's pieces in play are cards. */
const playUnits = (
  view: MatchViewState,
  items: readonly ViewCardId[]
): readonly GroupUnit[] =>
  partitionPieceSets(view, items).flatMap((unit): GroupUnit[] =>
    unit.kind === 'set' && unit.set.kind !== 'pokemon'
      ? unit.set.cardIds.map((cardId) => ({ kind: 'card', cardId }))
      : [unit]
  );

/** A piece put on a Pokémon: one in play, or the one an earlier step made. */
const pieceOnto = (
  steps: Steps,
  cardId: ViewCardId,
  target: { readonly stackId: string } | { readonly ref: number },
  onTopOf: ViewCardId
): Refusal | null => {
  const located = locateViewCardActionSource(steps.view(), cardId);
  if (!located) return refuse('stale_card', cardId);
  if (located.sourceKind === 'stack')
    return refuse('unsupported_source', cardId);
  const step: WireCardStep = {
    type: 'PlaceCardOnPlayStack',
    cardId,
    expectedSourceId: located.sourceId,
    ...('ref' in target
      ? { targetStackRef: target.ref }
      : { targetStackId: target.stackId }),
    expectedTargetTopCardId: onTopOf,
    mode: 'evolution',
  };
  return steps.add(step) ? null : refuse('unpredictable', cardId);
};

/** The pieces joining a Pokémon in play, in part order, each on the last. */
const joinPokemon = (
  steps: Steps,
  cardIds: readonly ViewCardId[],
  stackId: string
): Refusal | null => {
  for (const cardId of cardIds) {
    const top = steps.view().stacks[stackId]?.evolutionCards.at(-1);
    if (!top) return refuse('stale_target', cardId);
    const failed = pieceOnto(steps, cardId, { stackId }, top.id);
    if (failed) return failed;
  }
  return null;
};

/**
 * A Pokémon's pieces into play as one Pokémon: the first makes it (as it
 * would alone, `first`), the rest go on it in part order.
 */
const playPieceSet = (
  steps: Steps,
  set: PieceSet,
  first: (cardId: ViewCardId) => Resolution
): Refusal | null => {
  const [lead, ...rest] = set.cardIds;
  const resolution = first(lead!);
  if (!resolution.ok) return refuse(resolution.reason, lead);
  const command = resolution.command;
  if (!isCardStep(command) || !cardStepMakesPokemon(command))
    return refuse('unsupported_source', lead);
  if (!steps.add(command)) return refuse('unpredictable', lead);
  const ref = steps.list.length - 1;
  let onTopOf = lead!;
  for (const cardId of rest) {
    const failed = pieceOnto(steps, cardId, { ref }, onTopOf);
    if (failed) return failed;
    onTopOf = cardId;
  }
  return null;
};

/** `b` on pieces whose unfinished Pokémon is in play: they join it. */
const unfinishedFor = (
  view: MatchViewState,
  cardIds: readonly ViewCardId[]
): string | null => {
  const located = locateViewCardActionSource(view, cardIds[0]!);
  const piece = located ? cardPieceOf(view, located.card) : null;
  if (!located || !piece) return null;
  const parts = cardIds.map((cardId) => {
    const card = locateViewCardActionSource(view, cardId)?.card;
    return card ? cardPieceOf(view, card)?.part : undefined;
  });
  return parts.every((part) => part !== undefined)
    ? unfinishedPokemonFor(view, piece, parts, located.sourcePlayerId)
    : null;
};

/**
 * The seat a card's move acts for: at a Solo table that works both seats'
 * windows (`controlsEverySeat`), the seat whose window the card is in, as
 * turning the table to it would make it; otherwise the acting seat.
 */
const actingFor = (
  context: SelectionContext,
  view: MatchViewState,
  cardId: ViewCardId
): string | undefined => {
  if (context.controlsEverySeat !== true) return context.actingPlayerId;
  const located = locateViewCardActionSource(view, cardId);
  return located?.sourceKind === 'inspection' ||
    located?.sourceKind === 'staged'
    ? located.sourcePlayerId
    : context.actingPlayerId;
};

const compileSend = (
  context: SelectionContext,
  steps: Steps,
  items: readonly ViewCardId[],
  to: GroupPlace
): Refusal | null => {
  const shuffled: string[] = [];
  for (const item of items) {
    const view = steps.view();
    const stack = wholePokemon(view, item);
    const deckOwner =
      stack?.boardPlayerId ??
      locateViewCardActionSource(view, item)?.sourcePlayerId;
    if (to === 'deckShuffled' && deckOwner !== undefined) {
      const deck = zoneOf(view, 'deck', deckOwner);
      if (deck && !shuffled.includes(deck.id)) shuffled.push(deck.id);
    }
    let resolution: Resolution;
    if (stack) {
      // In a group, a Pokémon goes whole, with what is attached to it.
      const top = stack.evolutionCards.at(-1)!;
      const zone =
        to === 'hand' ||
        to === 'discard' ||
        to === 'lostZone' ||
        to === 'prizes'
          ? zoneOf(view, to, top.ownerId)
          : zoneOf(
              view,
              to === 'board' ? 'board' : 'deck',
              stack.boardPlayerId
            );
      if (!zone) return refuse('unsupported_target', item);
      resolution = {
        ok: true,
        command: {
          type: 'MovePlayStackToZone',
          stackId: stack.id,
          expectedEvolutionCardIds: stack.evolutionCards.map((card) => card.id),
          expectedAttachmentCardIds: stack.attachmentCards.map(
            (card) => card.id
          ),
          destinationZoneId: zone.id,
          ...(to === 'deckTop' || to === 'deckShuffled'
            ? { destinationIndex: 0 }
            : {}),
        },
      };
    } else if (
      to === 'deckTop' ||
      to === 'deckBottom' ||
      to === 'deckShuffled'
    ) {
      // Shuffled in: on top first, then each deck shuffled once.
      resolution = resolveDeckRelativeCardAction(
        view,
        item,
        to === 'deckBottom' ? 'moveToBottom' : 'moveToTop',
        actingFor(context, view, item)
      );
    } else {
      resolution = resolveCardZoneMoveAction(
        view,
        item,
        to,
        actingFor(context, view, item)
      );
    }
    const failed = take(steps, item, resolution);
    if (failed) return failed;
  }
  for (const zoneId of shuffled) steps.add({ type: 'ShuffleZone', zoneId });
  return null;
};

const compilePlay = (
  context: SelectionContext,
  steps: Steps,
  items: readonly ViewCardId[],
  slot: 'active' | 'bench'
): Refusal | null => {
  // Into play as each goes alone; a card being looked at in a window goes
  // as a drag puts it there (`MoveInspectedCardToPlay`), which the keys'
  // own resolver doesn't take.
  const played = (cardId: ViewCardId): Resolution => {
    const view = steps.view();
    const located = locateViewCardActionSource(view, cardId);
    if (located?.sourceKind !== 'inspection')
      return resolveCardPlayMoveAction(
        view,
        cardId,
        slot,
        actingFor(context, view, cardId)
      );
    const place = context.scene.zones.find(
      (zone) => zone.kind === slot && zone.playerId === located.card.ownerId
    );
    if (!place) return { ok: false, reason: 'unsupported_target' };
    return resolveBoardDrop(
      view,
      context.scene,
      { kind: 'CardDropRequested', cardId, targetId: place.id, x: 0, y: 0 },
      { eitherSeatsWindows: context.controlsEverySeat === true }
    );
  };
  const units = playUnits(context.view, items);
  if (slot === 'active' && units.length > 1) return refuse('one_active');
  for (const unit of units) {
    const cardIds = unit.kind === 'set' ? unit.set.cardIds : [unit.cardId];
    if (unit.kind === 'card' && wholePokemon(steps.view(), unit.cardId))
      return refuse('pokemon_to_play', unit.cardId);
    const unfinished =
      slot === 'bench' ? unfinishedFor(steps.view(), cardIds) : null;
    const failed = unfinished
      ? joinPokemon(steps, cardIds, unfinished)
      : unit.kind === 'set'
        ? playPieceSet(steps, unit.set, played)
        : take(steps, unit.cardId, played(unit.cardId));
    if (failed) return failed;
  }
  return null;
};

const compileStadium = (
  context: SelectionContext,
  steps: Steps,
  items: readonly ViewCardId[]
): Refusal | null => {
  const units = partitionPieceSets(context.view, items);
  const unit = units[0];
  if (units.length !== 1 || !unit || unit.kind !== 'set')
    return refuse('one_stadium');
  for (const cardId of unit.set.cardIds) {
    const failed = take(
      steps,
      cardId,
      resolveCardStadiumMoveAction(
        steps.view(),
        cardId,
        undefined,
        actingFor(context, steps.view(), cardId)
      )
    );
    if (failed) return failed;
  }
  return null;
};

/**
 * Where among a zone's cards each item goes, so the group lies at the
 * place it was dropped, in its order, among the cards that stay: each goes
 * just after the last card already there that comes before it.
 */
const placeAmong = (
  context: SelectionContext,
  steps: Steps,
  zoneId: string,
  items: readonly ViewCardId[],
  index: number,
  item: ViewCardId
): number => {
  const moving = new Set<string>(items);
  const staying = (context.view.zones[zoneId]?.cards ?? [])
    .map((card) => card.id)
    .filter((id) => !moving.has(id));
  const at = Math.max(0, Math.min(index, staying.length));
  const order: readonly string[] = [
    ...staying.slice(0, at),
    ...items,
    ...staying.slice(at),
  ];
  const before = new Set(order.slice(0, order.indexOf(item)));
  const current = (steps.view().zones[zoneId]?.cards ?? [])
    .map((card) => card.id)
    .filter((id) => id !== item);
  let place = 0;
  current.forEach((id, position) => {
    if (before.has(id)) place = position + 1;
  });
  return place;
};

const compileDrop = (
  context: SelectionContext,
  steps: Steps,
  items: readonly ViewCardId[],
  targetId: string,
  index: number | undefined
): Refusal | null => {
  const { view, scene } = context;
  const drop = (cardId: ViewCardId, at?: number): Resolution =>
    resolveBoardDrop(
      steps.view(),
      scene,
      {
        kind: 'CardDropRequested',
        cardId,
        targetId,
        x: 0,
        y: 0,
        ...(at === undefined ? {} : { index: at }),
      },
      { eitherSeatsWindows: context.controlsEverySeat === true }
    );
  const zone = view.zones[targetId];
  if (zone?.kind === 'stadium') return compileStadium(context, steps, items);
  if (zone) {
    const arranged = index !== undefined && ARRANGED_ZONE_KINDS.has(zone.kind);
    for (const item of items) {
      const failed = take(
        steps,
        item,
        drop(
          item,
          arranged
            ? placeAmong(context, steps, zone.id, items, index, item)
            : undefined
        )
      );
      if (failed) return failed;
    }
    return null;
  }
  const target = view.stacks[targetId];
  if (target) return compileOntoPokemon(context, steps, items, target.id, drop);
  const slot = scene.zones.find((candidate) => candidate.id === targetId);
  if (slot?.kind !== 'active' && slot?.kind !== 'bench') {
    return refuse(
      slot?.kind === 'inspection' || slot?.kind === 'attachmentResolution'
        ? 'unsupported_target'
        : 'stale_target'
    );
  }
  const units = playUnits(view, items);
  if (slot.kind === 'active' && units.length > 1) return refuse('one_active');
  for (const [position, unit] of units.entries()) {
    // Each new Pokémon on the Bench after the last, from where it was let go.
    const at =
      slot.kind === 'bench' && index !== undefined
        ? index + position
        : undefined;
    if (unit.kind === 'card' && wholePokemon(steps.view(), unit.cardId))
      return refuse('pokemon_to_play', unit.cardId);
    const failed =
      unit.kind === 'set'
        ? playPieceSet(steps, unit.set, (cardId) => drop(cardId, at))
        : take(steps, unit.cardId, drop(unit.cardId, at));
    if (failed) return failed;
  }
  return null;
};

/**
 * Onto a Pokémon: cards it takes as attachments, and its own print's
 * missing pieces. A Pokémon, whole or a card to evolve with, goes on one
 * alone.
 */
const compileOntoPokemon = (
  context: SelectionContext,
  steps: Steps,
  items: readonly ViewCardId[],
  stackId: string,
  drop: (cardId: ViewCardId) => Resolution
): Refusal | null => {
  const view = context.view;
  const target = view.stacks[stackId]!;
  const pieces = target.evolutionCards.map((card) => cardPieceOf(view, card));
  const targetPiece = pieces.at(-1) ?? null;
  const parts = new Set<number>();
  for (const piece of pieces) if (piece) parts.add(piece.part);
  for (const item of items) {
    if (wholePokemon(view, item)) return refuse('attachments_only', item);
    const card = locateViewCardActionSource(view, item)?.card;
    if (!card) return refuse('stale_card', item);
    const piece = cardPieceOf(view, card);
    const joins =
      piece !== null &&
      targetPiece !== null &&
      piece.key === targetPiece.key &&
      piece.columns === targetPiece.columns &&
      piece.rows === targetPiece.rows &&
      !parts.has(piece.part);
    if (joins) {
      parts.add(piece.part);
      continue;
    }
    if (card.kind !== 'known' || card.category === 'Pokémon')
      return refuse('attachments_only', item);
  }
  for (const item of items) {
    const failed = take(steps, item, drop(item));
    if (failed) return failed;
  }
  return null;
};

/**
 * The Pokémon in play each item is, or is attached to, once each in the
 * order they came: damage and a Special Condition go on a Pokémon.
 */
const pokemonOfItems = (
  view: MatchViewState,
  items: readonly ViewCardId[]
):
  | { readonly stacks: readonly MatchViewState['stacks'][string][] }
  | Refusal => {
  const stacks: MatchViewState['stacks'][string][] = [];
  for (const item of items) {
    const stack = pokemonHolding(view, item);
    if (!stack) return refuse('not_in_play', item);
    if (!stacks.includes(stack)) stacks.push(stack);
  }
  return { stacks };
};

const compileAnnotation = (
  context: SelectionContext,
  steps: Steps,
  items: readonly ViewCardId[],
  action: Extract<
    GroupAction,
    {
      readonly kind:
        | 'damage'
        | 'clearDamage'
        | 'condition'
        | 'ability'
        | 'reveal'
        | 'rotate';
    }
  >
): Refusal | null => {
  const view = context.view;
  switch (action.kind) {
    case 'damage':
    case 'clearDamage':
    case 'condition': {
      const found = pokemonOfItems(view, items);
      if ('reason' in found) return found;
      if (action.kind === 'condition') {
        const benched = found.stacks.find((stack) => stack.slot !== 'active');
        if (benched)
          return refuse(
            'active_only',
            items.find((item) => pokemonHolding(view, item) === benched)
          );
      }
      for (const stack of found.stacks) {
        const top = stack.evolutionCards.at(-1)!.id;
        const failed = take(
          steps,
          top,
          resolveStackStateAction(
            steps.view(),
            top,
            action.kind === 'damage'
              ? { type: 'adjustDamage', delta: action.delta }
              : action.kind === 'clearDamage'
                ? { type: 'setDamage', damage: null }
                : action.remove
                  ? { type: 'setSpecialCondition', condition: null }
                  : { type: 'cycleSpecialCondition' }
          )
        );
        if (failed) return failed;
      }
      return null;
    }
    case 'ability': {
      // All marked, unless every one is already: then all cleared.
      const used = !items.every((item) => {
        const stack = wholePokemon(view, item);
        if (stack) return stack.abilityUsed;
        const card = locateViewCardActionSource(view, item)?.card;
        return card?.kind === 'known' && card.abilityUsed;
      });
      for (const item of items) {
        const failed = take(
          steps,
          item,
          resolveCardAnnotationAction(steps.view(), item, {
            type: 'setAbilityUsed',
            used,
          })
        );
        if (failed) return failed;
      }
      return null;
    }
    case 'reveal':
    case 'rotate': {
      // `r` turns each Pokémon once, however many of its cards are picked:
      // two Energy on one Pokémon would turn it twice, four all the way
      // round. Alt+`r` turns each card on its own.
      const turned = new Set<string>();
      for (const item of items) {
        const resolution =
          action.kind === 'reveal'
            ? resolvePublicCardVisibilityAction(
                steps.view(),
                item,
                action.revealed
              )
            : resolveCardAnnotationAction(steps.view(), item, {
                type: 'rotate',
                single: action.single,
              });
        if (resolution.ok && resolution.command.type === 'RotateStack') {
          if (turned.has(resolution.command.stackId)) continue;
          turned.add(resolution.command.stackId);
        }
        const failed = take(steps, item, resolution);
        if (failed) return failed;
      }
      return null;
    }
  }
};

/**
 * A group's one move (ADR-042 §3-5): every item's own single command, in
 * the order they were selected (item 1 lands first), each expecting the
 * table the ones before it leave, sent as one `ApplyCardSteps` -- one
 * undo step. Destinations are each item's owner's, as each goes alone; a
 * Pokémon in a group goes whole; pieces of one print play as one card;
 * items already there are left out. One item compiles to the single
 * command it sends today.
 */
export const compileGroup = (
  context: SelectionContext,
  selection: readonly ViewCardId[],
  action: GroupAction
): GroupCompilation => {
  if (context.view.viewer.kind !== 'player') return refuse('not_player');
  const { items, refused } = normalizeSelection(context, selection);
  const first = refused[0];
  if (first) return refuse(first.reason, first.cardId);
  if (items.length === 0) return refuse('empty');
  const steps = createSteps(context);
  if (items.length === 1) {
    const item = items[0]!;
    // `b` on a lone piece joins its unfinished Pokémon; anything else
    // goes as it does alone.
    const unfinished =
      action.kind === 'play' && action.slot === 'bench'
        ? unfinishedFor(context.view, [item])
        : null;
    if (!unfinished) {
      const resolution = compileAlone(context, item, action);
      return resolution.ok
        ? { ok: true, command: resolution.command, skipped: [] }
        : refuse(resolution.reason, item);
    }
    const failed = joinPokemon(steps, [item], unfinished);
    if (failed) return failed;
  } else {
    const failed =
      action.kind === 'send'
        ? compileSend(context, steps, items, action.to)
        : action.kind === 'play'
          ? compilePlay(context, steps, items, action.slot)
          : action.kind === 'stadium'
            ? compileStadium(context, steps, items)
            : action.kind === 'drop'
              ? compileDrop(
                  context,
                  steps,
                  items,
                  action.targetId,
                  action.index
                )
              : compileAnnotation(context, steps, items, action);
    if (failed) return failed;
  }
  const list = steps.list;
  if (list.length === 0 || list.every((step) => step.type === 'ShuffleZone'))
    return refuse('no_op');
  if (list.length > MAX_CARD_STEPS) return refuse('too_many_steps');
  return {
    ok: true,
    // One step left stands alone: it names no step before it.
    command:
      list.length === 1
        ? (list[0] as WireGameCommand)
        : { type: 'ApplyCardSteps', steps: list },
    skipped: steps.skipped,
  };
};
