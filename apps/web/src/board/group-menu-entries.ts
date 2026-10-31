import { plural, t } from '@lingui/core/macro';
import type { ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import { chordHint, detectKeyboardPlatform } from '../hotkeys/chords.js';
import type { HotkeyActionId } from '../hotkeys/hotkey-catalogue.js';
import { DEFAULT_KEYMAP } from '../hotkeys/keymap.js';
import {
  compileGroup,
  type GroupAction,
  type GroupPlace,
} from './compile-group.js';
import { locateViewCardActionSource } from './locateViewCardActionSource.js';
import { partitionPieceSets, visiblePieceSetOf } from './piece-sets.js';
import { normalizeSelection, type SelectionContext } from './selection.js';

/**
 * The group menu as data (ADR-042 §3, "The group menu"): what a selection
 * of several items can do, worded as it would be done. The table's menu
 * (right-click or a long press on a selected item, the group bar's Move…)
 * and the palette's "Selected cards" section show the same list.
 */
export type GroupMenuSection = 'move' | 'annotate' | 'play' | 'selection';

export interface GroupMenuEntry {
  /**
   * Stable, for tests and React keys: `send:discard`, `play:bench`,
   * `damage:add`, `playAsOne`, `deselect`…
   */
  readonly id: string;
  readonly section: GroupMenuSection;
  /** State-true and counted: "Discard 3 cards", "Hide 2 cards". */
  readonly label: string;
  /** A second line where the order matters: "3 ends on top". */
  readonly detail?: string;
  /** The key that does the same, as the shortcuts dialog writes it. */
  readonly shortcut?: string;
  /**
   * What choosing it does: an action for the whole selection
   * (`emitGroupAction`); a picker first (Damage… opens the stepper,
   * Attach to… asks for the Pokémon: `groupAttachTargets`); the pieces
   * played as one card (select `playAsOneSelection`, then offer where
   * they go); or the selection put down.
   */
  readonly run:
    | { readonly kind: 'action'; readonly action: GroupAction }
    | { readonly kind: 'picker'; readonly picker: 'damage' | 'attachTarget' }
    | { readonly kind: 'playAsOne' }
    | { readonly kind: 'deselect' };
}

export interface GroupMenu {
  /** "3 cards", or "3 of Red's cards" when it holds the other seat's. */
  readonly header: string;
  readonly entries: readonly GroupMenuEntry[];
}

export interface GroupMenuOptions {
  /**
   * The key for a shortcut as the player has it (their keymap); v1's keys
   * by default.
   */
  readonly hint?: (id: HotkeyActionId) => string | undefined;
}

const defaultHint = (id: HotkeyActionId): string | undefined => {
  const chord = DEFAULT_KEYMAP.chord(id);
  return chord ? chordHint(chord, detectKeyboardPlatform()) : undefined;
};

/** The steps a compiled group sends: one command, or a batch of them. */
const stepsOf = (command: WireGameCommand): readonly WireGameCommand[] =>
  command.type === 'ApplyCardSteps'
    ? (command.steps as readonly WireGameCommand[])
    : [command];

const SEND_PLACES: readonly GroupPlace[] = [
  'hand',
  'discard',
  'lostZone',
  'prizes',
  'board',
  'deckTop',
  'deckBottom',
  'deckShuffled',
];

const SEND_SHORTCUTS: Readonly<Record<GroupPlace, HotkeyActionId>> = {
  hand: 'card.toHand',
  discard: 'card.toDiscard',
  lostZone: 'card.toLostZone',
  prizes: 'card.toPrizes',
  board: 'card.toBoard',
  deckTop: 'card.toDeckTop',
  deckBottom: 'card.toDeckBottom',
  deckShuffled: 'card.shuffleIntoDeck',
};

/** Piles where the order rule puts the last-numbered card on top. */
const ENDS_ON_TOP: ReadonlySet<GroupPlace> = new Set([
  'discard',
  'lostZone',
  'prizes',
  'deckTop',
]);

/** "Discard 3 cards", "Discard 2 Pokémon": where a group goes. */
const sendLabel = (to: GroupPlace, count: number, pokemon: boolean): string => {
  switch (to) {
    case 'hand':
      return pokemon
        ? plural(count, { other: 'Move # Pokémon to hand' })
        : plural(count, {
            one: 'Move # card to hand',
            other: 'Move # cards to hand',
          });
    case 'discard':
      return pokemon
        ? plural(count, { other: 'Discard # Pokémon' })
        : plural(count, { one: 'Discard # card', other: 'Discard # cards' });
    case 'lostZone':
      return pokemon
        ? plural(count, { other: 'Put # Pokémon in the Lost Zone' })
        : plural(count, {
            one: 'Put # card in the Lost Zone',
            other: 'Put # cards in the Lost Zone',
          });
    case 'prizes':
      return pokemon
        ? plural(count, { other: 'Put # Pokémon in the Prizes' })
        : plural(count, {
            one: 'Put # card in the Prizes',
            other: 'Put # cards in the Prizes',
          });
    case 'board':
      return pokemon
        ? plural(count, { other: 'Put # Pokémon on the board' })
        : plural(count, {
            one: 'Put # card on the board',
            other: 'Put # cards on the board',
          });
    case 'deckTop':
      return pokemon
        ? plural(count, { other: 'Put # Pokémon on top of the deck' })
        : plural(count, {
            one: 'Put # card on top of the deck',
            other: 'Put # cards on top of the deck',
          });
    case 'deckBottom':
      return pokemon
        ? plural(count, { other: 'Put # Pokémon on the bottom of the deck' })
        : plural(count, {
            one: 'Put # card on the bottom of the deck',
            other: 'Put # cards on the bottom of the deck',
          });
    case 'deckShuffled':
      return pokemon
        ? plural(count, { other: 'Shuffle # Pokémon into the deck' })
        : plural(count, {
            one: 'Shuffle # card into the deck',
            other: 'Shuffle # cards into the deck',
          });
  }
};

/** The name a card goes by on the table, when the viewer sees its face. */
const nameOf = (
  context: SelectionContext,
  cardId: ViewCardId
): string | undefined => {
  const card = context.scene.cards.find((candidate) => candidate.id === cardId);
  return card && !card.concealed && card.label ? card.label : undefined;
};

/** The Pokémon in play an item is whole, when it is one. */
const wholePokemon = (context: SelectionContext, item: ViewCardId) =>
  Object.values(context.view.stacks).find(
    (stack) => stack.evolutionCards.at(-1)?.id === item
  );

/**
 * The pieces "Play as one card" selects for a selection (ADR-042 §5): the
 * first loose piece whose print has other pieces in sight -- where it
 * lies, its owner's hand and discard pile, the open pile -- that are not
 * all selected already. Null when no piece has more to bring. The menu
 * selects them (`CardsSelected`, `replace`) and then offers where they go.
 */
export const playAsOneSelection = (
  context: SelectionContext,
  selection: readonly ViewCardId[]
): readonly ViewCardId[] | null => {
  for (const item of selection) {
    const set = visiblePieceSetOf(context.view, item, context.openedZoneId);
    if (set && set.cardIds.some((cardId) => !selection.includes(cardId)))
      return set.cardIds;
  }
  return null;
};

/**
 * The Pokémon in play every selected card can go on (Attach to…, `q`/`e`),
 * Active first, then the Bench, each seat in turn.
 */
export const groupAttachTargets = (
  context: SelectionContext,
  selection: readonly ViewCardId[]
): readonly { readonly stackId: string; readonly topCardId: ViewCardId }[] => {
  const { view } = context;
  return view.playerOrder.flatMap((playerId) => {
    const board = view.boards[playerId];
    if (!board) return [];
    return [
      ...(board.activeStackId ? [board.activeStackId] : []),
      ...board.benchStackIds,
    ].flatMap((stackId) => {
      const topCardId = view.stacks[stackId]?.evolutionCards.at(-1)?.id;
      return topCardId &&
        compileGroup(context, selection, { kind: 'drop', targetId: stackId }).ok
        ? [{ stackId, topCardId }]
        : [];
    });
  });
};

/**
 * The menu for this selection, built from `compileGroup` so it offers only
 * what the group can do; null for none or one item (one card keeps its own
 * menu).
 */
export const groupMenuOf = (
  context: SelectionContext,
  selection: readonly ViewCardId[],
  options: GroupMenuOptions = {}
): GroupMenu | null => {
  const { view } = context;
  const items = normalizeSelection(context, selection).items;
  if (items.length < 2 || view.viewer.kind !== 'player') return null;
  const hint = options.hint ?? defaultHint;
  const shortcutOf = (id: HotkeyActionId) => {
    const key = hint(id);
    return key ? { shortcut: key } : {};
  };
  const tryAction = (action: GroupAction) => {
    const compiled = compileGroup(context, items, action);
    return compiled.ok ? compiled : null;
  };
  const entries: GroupMenuEntry[] = [];
  const pokemon = items.every((item) => wholePokemon(context, item));
  const attached = items.some(
    (item) => (wholePokemon(context, item)?.attachmentCards.length ?? 0) > 0
  );

  // ---- Moves, each item to its owner's place ---------------------------
  for (const to of SEND_PLACES) {
    const compiled = tryAction({ kind: 'send', to });
    if (!compiled) continue;
    const skipped = new Set<ViewCardId>(compiled.skipped);
    const moving = items.filter((item) => !skipped.has(item));
    // The highest-numbered card that moves ends on top of the pile.
    const last = items.indexOf(moving.at(-1)!) + 1;
    const detail = ENDS_ON_TOP.has(to)
      ? t`${last} ends on top`
      : pokemon && attached
        ? t`With their attached cards`
        : undefined;
    entries.push({
      id: `send:${to}`,
      section: 'move',
      label: sendLabel(to, moving.length, pokemon),
      ...(detail ? { detail } : {}),
      ...shortcutOf(SEND_SHORTCUTS[to]),
      run: { kind: 'action', action: { kind: 'send', to } },
    });
  }
  if (groupAttachTargets(context, items).length > 0) {
    entries.push({
      id: 'attach',
      section: 'move',
      label: t`Attach to a Pokémon…`,
      ...shortcutOf('card.attach'),
      run: { kind: 'picker', picker: 'attachTarget' },
    });
  }

  // ---- Into play --------------------------------------------------------
  const units = partitionPieceSets(view, items);
  const unitName = (): string | undefined => {
    const unit = units[0];
    if (!unit) return undefined;
    return nameOf(
      context,
      unit.kind === 'set' ? unit.set.cardIds[0]! : unit.cardId
    );
  };
  if (tryAction({ kind: 'play', slot: 'bench' })) {
    const name = units.length === 1 ? unitName() : undefined;
    entries.push({
      id: 'play:bench',
      section: 'play',
      label: name
        ? t`Put ${name} on the Bench`
        : plural(units.length, { other: 'Put # Pokémon on the Bench' }),
      ...shortcutOf('card.toBench'),
      run: { kind: 'action', action: { kind: 'play', slot: 'bench' } },
    });
  }
  if (tryAction({ kind: 'play', slot: 'active' })) {
    const name = unitName();
    entries.push({
      id: 'play:active',
      section: 'play',
      label: name
        ? t`Put ${name} in the Active Spot`
        : t`Put in the Active Spot`,
      ...shortcutOf('card.toActive'),
      run: { kind: 'action', action: { kind: 'play', slot: 'active' } },
    });
  }
  if (tryAction({ kind: 'stadium' })) {
    const name = unitName();
    entries.push({
      id: 'stadium',
      section: 'play',
      label: name ? t`Play ${name} as the Stadium` : t`Play as the Stadium`,
      ...shortcutOf('card.toStadium'),
      run: { kind: 'action', action: { kind: 'stadium' } },
    });
  }
  if (playAsOneSelection(context, items)) {
    entries.push({
      id: 'playAsOne',
      section: 'play',
      label: t`Play as one card`,
      run: { kind: 'playAsOne' },
    });
  }

  // ---- Marks, once on each Pokémon or card ------------------------------
  const marked = (action: GroupAction): number | null => {
    const compiled = tryAction(action);
    return compiled ? stepsOf(compiled.command).length : null;
  };
  const damaged = marked({ kind: 'damage', delta: 10 });
  if (damaged !== null) {
    entries.push(
      {
        id: 'damage:add',
        section: 'annotate',
        label: plural(damaged, {
          one: 'Add 10 damage',
          other: 'Add 10 damage to each of #',
        }),
        ...shortcutOf('card.addDamage'),
        run: { kind: 'action', action: { kind: 'damage', delta: 10 } },
      },
      {
        id: 'damage',
        section: 'annotate',
        label: t`Damage…`,
        run: { kind: 'picker', picker: 'damage' },
      }
    );
  }
  const cleared = marked({ kind: 'clearDamage' });
  if (cleared !== null) {
    entries.push({
      id: 'damage:clear',
      section: 'annotate',
      label: plural(cleared, {
        one: 'Clear damage',
        other: 'Clear damage on #',
      }),
      ...shortcutOf('card.clearDamage'),
      run: { kind: 'action', action: { kind: 'clearDamage' } },
    });
  }
  const conditioned = marked({ kind: 'condition', remove: false });
  if (conditioned !== null) {
    entries.push({
      id: 'condition:add',
      section: 'annotate',
      label: plural(conditioned, {
        one: 'Add or switch Special Condition',
        other: 'Add or switch Special Conditions on #',
      }),
      ...shortcutOf('card.addCondition'),
      run: { kind: 'action', action: { kind: 'condition', remove: false } },
    });
  }
  const cured = marked({ kind: 'condition', remove: true });
  if (cured !== null) {
    entries.push({
      id: 'condition:remove',
      section: 'annotate',
      label: plural(cured, {
        one: 'Remove Special Condition',
        other: 'Remove Special Conditions on #',
      }),
      ...shortcutOf('card.removeCondition'),
      run: { kind: 'action', action: { kind: 'condition', remove: true } },
    });
  }
  const ability = tryAction({ kind: 'ability' });
  if (ability) {
    const steps = stepsOf(ability.command);
    // All marked, unless every one is already (compile-group's rule).
    const marks = steps.some(
      (step) =>
        (step.type === 'SetAbilityUsed' ||
          step.type === 'SetCardAbilityUsed') &&
        step.used
    );
    entries.push({
      id: 'ability',
      section: 'annotate',
      label: marks
        ? plural(steps.length, { other: 'Mark # as used' })
        : plural(steps.length, { other: 'Mark # as unused' }),
      ...shortcutOf('card.toggleAbility'),
      run: { kind: 'action', action: { kind: 'ability' } },
    });
  }
  const revealed = marked({ kind: 'reveal', revealed: true });
  if (revealed !== null) {
    entries.push({
      id: 'reveal',
      section: 'annotate',
      label: plural(revealed, {
        one: 'Reveal # card',
        other: 'Reveal # cards',
      }),
      ...shortcutOf('card.reveal'),
      run: { kind: 'action', action: { kind: 'reveal', revealed: true } },
    });
  }
  const hidden = marked({ kind: 'reveal', revealed: false });
  if (hidden !== null) {
    entries.push({
      id: 'hide',
      section: 'annotate',
      label: plural(hidden, { one: 'Hide # card', other: 'Hide # cards' }),
      ...shortcutOf('card.hide'),
      run: { kind: 'action', action: { kind: 'reveal', revealed: false } },
    });
  }
  const rotated = marked({ kind: 'rotate', single: false });
  if (rotated !== null) {
    entries.push({
      id: 'rotate',
      section: 'annotate',
      label: plural(rotated, { one: 'Rotate # card', other: 'Rotate # cards' }),
      ...shortcutOf('card.rotate'),
      run: { kind: 'action', action: { kind: 'rotate', single: false } },
    });
  }

  entries.push({
    id: 'deselect',
    section: 'selection',
    label: t`Deselect`,
    ...shortcutOf('table.closePopups'),
    run: { kind: 'deselect' },
  });

  // "3 of Red's cards" when every one is the other seat's.
  const viewerId = view.viewer.playerId;
  const owners = new Set(
    items.map(
      (item) => locateViewCardActionSource(view, item)?.card.ownerId ?? viewerId
    )
  );
  const [owner] = owners;
  const seat = context.actingPlayerId ?? viewerId;
  const ownerName =
    owners.size === 1 && owner !== undefined && owner !== seat
      ? view.players[owner]?.displayName
      : undefined;
  const count = items.length;
  return {
    header: ownerName
      ? plural(count, {
          one: `# of ${ownerName}'s cards`,
          other: `# of ${ownerName}'s cards`,
        })
      : plural(count, { one: '# card', other: '# cards' }),
    entries,
  };
};
