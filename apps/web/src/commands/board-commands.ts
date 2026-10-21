import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { ArrowsDownUpIcon } from '@phosphor-icons/react/dist/csr/ArrowsDownUp';
import { BinocularsIcon } from '@phosphor-icons/react/dist/csr/Binoculars';
import { CardsIcon } from '@phosphor-icons/react/dist/csr/Cards';
import { CoinIcon } from '@phosphor-icons/react/dist/csr/Coin';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { FirstAidIcon } from '@phosphor-icons/react/dist/csr/FirstAid';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { HandIcon } from '@phosphor-icons/react/dist/csr/Hand';
import { HeartBreakIcon } from '@phosphor-icons/react/dist/csr/HeartBreak';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { ShuffleIcon } from '@phosphor-icons/react/dist/csr/Shuffle';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import type { Icon } from '@phosphor-icons/react';
import type { ViewCardId } from '@ptcgsim/game-core';
import {
  markerHint,
  type BoardIntent,
  type CardSceneNode,
  type ZoneSceneNode,
} from '@ptcgsim/renderer-contract';

import type {
  BoardActionOrigin,
  BoardSessionControllerState,
  OpenedZoneCardIntent,
} from '../board/BoardSessionController.js';
import { actingPlayerIdOf } from '../board/acting-seat.js';
import { selectLegacyContextEntries } from '../board/overlays/LegacyBoardOverlays.js';
import {
  CONDITION_CODES,
  CONDITIONS,
} from '../board/overlays/MarkerControls.js';
import type {
  LegacyBoardContextActionId,
  LegacyBoardOverlayActionRequest,
} from '../board/resolveLegacyBoardOverlayAction.js';
import {
  resolveLegacyBoardShortcutAction,
  resolveLegacyBoardShortcutKey,
  type LegacyBoardShortcutActionRequest,
} from '../board/resolveLegacyBoardShortcutAction.js';
import { parseChord } from '../hotkeys/chords.js';
import {
  HOTKEY_ACTIONS,
  type HotkeyActionId,
} from '../hotkeys/hotkey-catalogue.js';
import { inputForChord } from '../hotkeys/keymap.js';
import type { CommandSection, PaletteCommand } from './types.js';

/** What the table's commands need of its runtime. */
export interface BoardCommandRuntime {
  readonly getBoardSnapshot: () => BoardSessionControllerState | undefined;
  readonly emitIntent: (intent: BoardIntent) => unknown;
  /** For a card in the pile that is open. */
  readonly emitOpenedZoneCardIntent: (intent: OpenedZoneCardIntent) => unknown;
  readonly emitLegacyShortcutAction: (
    request: LegacyBoardShortcutActionRequest,
    origin?: BoardActionOrigin
  ) => boolean;
  readonly emitLegacyOverlayAction: (
    request: LegacyBoardOverlayActionRequest,
    origin?: BoardActionOrigin
  ) => boolean;
  readonly declareDeckView: (actingPlayerId?: string) => unknown;
}

export interface BoardCommandContext {
  readonly runtime: BoardCommandRuntime;
  /** The key for an action, from the player's keymap. */
  readonly hint: (id: HotkeyActionId) => string | undefined;
}

/** The most cards a palette count asks for at once (the room caps at 200). */
const MAX_COUNT = 60;
/** The most damage a Pokémon can carry (the room's limit). */
const MAX_DAMAGE = 9_990;

type Shortcut = LegacyBoardShortcutActionRequest;

/**
 * The commands the table owns (ADR-035 §3): the selected card's actions,
 * the acting seat's deck and hand, every card face up on the table and
 * what it can do, the piles of both seats and the coins. Each runs through
 * the controller the same way its key or menu entry does, named outright
 * (`origin: 'palette'`), and is listed only when the controller would take
 * it now.
 */
export const boardCommands = (
  context: BoardCommandContext
): PaletteCommand[] => {
  const state = context.runtime.getBoardSnapshot();
  const view = state?.view;
  const scene = state?.scene;
  if (!state || !view || !scene || state.sessionPhase !== 'ready') return [];
  const acting = actingPlayerIdOf(view, scene.bottomPlayerId);
  const live = state.canSubmitCommands && acting !== undefined;
  const { runtime, hint } = context;

  const accepts = (request: Shortcut): boolean => {
    if (!live) return false;
    try {
      return resolveLegacyBoardShortcutAction(view, request, acting).ok;
    } catch {
      return false;
    }
  };
  const shortcut = (request: Shortcut) => () => {
    runtime.emitLegacyShortcutAction(request, 'palette');
  };
  const overlay = (request: LegacyBoardOverlayActionRequest) => () => {
    runtime.emitLegacyOverlayAction(request, 'palette');
  };
  const seatName = (playerId: string | null | undefined): string | undefined =>
    playerId ? view.players[playerId]?.displayName : undefined;
  const cardName = (cardId: string): string =>
    scene.cards.find((card) => card.id === cardId)?.label ?? '';

  /** Where a card lies, as a player reads it: "Your Bench", "Attached to Pikachu". */
  const placeOf = (card: CardSceneNode): string => {
    const stack = view.stacks[card.parentId];
    if (stack) {
      if (card.role === 'stackAttachment') {
        const top = stack.evolutionCards.at(-1);
        return t`Attached to ${top ? cardName(top.id) : ''}`;
      }
      const own = stack.boardPlayerId === acting;
      if (stack.slot === 'active')
        return own ? t`Your Active Spot` : t`Their Active Spot`;
      return own ? t`Your Bench` : t`Their Bench`;
    }
    const zone = view.zones[card.parentId];
    const own = zone?.ownerId === acting;
    switch (zone?.kind) {
      case 'hand':
        return own ? t`Your hand` : t`Their hand`;
      case 'discard':
        return own ? t`Your discard pile` : t`Their discard pile`;
      case 'lostZone':
        return own ? t`Your Lost Zone` : t`Their Lost Zone`;
      case 'stadium':
        return t({ message: 'Stadium', context: 'zone' });
      case 'board':
        return own ? t`Your playboard` : t`Their playboard`;
      case 'prizes':
        return own ? t`Your Prizes` : t`Their Prizes`;
      case 'deck':
        return own ? t`Your deck` : t`Their deck`;
      default:
        return '';
    }
  };

  // ---- A card's actions -------------------------------------------------

  /**
   * Everything a card can do: its keys (to hand, to the Bench, rotate,
   * look…) checked by the resolver its key goes through, and from its menu
   * the values a key can't set (damage, a Special Condition).
   */
  const cardCommands = (
    card: CardSceneNode,
    prefix: string,
    section: CommandSection
  ): PaletteCommand[] => {
    const commands: PaletteCommand[] = [];
    const detail = card.label;
    // A closed pile's buried card is shown over its pile, opened for it.
    const pile = card.interactive
      ? undefined
      : scene.zones.find(
          (zone) => zone.id === card.parentId && zone.interactive
        );
    // A face-down card's own face is not the viewer's to see.
    if (!card.concealed && (card.interactive || pile)) {
      commands.push({
        id: `${prefix}.view`,
        title: t`Show the card`,
        section,
        detail,
        icon: EyeIcon,
        hint: hint('card.view'),
        keywords: ['view', 'preview', 'zoom', 'read'],
        run: () => {
          if (!pile) {
            runtime.emitIntent({
              kind: 'CardPreviewRequested',
              cardId: card.id,
            });
            return;
          }
          runtime.emitIntent({ kind: 'ZoneOpened', zoneId: pile.id });
          runtime.emitOpenedZoneCardIntent({
            kind: 'CardPreviewRequested',
            cardId: card.id,
          });
        },
      });
    }
    if (!live) return commands;
    // A card picked out by the player (a face-down Prize, selected) does
    // what its keys would: the resolver says which. Taking a condition off
    // is offered below, only where there is one: Alt+Y alone puts Poisoned
    // on a Pokémon with none, as v1's does.
    for (const entry of HOTKEY_ACTIONS) {
      if (
        entry.scope !== 'card' ||
        'digits' in entry ||
        entry.id === 'card.view' ||
        entry.id === 'card.removeCondition'
      )
        continue;
      const chord = parseChord(entry.defaultChord);
      if (!chord) continue;
      const request = resolveLegacyBoardShortcutKey(
        inputForChord(chord),
        card.id
      );
      if (!request || !accepts(request)) continue;
      commands.push({
        id: `${prefix}.${entry.id.replace(/^card\./u, '')}`,
        title: i18n._(entry.label),
        section,
        detail,
        icon: cardActionIcon(entry.id),
        hint: hint(entry.id),
        run: shortcut(request),
      });
    }
    // Damage by any amount; v1's number keys step it by tens. Taking off
    // sets what is left, so it never reaches v1's Alt+number quirk of
    // putting the amount on a Pokémon that had none.
    const damage = view.stacks[card.parentId]?.damage ?? 0;
    if (accepts({ action: 'adjustDamage', cardId: card.id, delta: 10 })) {
      commands.push({
        id: `${prefix}.addDamage`,
        title: t`Add damage…`,
        section,
        detail,
        icon: HeartBreakIcon,
        keywords: ['damage', 'counter', 'hp'],
        count: {
          label: t`How much damage?`,
          min: 10,
          max: MAX_DAMAGE,
          initial: 10,
          title: (count) => t`Add ${count} damage`,
        },
        run: ({ count = 10 }) =>
          shortcut({ action: 'adjustDamage', cardId: card.id, delta: count })(),
      });
    }
    const setsDamage = selectLegacyContextEntries(state, card).some(
      (entry) => entry.kind === 'action' && entry.action === 'setDamage'
    );
    if (damage > 0 && setsDamage) {
      commands.push({
        id: `${prefix}.removeDamage`,
        title: t`Take off damage…`,
        section,
        detail,
        icon: FirstAidIcon,
        keywords: ['heal', 'damage', 'remove'],
        count: {
          label: t`How much damage?`,
          min: 1,
          max: damage,
          initial: Math.min(10, damage),
          title: (count) => t`Take off ${count} damage`,
        },
        run: ({ count = 10 }) => {
          // What is on it now: it may have changed while the number was
          // being typed.
          const now =
            runtime.getBoardSnapshot()?.view?.stacks[card.parentId]?.damage;
          if (!now) return;
          overlay({
            kind: 'context',
            action: 'setDamage',
            cardId: card.id,
            value: String(Math.max(0, now - count)),
          })();
        },
      });
    }
    const menu = new Set(
      selectLegacyContextEntries(state, card).flatMap((entry) =>
        entry.kind === 'action' ? [entry.action] : []
      )
    );
    if (menu.has('setDamage')) {
      commands.push({
        id: `${prefix}.setDamage`,
        title: t`Set damage…`,
        section,
        detail,
        icon: HeartBreakIcon,
        keywords: ['damage', 'counter', 'hp'],
        count: {
          label: t`Damage on the Pokémon`,
          min: 0,
          max: MAX_DAMAGE,
          initial: 0,
          title: (count) => t`Set damage to ${count}`,
        },
        run: ({ count = 0 }) =>
          overlay({
            kind: 'context',
            action: 'setDamage',
            cardId: card.id,
            value: String(count),
          })(),
      });
    }
    const condition = view.stacks[card.parentId]?.specialCondition;
    if (menu.has('setSpecialCondition') && condition) {
      commands.push({
        id: `${prefix}.removeCondition`,
        title: t`Remove condition`,
        section,
        detail,
        icon: SparkleIcon,
        hint: hint('card.removeCondition'),
        keywords: ['condition', 'cure', 'heal', 'remove'],
        run: overlay({
          kind: 'context',
          action: 'setSpecialCondition',
          cardId: card.id,
          value: '',
        }),
      });
    }
    if (menu.has('setSpecialCondition')) {
      commands.push({
        id: `${prefix}.condition`,
        title: t`Special Condition…`,
        section,
        detail,
        icon: SparkleIcon,
        keywords: ['poisoned', 'burned', 'asleep', 'paralyzed', 'confused'],
        submenu: () => ({
          breadcrumb: t`Special Condition`,
          commands: [
            ...CONDITIONS.map((condition): PaletteCommand => ({
              id: `${prefix}.condition.${condition}`,
              title: markerHint({ kind: 'specialCondition', value: condition }),
              section,
              run: overlay({
                kind: 'context',
                action: 'setSpecialCondition',
                cardId: card.id,
                value: CONDITION_CODES[condition],
              }),
            })),
            {
              id: `${prefix}.condition.none`,
              title: t`No Special Condition`,
              section,
              run: overlay({
                kind: 'context',
                action: 'setSpecialCondition',
                cardId: card.id,
                value: '',
              }),
            },
          ],
        }),
      });
    }
    return commands;
  };

  const commands: PaletteCommand[] = [];

  // ---- Selected card ----------------------------------------------------
  const selectedId = state.presentation.selectedCardId;
  const selected = selectedId
    ? scene.cards.find((card) => card.id === selectedId)
    : undefined;
  if (selected)
    commands.push(...cardCommands(selected, 'selected', 'selected'));

  // ---- Deck and hand (the acting seat's) ---------------------------------
  const seat = seatName(acting);
  const deckZone = scene.zones.find(
    (zone) => zone.kind === 'deck' && zone.playerId === acting
  );
  if (live && accepts({ action: 'shuffleOwnDeck' })) {
    const counted = (
      id: string,
      title: string,
      label: string,
      named: (count: number) => string,
      request: (count: number) => Shortcut,
      extra: Partial<PaletteCommand> = {}
    ): PaletteCommand => ({
      id,
      title,
      section: 'deck',
      ...(seat ? { detail: seat } : {}),
      count: { label, min: 1, max: MAX_COUNT, initial: 1, title: named },
      run: ({ count = 1 }) => shortcut(request(count))(),
      ...extra,
    });
    commands.push(
      {
        id: 'deck.drawOne',
        title: t`Draw a card`,
        section: 'deck',
        ...(seat ? { detail: seat } : {}),
        icon: CardsIcon,
        keepOpen: true,
        keywords: ['draw'],
        run: shortcut({ action: 'drawOwnDeck', count: 1 }),
      },
      counted(
        'deck.draw',
        t`Draw cards…`,
        t`How many cards?`,
        (count) => plural(count, { one: 'Draw # card', other: 'Draw # cards' }),
        (count) => ({ action: 'drawOwnDeck', count }),
        { icon: CardsIcon, hint: hint('deck.draw'), keywords: ['draw'] }
      ),
      {
        id: 'deck.shuffle',
        title: t`Shuffle your deck`,
        section: 'deck',
        ...(seat ? { detail: seat } : {}),
        icon: ShuffleIcon,
        hint: hint('deck.shuffle'),
        keywords: ['shuffle', 'deck'],
        run: shortcut({ action: 'shuffleOwnDeck' }),
      },
      counted(
        'deck.lookTop',
        t`Look at the top of your deck…`,
        t`How many cards?`,
        (count) =>
          plural(count, {
            one: 'Look at the top card of your deck',
            other: 'Look at the top # cards of your deck',
          }),
        (count) => ({ action: 'inspectOwnDeck', count, edge: 'top' }),
        {
          icon: BinocularsIcon,
          hint: hint('deck.viewTop'),
          keywords: ['look', 'top', 'peek'],
        }
      ),
      counted(
        'deck.lookBottom',
        t`Look at the bottom of your deck…`,
        t`How many cards?`,
        (count) =>
          plural(count, {
            one: 'Look at the bottom card of your deck',
            other: 'Look at the bottom # cards of your deck',
          }),
        (count) => ({ action: 'inspectOwnDeck', count, edge: 'bottom' }),
        {
          icon: BinocularsIcon,
          hint: hint('deck.viewBottom'),
          keywords: ['look', 'bottom', 'peek'],
        }
      )
    );
    if (deckZone?.interactive) {
      commands.push({
        id: 'deck.search',
        title: t`Search your deck`,
        section: 'deck',
        ...(seat ? { detail: seat } : {}),
        icon: MagnifyingGlassIcon,
        hint: hint('deck.view'),
        keywords: ['search', 'find', 'open', 'deck'],
        run: () => {
          runtime.emitIntent({ kind: 'ZoneOpened', zoneId: deckZone.id });
          runtime.declareDeckView(acting);
        },
      });
    }
  }
  const handHolds =
    scene.zones.find((zone) => zone.kind === 'hand' && zone.playerId === acting)
      ?.count ?? 0;
  if (live && handHolds > 0) {
    const refreshes = [
      {
        id: 'hand.discardAndDraw',
        action: 'discardOwnHandAndDraw',
        title: t`Discard your hand and draw…`,
        named: (count: number) =>
          plural(count, {
            one: 'Discard your hand and draw # card',
            other: 'Discard your hand and draw # cards',
          }),
        icon: TrashIcon,
        keywords: ['discard', 'hand', 'professor', 'draw'],
      },
      {
        id: 'hand.shuffleAndDraw',
        action: 'shuffleOwnHandAndDraw',
        title: t`Shuffle your hand into your deck and draw…`,
        named: (count: number) =>
          plural(count, {
            one: 'Shuffle your hand in and draw # card',
            other: 'Shuffle your hand in and draw # cards',
          }),
        icon: ShuffleIcon,
        keywords: ['shuffle', 'hand', 'draw'],
      },
      {
        id: 'hand.shuffleToBottomAndDraw',
        action: 'shuffleOwnHandToDeckBottomAndDraw',
        title: t`Put your hand on the bottom of your deck and draw…`,
        named: (count: number) =>
          plural(count, {
            one: 'Put your hand on the bottom and draw # card',
            other: 'Put your hand on the bottom and draw # cards',
          }),
        icon: ArrowsDownUpIcon,
        keywords: ['bottom', 'hand', 'draw'],
      },
    ] as const;
    for (const refresh of refreshes) {
      const request = { action: refresh.action, value: '0' } as const;
      if (!accepts(request)) continue;
      commands.push({
        id: refresh.id,
        title: refresh.title,
        section: 'deck',
        ...(seat ? { detail: seat } : {}),
        icon: refresh.icon,
        hint: hint(refresh.id as HotkeyActionId),
        keywords: refresh.keywords,
        count: {
          label: t`Then draw how many cards?`,
          min: 0,
          max: MAX_COUNT,
          initial: 0,
          title: refresh.named,
        },
        run: ({ count = 0 }) =>
          shortcut({ action: refresh.action, value: String(count) })(),
      });
    }
  }

  // ---- Cards: every card face up on the table ------------------------------
  // Face down on the table (a deck's cover, prizes) is not findable.
  const findable = scene.cards.filter(
    (card) =>
      !card.concealed &&
      card.tableImageUrl === undefined &&
      view.zones[card.parentId]?.kind !== 'deck' &&
      view.zones[card.parentId]?.kind !== 'prizes' &&
      card.label !== '' &&
      (card.role === 'zone' ||
        card.role === 'stackEvolution' ||
        card.role === 'stackAttachment') &&
      (card.role !== 'stackEvolution' ||
        view.stacks[card.parentId]?.evolutionCards.at(-1)?.id === card.id)
  );
  // Yours first, in play first; copies lying together in a hand or a pile
  // are one row (any of them will do), Pokémon in play each their own.
  const placeRank = (card: CardSceneNode): number => {
    const stack = view.stacks[card.parentId];
    const owner = stack?.boardPlayerId ?? view.zones[card.parentId]?.ownerId;
    const kind = stack ? stack.slot : view.zones[card.parentId]?.kind;
    const order = [
      'active',
      'bench',
      'hand',
      'stadium',
      'board',
      'discard',
      'lostZone',
    ];
    const at = order.indexOf(kind ?? '');
    // A Pokémon before what is attached to it.
    return (
      (owner === acting ? 0 : 100) +
      (at < 0 ? 50 : at) +
      (card.role === 'stackAttachment' ? 0.5 : 0)
    );
  };
  // Copies are the same card (one definition), not just one name: two
  // prints of a Pokémon each keep a row, told apart by their pictures.
  const definitionOf = (card: CardSceneNode): string | undefined => {
    const known = view.zones[card.parentId]?.cards.find(
      (candidate) => candidate.id === card.id
    );
    return known?.kind === 'known' ? known.definitionId : undefined;
  };
  const copyKey = (card: CardSceneNode): string =>
    view.stacks[card.parentId] !== undefined
      ? card.id
      : `${definitionOf(card) ?? card.id}\u0000${card.parentId}`;
  const copies = new Map<string, number>();
  const rows: CardSceneNode[] = [];
  for (const card of [...findable].sort(
    (left, right) => placeRank(left) - placeRank(right)
  )) {
    const key = copyKey(card);
    const seen = copies.get(key);
    copies.set(key, (seen ?? 0) + 1);
    if (seen === undefined) rows.push(card);
  }
  const copiesOf = (card: CardSceneNode): number =>
    copies.get(copyKey(card)) ?? 1;
  if (rows.length > 0) {
    commands.push({
      id: 'cards.find',
      title: t`Find a card…`,
      section: 'cards',
      icon: MagnifyingGlassIcon,
      keywords: ['card', 'find', 'search', 'pokemon'],
      submenu: () => ({
        breadcrumb: t`Cards`,
        placeholder: t`Search the cards on the table…`,
        commands: rows.map((card): PaletteCommand => ({
          id: `cards.card.${card.id}`,
          title: card.label,
          detail:
            copiesOf(card) > 1
              ? t`${placeOf(card)} (${copiesOf(card)})`
              : placeOf(card),
          section: 'cards',
          icon: StackIcon,
          image: {
            src: card.imageUrl,
            ...(card.imageFallbackUrl
              ? { fallback: card.imageFallbackUrl }
              : {}),
          },
          nestedSearch: false,
          submenu: () => ({
            breadcrumb: card.label,
            placeholder: t`What should ${card.label} do?`,
            commands: cardCommands(card, `cards.card.${card.id}`, 'cards'),
          }),
        })),
      }),
    });
  }

  // ---- Piles ---------------------------------------------------------------
  const pileTitle = (zone: ZoneSceneNode, own: boolean): string | null => {
    switch (zone.kind) {
      case 'deck':
        return own ? t`Open your deck` : t`Open their deck`;
      case 'discard':
        return own ? t`Open your discard pile` : t`Open their discard pile`;
      case 'lostZone':
        return own ? t`Open your Lost Zone` : t`Open their Lost Zone`;
      case 'prizes':
        return own ? t`Open your Prizes` : t`Open their Prizes`;
      default:
        return null;
    }
  };
  for (const zone of scene.zones) {
    if (!zone.interactive || zone.playerId === null) continue;
    const own = zone.playerId === acting;
    // Your own deck is searched from Deck and hand.
    if (zone.kind === 'deck' && own && live) continue;
    const title = pileTitle(zone, own);
    if (!title) continue;
    commands.push({
      // A spectator has no seat: each player's piles are their own rows.
      id:
        acting === undefined
          ? `piles.open.${zone.playerId}.${zone.kind}`
          : `piles.open.${own ? 'own' : 'their'}.${zone.kind}`,
      title,
      section: 'piles',
      icon: FolderOpenIcon,
      keywords: ['open', 'view', zone.kind],
      ...(seatName(zone.playerId) ? { detail: seatName(zone.playerId)! } : {}),
      run: () => {
        runtime.emitIntent({ kind: 'ZoneOpened', zoneId: zone.id });
      },
    });
  }
  if (live) {
    // What the loose board's cards can do, together: v1's Enter, Alt+Enter, /.
    const loose = [
      [
        'board.discardAll',
        'discard',
        t`Discard everything on your playboard`,
        TrashIcon,
      ],
      [
        'board.moveAllToHand',
        'hand',
        t`Move everything on your playboard to your hand`,
        HandIcon,
      ],
      [
        'board.shuffleAllIntoDeck',
        'shuffleIntoDeck',
        t`Shuffle everything on your playboard into your deck`,
        ShuffleIcon,
      ],
    ] as const;
    for (const [id, destination, title, icon] of loose) {
      const request = { action: 'resolveOwnLooseBoard', destination } as const;
      if (!accepts(request)) continue;
      commands.push({
        id: `piles.${id}`,
        title,
        section: 'piles',
        icon: icon as Icon,
        hint: hint(id),
        keywords: ['board', 'all'],
        run: shortcut(request),
      });
    }
    // Pile actions only a pile's menu has: by one of its cards, as the menu
    // is opened on one.
    const menuOn = (
      zoneKind: string,
      playerId: string | undefined,
      wanted: readonly {
        readonly action: LegacyBoardContextActionId;
        readonly title: string;
        readonly icon: Icon;
        readonly count?: true;
        readonly keywords?: readonly string[];
      }[],
      own: boolean
    ): void => {
      const card = scene.cards.find((candidate) => {
        const zone = view.zones[candidate.parentId];
        return zone?.kind === zoneKind && zone.ownerId === playerId;
      });
      if (!card) return;
      const offered = new Set(
        selectLegacyContextEntries(state, card).flatMap((entry) =>
          entry.kind === 'action' ? [entry.action] : []
        )
      );
      for (const item of wanted) {
        if (!offered.has(item.action)) continue;
        const request = (value?: string): LegacyBoardOverlayActionRequest => ({
          kind: 'context',
          action: item.action,
          cardId: card.id as ViewCardId,
          ...(value === undefined ? {} : { value }),
        });
        commands.push({
          id: `piles.${own ? 'own' : 'their'}.${item.action}`,
          title: item.title,
          section: 'piles',
          icon: item.icon,
          ...(seatName(playerId) ? { detail: seatName(playerId)! } : {}),
          ...(item.keywords ? { keywords: item.keywords } : {}),
          ...(item.count
            ? {
                count: {
                  label: t`How many cards?`,
                  min: 1,
                  max: MAX_COUNT,
                  initial: 1,
                  title: (count: number) =>
                    item.action === 'viewDeckBottom'
                      ? plural(count, {
                          one: 'Look at the bottom card of their deck',
                          other: 'Look at the bottom # cards of their deck',
                        })
                      : plural(count, {
                          one: 'Look at the top card of their deck',
                          other: 'Look at the top # cards of their deck',
                        }),
                },
                run: ({ count = 1 }) => overlay(request(String(count)))(),
              }
            : { run: overlay(request()) }),
        });
      }
    };
    const other = view.playerOrder.find((playerId) => playerId !== acting);
    for (const [playerId, own] of [
      [acting, true],
      [other, false],
    ] as const) {
      if (!playerId) continue;
      menuOn(
        'prizes',
        playerId,
        [
          ...(own
            ? [
                {
                  action: 'shufflePrizes' as const,
                  title: t`Shuffle your Prizes`,
                  icon: ShuffleIcon,
                  keywords: ['prize', 'shuffle'],
                },
                {
                  action: 'shufflePrizesToDeckBottom' as const,
                  title: t`Put your Prizes on the bottom of your deck`,
                  icon: ArrowsDownUpIcon,
                  keywords: ['prize', 'bottom'],
                },
              ]
            : []),
          {
            action: 'togglePrizes',
            title: own
              ? t`Look at or cover your Prizes`
              : t`Look at or cover their Prizes`,
            icon: EyeIcon,
            keywords: ['prize', 'look'],
          },
          {
            action: 'revealPrizes',
            title: own
              ? t`Reveal or hide your Prizes`
              : t`Reveal or hide their Prizes`,
            icon: EyeIcon,
            keywords: ['prize', 'reveal'],
          },
        ],
        own
      );
      if (!own) {
        menuOn(
          'hand',
          playerId,
          [
            {
              action: 'toggleOpponentHand',
              title: t`Look at or cover their hand`,
              icon: EyeIcon,
              keywords: ['hand', 'look'],
            },
            {
              action: 'randomOpponentHandCard',
              title: t`Pick a random card from their hand`,
              icon: ShuffleIcon,
              keywords: ['random', 'hand'],
            },
          ],
          own
        );
        menuOn(
          'deck',
          playerId,
          [
            {
              action: 'viewDeckTop',
              title: t`Look at the top of their deck…`,
              icon: BinocularsIcon,
              count: true,
              keywords: ['look', 'top'],
            },
            {
              action: 'viewDeckBottom',
              title: t`Look at the bottom of their deck…`,
              icon: BinocularsIcon,
              count: true,
              keywords: ['look', 'bottom'],
            },
          ],
          own
        );
      }
      menuOn(
        'board',
        playerId,
        own
          ? [
              {
                action: 'moveBoardToLostZone',
                title: t`Put everything on your playboard in the Lost Zone`,
                icon: SparkleIcon,
                keywords: ['lost zone', 'board', 'all'],
              },
            ]
          : [],
        own
      );
    }
  }

  // ---- Coins ---------------------------------------------------------------
  if (live) {
    for (const playerId of view.playerOrder) {
      const request = { action: 'flipCoin', playerId } as const;
      if (!accepts(request)) continue;
      const own = playerId === acting;
      commands.push({
        id: own ? 'turn.coin' : 'turn.coinOther',
        title: own ? t`Flip a coin` : t`Flip the other seat's coin`,
        section: 'turn',
        icon: CoinIcon,
        ...(seatName(playerId) ? { detail: seatName(playerId)! } : {}),
        ...(own ? { hint: hint('table.flipCoin') } : {}),
        keywords: ['coin', 'flip', 'heads', 'tails'],
        run: shortcut(request),
      });
    }
  }
  return commands;
};

const CARD_ACTION_ICONS: Partial<Record<HotkeyActionId, Icon>> = {
  'card.toHand': HandIcon,
  'card.toDiscard': TrashIcon,
  'card.shuffleIntoDeck': ShuffleIcon,
  'card.toDeckTop': ArrowsDownUpIcon,
  'card.toDeckBottom': ArrowsDownUpIcon,
  'card.swapWithDeckTop': ArrowsDownUpIcon,
  'card.toggleAbility': SparkleIcon,
  'card.addCondition': SparkleIcon,
  'card.removeCondition': SparkleIcon,
  'card.clearDamage': FirstAidIcon,
  'card.lookCover': EyeIcon,
  'card.hide': EyeIcon,
  'card.reveal': EyeIcon,
};

const cardActionIcon = (id: HotkeyActionId): Icon =>
  CARD_ACTION_ICONS[id] ?? StackIcon;
