import { Trans, useLingui } from '@lingui/react/macro';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { basicEnergyTypeOf } from '@ptcgsim/deck-core';
import {
  STACK_REMINDERS,
  type CardText,
  type CardTextAbility,
  type CardTextAttack,
  type CardTextEnergyType,
  type MatchViewState,
  type ViewCard,
  type ViewCardId,
} from '@ptcgsim/game-core';
import {
  markerHint,
  reminderName,
  specialConditionKind,
  type CardSceneNode,
} from '@ptcgsim/renderer-contract';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { energyTypeName, stageName } from '../../features/deck/deck-labels.js';
import { EnergySymbol, RulesText } from '../../ui/EnergySymbol.js';
import { isInputMethodKey } from '../../ui/input-method.js';
import { Tooltip } from '../../ui/Tooltip.js';
import { resolveCardText, useTableCardCatalog } from '../card-text.js';
import {
  parseLegacyDamageInput,
  type LegacyBoardOverlayActionRequest,
} from '../resolveLegacyBoardOverlayAction.js';
import {
  CONDITION_CODES,
  CONDITIONS,
  conditionArt,
  REMINDER_ICONS,
} from './MarkerControls.js';
import './PokemonWindow.css';

type ViewStack = MatchViewState['stacks'][string];

/** The sizes a card is drawn at in the window. */
export type PokemonWindowCardSize = 'hero' | 'stage' | 'attached';

/** Every press here may be reached by Tab, inside the window's trap. */
const tabbable = { 'data-preview-tabbable': 'true' } as const;

/** The most damage a Pokémon can carry (the room's limit). */
const DAMAGE_MAXIMUM = 9_990;
const DAMAGE_STEP = 10;
/** How long a damage asked for stands before the table's shown takes over. */
const PENDING_DAMAGE_MS = 4_000;

const BASIC_ENERGY_TYPES: Readonly<Record<string, CardTextEnergyType>> = {
  grass: 'Grass',
  fire: 'Fire',
  water: 'Water',
  lightning: 'Lightning',
  psychic: 'Psychic',
  fighting: 'Fighting',
  darkness: 'Darkness',
  metal: 'Metal',
  fairy: 'Fairy',
};

/** A BREAK keeps its lower Stage's Abilities, attacks and the rest. */
const isBreak = (name: string | undefined): boolean =>
  name !== undefined && /\sBREAK$/u.test(name.trim());

/** What one of the window's moves is, and the card it is printed on. */
interface WindowMove {
  readonly cardId: ViewCardId;
  readonly from?: string;
  readonly ability?: CardTextAbility;
  readonly attack?: CardTextAttack;
}

export interface PokemonWindowProps {
  readonly stack: ViewStack;
  /** The stack's cards as the table draws them (pictures in the viewer's language). */
  readonly cards: readonly CardSceneNode[];
  readonly definitions: MatchViewState['definitions'];
  /** The owner's name, and their seat's colour. */
  readonly owner: string | undefined;
  readonly tone: string;
  /** Damage, conditions, reminders and the Ability marker may be changed. */
  readonly canMark: boolean;
  /** Its Abilities and attacks may be used: a Pokémon the viewer plays. */
  readonly canUseMoves: boolean;
  readonly renderCard: (
    card: CardSceneNode,
    size: PokemonWindowCardSize
  ) => ReactNode;
  /** The window's close button, at the end of its title bar. */
  readonly closeButton: ReactNode;
  readonly act: (request: LegacyBoardOverlayActionRequest) => void;
  /** After a move is used: the window has done its job. */
  readonly onUsed: () => void;
  /** Where it puts the way to set a damage typed, before it is put away. */
  readonly commitRef?: { current: (() => void) | null };
}

/** The type and how many of each: an Energy's text, or a Basic's name. */
const energySummary = (
  attached: readonly ViewCard[],
  definitions: MatchViewState['definitions']
): {
  readonly basic: readonly CardTextEnergyType[];
  readonly special: number;
} => {
  const basic: CardTextEnergyType[] = [];
  let special = 0;
  for (const card of attached) {
    if (card.kind !== 'known') continue;
    const name = definitions[card.definitionId]?.name ?? '';
    const type = basicEnergyTypeOf(name);
    const known = type ? BASIC_ENERGY_TYPES[type] : undefined;
    if (known) basic.push(known);
    else special += 1;
  }
  return { basic, special };
};

const Cost = ({
  cost,
  size,
}: {
  readonly cost: readonly CardTextEnergyType[];
  readonly size?: number;
}) => {
  const { t } = useLingui();
  const names = cost.map(energyTypeName).join(', ');
  return (
    <span className="pokemon-window__cost">
      {cost.length === 0 ? (
        <span className="pokemon-window__cost-free" aria-hidden="true" />
      ) : (
        cost.map((type, index) => (
          <EnergySymbol
            key={`${type}-${String(index)}`}
            type={type}
            {...(size ? { size } : {})}
          />
        ))
      )}
      <span className="ds-visually-hidden">
        {cost.length === 0
          ? t({
              message: 'No cost',
              comment: 'An attack that needs no Energy.',
            })
          : t({
              message: `Cost: ${names}`,
              comment:
                'The Energy an attack needs, read out. {names} lists the types, e.g. "Fire, Fire, Colorless".',
            })}
      </span>
    </span>
  );
};

/** An Ability: its kind, name and text, and Use for its Pokémon's player. */
const AbilityRow = ({
  move,
  ability,
  canUse,
  used,
  onUse,
}: {
  readonly move: WindowMove;
  readonly ability: CardTextAbility;
  readonly canUse: boolean;
  /** The Pokémon's Ability marker is on. */
  readonly used: boolean;
  readonly onUse: () => void;
}) => {
  const { t } = useLingui();
  const name = ability.name;
  return (
    <article className="pokemon-window__move is-ability">
      <header className="pokemon-window__move-head">
        <span className="pokemon-window__ability-kind">{ability.kind}</span>
        <h3 className="pokemon-window__move-name">
          {name}
          {used ? (
            <span className="pokemon-window__used">
              {' '}
              <CheckIcon weight="bold" aria-hidden="true" />
              <Trans context="an Ability, this turn">Used</Trans>
            </span>
          ) : null}
        </h3>
      </header>
      {ability.text ? (
        <p className="pokemon-window__move-text">
          <RulesText text={ability.text} size={15} />
        </p>
      ) : null}
      {canUse ? (
        <button
          type="button"
          className="ptcgsim-overlay-button is-primary pokemon-window__use"
          data-pokemon-window-move="ability"
          data-move-card-id={move.cardId}
          aria-label={t({
            message: `Use ${name}`,
            comment: '{name} is an Ability printed on a Pokémon.',
          })}
          onClick={onUse}
          {...tabbable}
        >
          <Trans context="use an Ability">Use</Trans>
        </button>
      ) : null}
    </article>
  );
};

/**
 * An attack: its cost, name, damage and text, read; and Attack, which
 * declares it, for the Active Pokémon's player. Only the button declares it,
 * so a tap to read the text does nothing.
 */
const AttackRow = ({
  attack,
  canUse,
  onUse,
  cardId,
}: {
  readonly attack: CardTextAttack;
  readonly canUse: boolean;
  readonly onUse: () => void;
  readonly cardId: ViewCardId;
}) => {
  const { t } = useLingui();
  const name = attack.name;
  return (
    <article className="pokemon-window__move is-attack">
      <header className="pokemon-window__move-head">
        <Cost cost={attack.cost} size={20} />
        <h3 className="pokemon-window__move-name">{name}</h3>
        {attack.damage ? (
          <span className="pokemon-window__damage ds-number">
            {attack.damage}
          </span>
        ) : null}
      </header>
      {attack.text ? (
        <p className="pokemon-window__move-text">
          <RulesText text={attack.text} size={15} />
        </p>
      ) : null}
      {canUse ? (
        <button
          type="button"
          className="ptcgsim-overlay-button is-primary pokemon-window__use"
          data-pokemon-window-move="attack"
          data-move-card-id={cardId}
          aria-label={t({
            message: `Attack with ${name}`,
            comment: '{name} is an attack printed on a Pokémon.',
          })}
          onClick={onUse}
          {...tabbable}
        >
          {t({ message: 'Attack', context: 'declare an attack' })}
        </button>
      ) : null}
    </article>
  );
};

/**
 * A Pokémon's damage: stepped by 10, typed (Enter or leaving sets it), or
 * taken off; with its HP when the card says it, as what is left of it.
 */
const Vitals = ({
  hp,
  damage,
  canMark,
  onDamage,
  commitRef,
}: {
  readonly hp: number | undefined;
  readonly damage: number;
  readonly canMark: boolean;
  readonly onDamage: (value: number) => void;
  /** Where it puts the way to set what is typed, for a press outside. */
  readonly commitRef?: { current: (() => void) | null };
}) => {
  const { t } = useLingui();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const left = hp === undefined ? undefined : Math.max(0, hp - damage);
  const share = hp ? Math.max(0, Math.min(1, (left ?? 0) / hp)) : 0;
  const tone = share > 0.5 ? 'high' : share > 0.25 ? 'mid' : 'low';
  // The damage last asked for: a step taken before the table has it (a
  // number typed, then a press of +) goes on from it, not from the damage
  // the table showed before. It stands until the table shows it, or for a
  // while if it never does (refused, or overtaken by another's change),
  // read as each press comes; an answer to an earlier step in between
  // doesn't replace it.
  const pending = useRef<{ readonly value: number; readonly at: number }>(
    undefined
  );
  // The table showing it answers it: from then on, its damage is the base
  // (a change by someone else straight after included).
  useEffect(() => {
    if (pending.current?.value === damage) pending.current = undefined;
  }, [damage]);
  const asked = (): number => {
    const waiting = pending.current;
    if (
      waiting &&
      waiting.value !== damage &&
      performance.now() - waiting.at < PENDING_DAMAGE_MS
    )
      return waiting.value;
    pending.current = undefined;
    return damage;
  };
  const set = (value: number): void => {
    setDraft(null);
    setInvalid(false);
    const next = Math.max(0, Math.min(DAMAGE_MAXIMUM, value));
    if (next === asked()) return;
    onDamage(next);
    pending.current = { value: next, at: performance.now() };
  };
  /** A step from what is typed (0 included), else from what was asked. */
  const step = (by: number): void => {
    const typed = draft === null ? undefined : parseLegacyDamageInput(draft);
    set((typed === undefined ? asked() : (typed ?? 0)) + by);
  };
  const commit = (): void => {
    if (draft === null) return;
    const parsed = parseLegacyDamageInput(draft);
    if (parsed === undefined) {
      setInvalid(true);
      return;
    }
    set(parsed ?? 0);
  };
  // A press outside the window puts it away before the number is left
  // (an element taken away is never blurred): it sets what was typed
  // first, as the marker controls do.
  useEffect(() => {
    if (!commitRef) return;
    commitRef.current = commit;
    return () => {
      if (commitRef.current === commit) commitRef.current = null;
    };
  });
  return (
    <div className="pokemon-window__vitals" data-hp-tone={tone}>
      <div className="pokemon-window__hp">
        {hp !== undefined ? (
          <>
            <span className="pokemon-window__hp-label">
              <Trans context="hit points">HP</Trans>
            </span>
            <span className="pokemon-window__hp-value ds-number">
              <span className="pokemon-window__hp-left">{left}</span>
              <span className="pokemon-window__hp-total">/{hp}</span>
            </span>
            <span
              className="pokemon-window__hp-bar"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={hp}
              aria-valuenow={left}
              aria-label={t({
                message: 'HP left',
                comment: "A Pokémon's HP less its damage.",
              })}
            >
              <span style={{ inlineSize: `${(share * 100).toFixed(1)}%` }} />
            </span>
          </>
        ) : (
          <span className="pokemon-window__hp-label">
            <Trans>Damage</Trans>
          </span>
        )}
      </div>
      {canMark ? (
        <div
          className="pokemon-window__stepper"
          role="group"
          aria-label={t`Damage`}
        >
          <Tooltip content={t`10 less damage`}>
            <button
              type="button"
              className="pokemon-window__icon-button"
              aria-label={t`10 less damage`}
              disabled={damage === 0 && draft === null}
              onClick={() => step(-DAMAGE_STEP)}
              {...tabbable}
            >
              <MinusIcon weight="bold" aria-hidden="true" />
            </button>
          </Tooltip>
          <input
            className="pokemon-window__damage-input ds-number"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            placeholder="0"
            aria-label={t`Damage counter`}
            aria-invalid={invalid}
            value={draft ?? (damage > 0 ? String(damage) : '')}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setInvalid(false);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              // An input method's keys (its Enter takes a candidate, its
              // arrows move between them) are its own.
              if (isInputMethodKey(event.nativeEvent)) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                step(event.key === 'ArrowUp' ? DAMAGE_STEP : -DAMAGE_STEP);
              }
            }}
            {...tabbable}
          />
          <Tooltip content={t`10 more damage`}>
            <button
              type="button"
              className="pokemon-window__icon-button"
              aria-label={t`10 more damage`}
              onClick={() => step(DAMAGE_STEP)}
              {...tabbable}
            >
              <PlusIcon weight="bold" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip content={t`Remove all damage`}>
            <button
              type="button"
              className="pokemon-window__icon-button is-quiet"
              aria-label={t`Remove all damage`}
              disabled={damage === 0}
              onClick={() => set(0)}
              {...tabbable}
            >
              <TrashIcon weight="bold" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      ) : (
        <span className="pokemon-window__damage-readout ds-number">
          {t({
            message: `${damage} damage`,
            comment: 'Damage on a Pokémon, e.g. "60 damage".',
          })}
        </span>
      )}
      {invalid ? (
        <span className="pokemon-window__hint" role="alert">
          {t`0 to 9990`}
        </span>
      ) : null}
    </div>
  );
};

/** A marker the window turns on and off: a condition, a reminder. */
const Toggle = ({
  label,
  pressed,
  enabled,
  onPress,
  children,
  kind,
}: {
  readonly label: string;
  readonly pressed: boolean;
  readonly enabled: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
  readonly kind: 'condition' | 'reminder' | 'ability';
}) =>
  enabled ? (
    <Tooltip content={label}>
      <button
        type="button"
        className={`pokemon-window__toggle is-${kind}`}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onPress}
        {...tabbable}
      >
        {children}
      </button>
    </Tooltip>
  ) : pressed ? (
    <Tooltip content={label}>
      <span
        className={`pokemon-window__toggle is-${kind}`}
        role="img"
        aria-label={label}
        data-pressed="true"
      >
        {children}
      </span>
    </Tooltip>
  ) : null;

/** Weakness, Resistance and Retreat, as the bottom of the card has them. */
const Stats = ({ text }: { readonly text: CardText }) => {
  const { t } = useLingui();
  const none = <span className="pokemon-window__stat-none">—</span>;
  const retreat = text.retreat ?? 0;
  return (
    <dl className="pokemon-window__stats">
      <div>
        <dt>{t`Weakness`}</dt>
        <dd>
          {text.weakness ? (
            <>
              <EnergySymbol type={text.weakness} size={18} />
              <span className="ds-visually-hidden">
                {energyTypeName(text.weakness)}
              </span>
              {text.weaknessValue ? (
                <span className="ds-number">{text.weaknessValue}</span>
              ) : null}
            </>
          ) : (
            none
          )}
        </dd>
      </div>
      <div>
        <dt>{t`Resistance`}</dt>
        <dd>
          {text.resistance ? (
            <>
              <EnergySymbol type={text.resistance} size={18} />
              <span className="ds-visually-hidden">
                {energyTypeName(text.resistance)}
              </span>
              {text.resistanceValue ? (
                <span className="ds-number">{text.resistanceValue}</span>
              ) : null}
            </>
          ) : (
            none
          )}
        </dd>
      </div>
      <div>
        <dt>{t`Retreat`}</dt>
        <dd>
          {retreat > 0 ? (
            <Cost
              cost={Array.from(
                { length: retreat },
                (): CardTextEnergyType => 'Colorless'
              )}
              size={18}
            />
          ) : (
            none
          )}
        </dd>
      </div>
    </dl>
  );
};

/**
 * The window a Pokémon in play opens in (ADR-043): the Pokémon and the
 * Stages under it, what is attached to it, and on the other side its
 * damage, conditions and reminders, then its Abilities and attacks from its
 * card's text -- each one used with a press that tells the log.
 */
export const PokemonWindow = ({
  stack,
  cards,
  definitions,
  canMark,
  canUseMoves,
  renderCard,
  closeButton,
  owner,
  tone,
  act,
  onUsed,
  commitRef,
}: PokemonWindowProps) => {
  const { t } = useLingui();
  const titleId = useId();
  const byId = new Map(cards.map((card) => [card.id, card]));
  const scene = (card: ViewCard): CardSceneNode[] => {
    const node = byId.get(card.id);
    return node ? [node] : [];
  };
  // The Pokémon, top card first; then what is attached, newest first.
  const pokemonCards = [...stack.evolutionCards].reverse();
  const [topCard, ...lowerCards] = pokemonCards;
  const attached = [...stack.attachmentCards].reverse();
  const isKind = (card: ViewCard, category: string): boolean =>
    card.kind === 'known' && card.category === category;
  const energy = attached.filter((card) => isKind(card, 'Energy'));
  const tools = attached.filter((card) => isKind(card, 'Trainer'));
  const others = attached.filter(
    (card) => !isKind(card, 'Energy') && !isKind(card, 'Trainer')
  );
  const definitionOf = (card: ViewCard | undefined) =>
    card?.kind === 'known' ? definitions[card.definitionId] : undefined;
  const topDefinition = definitionOf(topCard);
  // A card printed in pieces (V-UNION, LEGEND) is one Pokémon: its moves
  // are on any of its pieces.
  const joinKeyOf = (card: ViewCard): string | undefined =>
    byId.get(card.id)?.presentation?.join?.key;
  const topJoin = topCard ? joinKeyOf(topCard) : undefined;
  const joined =
    topJoin !== undefined &&
    lowerCards.length > 0 &&
    lowerCards.every((card) => joinKeyOf(card) === topJoin);
  // A BREAK reads its Stage below's text too: a print by its name, a card
  // made by hand by its stage or its BREAK layout, whatever its name.
  const topIsBreak =
    isBreak(topDefinition?.name) ||
    topDefinition?.text?.stage === 'BREAK' ||
    (topCard ? byId.get(topCard.id)?.presentation?.overlay : undefined) ===
      'upper-half';
  const breakOver = !joined && topCard && topIsBreak && lowerCards[0];
  const moveCards = joined
    ? pokemonCards
    : topCard && breakOver
      ? [topCard, lowerCards[0]!]
      : topCard
        ? [topCard]
        : [];
  const wantsCatalog = moveCards.some(
    (card) => definitionOf(card) !== undefined && !definitionOf(card)?.text
  );
  const catalog = useTableCardCatalog(wantsCatalog);
  const texts = moveCards.map((card) => ({
    card,
    name: definitionOf(card)?.name,
    resolved: resolveCardText(definitionOf(card), catalog),
  }));
  const pending = texts.some((entry) => entry.resolved.status === 'pending');
  // Each card's text in its own place: the top card's first, then (a
  // BREAK) the Stage's under it, or (a card in pieces) the other pieces'.
  const textOf = (index: number): CardText | undefined => {
    const resolved = texts[index]?.resolved;
    return resolved?.status === 'own' || resolved?.status === 'catalog'
      ? resolved.text
      : undefined;
  };
  // The pieces of a card are one card: any of them says it.
  const ownIndex = joined
    ? texts.findIndex((_, index) => textOf(index) !== undefined)
    : 0;
  const own = ownIndex >= 0 ? textOf(ownIndex) : undefined;
  const inherited = breakOver ? textOf(1) : undefined;
  // A BREAK plays with its Stage below's Weakness, Resistance and Retreat:
  // its printed card has none (the catalog says Retreat 0). A BREAK given
  // text of its own keeps what that says, the Stage's filling the rest.
  // One whose text no one knows has only those of its Stage's, never its
  // HP or its stage.
  const statsOf = (from: CardText | undefined) => ({
    weakness: from?.weakness,
    weaknessValue: from?.weaknessValue,
    resistance: from?.resistance,
    resistanceValue: from?.resistanceValue,
    retreat: from?.retreat,
  });
  const breakStats =
    own && inherited
      ? texts[0]?.resolved.status === 'own'
        ? Object.fromEntries(
            Object.entries(statsOf(own)).map(([key, value]) => [
              key,
              value ??
                statsOf(inherited)[key as keyof ReturnType<typeof statsOf>],
            ])
          )
        : statsOf(inherited)
      : {};
  const text: CardText | undefined = own
    ? { ...inherited, ...own, ...breakStats }
    : inherited
      ? (Object.fromEntries(
          Object.entries(statsOf(inherited)).filter(
            ([, value]) => value !== undefined
          )
        ) as CardText)
      : undefined;
  // Each move once: the pieces of a card often each say the whole card.
  const seenMoves = new Set<string>();
  const moves: WindowMove[] = texts.flatMap((entry, index) => {
    const said = textOf(index);
    if (!said) return [];
    const from = index > 0 && breakOver ? entry.name : undefined;
    const base = { cardId: entry.card.id, ...(from ? { from } : {}) };
    const own: WindowMove[] = [
      ...(said.abilities ?? []).map((ability) => ({ ...base, ability })),
      ...(said.attacks ?? []).map((attack) => ({ ...base, attack })),
    ];
    return own.filter((move) => {
      const key = JSON.stringify(move.ability ?? move.attack);
      if (seenMoves.has(key)) return false;
      seenMoves.add(key);
      return true;
    });
  });
  const topId = topCard?.id;
  const active = stack.slot === 'active';
  const damage = stack.damage ?? 0;
  const condition = stack.specialCondition
    ? specialConditionKind(stack.specialCondition)
    : null;
  const reminders = stack.reminders ?? [];
  const summary = energySummary(energy, definitions);
  const attachedCount = attached.length;
  const showStatus =
    canMark ||
    damage > 0 ||
    condition !== null ||
    reminders.length > 0 ||
    stack.abilityUsed ||
    text?.hp !== undefined;

  const groups = [
    {
      key: 'energy',
      label: t({ message: 'Energy', context: 'attached Energy cards' }),
      cards: energy,
    },
    {
      key: 'tools',
      label: t({
        message: 'Tools',
        context: 'Trainer cards attached to a Pokémon',
      }),
      cards: tools,
    },
    {
      key: 'other',
      label: t({ message: 'Other', context: 'other attached cards' }),
      cards: others,
    },
  ].filter((group) => group.cards.length > 0);

  const name =
    topDefinition?.name ?? (topCard ? byId.get(topCard.id)?.label : '') ?? '';
  return (
    <>
      <header className="pokemon-window__header" data-type={text?.types?.[0]}>
        <PokemonWindowTitle
          name={name}
          owner={owner}
          tone={tone}
          slot={stack.slot}
          stage={text?.stage}
          types={text?.types ?? []}
        />
        {closeButton}
      </header>
      <div className="pokemon-window__body">
        <section
          className="pokemon-window__cards"
          aria-label={t({
            message: 'Cards',
            comment: "The section of a Pokémon's window with its cards.",
          })}
        >
          <div className="pokemon-window__hero">
            {topCard
              ? scene(topCard).map((card) => renderCard(card, 'hero'))
              : null}
          </div>
          {lowerCards.length > 0 ? (
            <div className="pokemon-window__stages">
              <h3 className="pokemon-window__label">
                {joined ? (
                  <Trans comment="Over the other pieces of a Pokémon printed in pieces (a V-UNION).">
                    Pieces
                  </Trans>
                ) : (
                  <Trans comment="Over the Stages a Pokémon evolved from, under it.">
                    Evolved from
                  </Trans>
                )}
              </h3>
              <div className="pokemon-window__stage-cards">
                {lowerCards
                  .flatMap(scene)
                  .map((card) => renderCard(card, 'stage'))}
              </div>
            </div>
          ) : null}
          <div className="pokemon-window__attached">
            <h3 className="pokemon-window__label">
              <Trans comment="Over the cards attached to a Pokémon.">
                Attached
              </Trans>
              {attachedCount > 0 ? (
                <span className="pokemon-window__count ds-number">
                  {attachedCount}
                </span>
              ) : null}
            </h3>
            {groups.length === 0 ? (
              <p className="pokemon-window__empty">
                <Trans>Nothing attached</Trans>
              </p>
            ) : (
              groups.map((group) => (
                <div
                  key={group.key}
                  className="pokemon-window__group"
                  data-group={group.key}
                >
                  <div className="pokemon-window__group-head">
                    <span>{group.label}</span>
                    {group.key === 'energy' ? (
                      <span className="pokemon-window__energy-summary">
                        {summary.basic.map((type, index) => (
                          <EnergySymbol
                            key={`${type}-${String(index)}`}
                            type={type}
                            size={16}
                          />
                        ))}
                        {summary.special > 0 ? (
                          <span className="pokemon-window__special ds-number">
                            {t({
                              message: `+${summary.special} special`,
                              comment:
                                'Special Energy attached besides the Basic Energy drawn as symbols, e.g. "+1 special".',
                            })}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                  <div className="pokemon-window__group-cards">
                    {group.cards
                      .flatMap(scene)
                      .map((card) => renderCard(card, 'attached'))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="pokemon-window__side" aria-labelledby={titleId}>
          <h3 id={titleId} className="ds-visually-hidden">
            {t({
              message: 'Status and moves',
              comment:
                "The section of a Pokémon's window with its damage, conditions, Abilities and attacks.",
            })}
          </h3>
          {showStatus ? (
            <div className="pokemon-window__status">
              <Vitals
                hp={text?.hp}
                damage={damage}
                canMark={canMark}
                {...(commitRef ? { commitRef } : {})}
                onDamage={(value) =>
                  topId &&
                  act({
                    kind: 'context',
                    action: 'setDamage',
                    cardId: topId,
                    value: value > 0 ? String(value) : '',
                  })
                }
              />
              <div className="pokemon-window__markers">
                {active
                  ? CONDITIONS.map((kind) => (
                      <Toggle
                        key={kind}
                        kind="condition"
                        label={markerHint({
                          kind: 'specialCondition',
                          value: kind,
                        })}
                        pressed={condition === kind}
                        enabled={canMark}
                        onPress={() =>
                          topId &&
                          act({
                            kind: 'context',
                            action: 'setSpecialCondition',
                            cardId: topId,
                            value:
                              condition === kind ? '' : CONDITION_CODES[kind],
                          })
                        }
                      >
                        <img
                          src={conditionArt(kind)}
                          alt=""
                          draggable={false}
                        />
                      </Toggle>
                    ))
                  : null}
                {STACK_REMINDERS.map((reminder) => {
                  const ReminderIcon = REMINDER_ICONS[reminder];
                  return (
                    <Toggle
                      key={reminder}
                      kind="reminder"
                      label={reminderName(reminder)}
                      pressed={reminders.includes(reminder)}
                      enabled={canMark}
                      onPress={() =>
                        topId &&
                        act({
                          kind: 'context',
                          action: 'setReminder',
                          cardId: topId,
                          reminder,
                        })
                      }
                    >
                      <ReminderIcon weight="bold" aria-hidden="true" />
                    </Toggle>
                  );
                })}
                <Toggle
                  kind="ability"
                  label={markerHint({ kind: 'abilityUsed', value: '' })}
                  pressed={stack.abilityUsed}
                  enabled={canMark}
                  onPress={() =>
                    topId &&
                    act({
                      kind: 'context',
                      action: 'toggleAbility',
                      cardId: topId,
                    })
                  }
                >
                  <CheckCircleIcon weight="bold" aria-hidden="true" />
                </Toggle>
              </div>
            </div>
          ) : null}
          <div
            className="pokemon-window__moves"
            aria-busy={pending ? 'true' : undefined}
            data-actions={
              canUseMoves &&
              moves.some((move) => move.ability !== undefined || active)
                ? 'true'
                : undefined
            }
          >
            {moves.map((move, index) => {
              const caption =
                move.from &&
                (index === 0 || moves[index - 1]?.from !== move.from) ? (
                  <p className="pokemon-window__from">
                    {t({
                      message: `From ${move.from}`,
                      comment:
                        "Over the moves a BREAK Pokémon keeps from the Stage under it. {from} is that card's name.",
                    })}
                  </p>
                ) : null;
              const key = `${move.cardId}:${String(index)}`;
              if (move.ability) {
                const ability = move.ability;
                return (
                  <div key={key} className="pokemon-window__move-slot">
                    {caption}
                    <AbilityRow
                      move={move}
                      ability={ability}
                      used={stack.abilityUsed}
                      canUse={canUseMoves}
                      onUse={() => {
                        act({
                          kind: 'context',
                          action: 'useAbility',
                          cardId: move.cardId,
                          name: ability.name,
                        });
                        onUsed();
                      }}
                    />
                  </div>
                );
              }
              const attack = move.attack!;
              return (
                <div key={key} className="pokemon-window__move-slot">
                  {caption}
                  <AttackRow
                    attack={attack}
                    cardId={move.cardId}
                    canUse={canUseMoves && active}
                    onUse={() => {
                      act({
                        kind: 'context',
                        action: 'useAttack',
                        cardId: move.cardId,
                        name: attack.name,
                      });
                      onUsed();
                    }}
                  />
                </div>
              );
            })}
            {pending ? (
              <div className="pokemon-window__loading" role="status">
                <span className="pokemon-window__skeleton" />
                <span className="pokemon-window__skeleton" />
                <span className="ds-visually-hidden">
                  <Trans>Reading the card…</Trans>
                </span>
              </div>
            ) : !text ? (
              <p className="pokemon-window__empty">
                <Trans>No card text</Trans>
              </p>
            ) : moves.length === 0 && !text.rules ? (
              <p className="pokemon-window__empty">
                <Trans>No Abilities or attacks</Trans>
              </p>
            ) : null}
            {text?.rules ? (
              <p className="pokemon-window__rules">
                <RulesText text={text.rules} size={15} />
              </p>
            ) : null}
          </div>
          {text &&
          (text.weakness !== undefined ||
            text.resistance !== undefined ||
            text.retreat !== undefined) ? (
            <Stats text={text} />
          ) : null}
        </section>
      </div>
    </>
  );
};

/** The window's title: whose it is and where, its name, its kind and type. */
const PokemonWindowTitle = ({
  name,
  owner,
  tone,
  slot,
  stage,
  types,
}: {
  readonly name: string;
  readonly owner: string | undefined;
  readonly tone: string;
  readonly slot: 'active' | 'bench';
  readonly stage: string | undefined;
  readonly types: readonly CardTextEnergyType[];
}) => {
  const { t } = useLingui();
  return (
    <div className="pokemon-window__title-block">
      <p className="pokemon-window__eyebrow">
        {owner ? (
          <span className={`ptcgsim-overlay-seat is-${tone}`}>{owner}</span>
        ) : null}
        <span>
          {slot === 'active'
            ? t({ message: 'Active', context: 'the Active Spot' })
            : t({ message: 'Bench', context: 'on the Bench' })}
        </span>
        {stage ? <span>{stageName(stage)}</span> : null}
      </p>
      <h2 className="pokemon-window__title">
        <span className="pokemon-window__name">{name}</span>
        {types.map((type, index) => (
          <EnergySymbol
            key={`${type}-${String(index)}`}
            type={type}
            size={22}
          />
        ))}
      </h2>
    </div>
  );
};
