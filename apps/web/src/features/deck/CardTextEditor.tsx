import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  ENERGY_TYPES,
  type CardCategory,
  type CatalogAbility,
  type CatalogAttack,
  type DeckCardText,
  type EnergyType,
} from '@ptcgsim/deck-core';
import { CARD_TEXT_LIMITS, isCardText } from '@ptcgsim/game-core';
import { useId } from 'react';

import { EnergySymbol } from './energy-symbol.js';
import { energyTypeName, stageName } from './deck-labels.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

/** The stages a Pokémon may be written as, in the order cards use them. */
const STAGES = [
  'Basic',
  'Stage 1',
  'Stage 2',
  'VSTAR',
  'VMAX',
  'BREAK',
  'Mega',
  'Restored',
  'LEGEND',
  'V-UNION',
  'Level-Up',
  'Baby',
] as const;

/** An Ability's kinds, as cards print them. */
const ABILITY_KINDS = [
  'Ability',
  'Poké-Power',
  'Poké-Body',
  'Pokémon Power',
  'Ancient Trait',
] as const;

const WEAKNESS_VALUES = ['×2', '+10', '+20', '+30', '+40'] as const;
const RESISTANCE_VALUES = ['-10', '-20', '-30', '-40'] as const;
const MAX_RETREAT = 5;

/**
 * A card's text as written, tidied: words trimmed, empty fields and moves
 * with no name dropped. Undefined when nothing is left -- the card then
 * says nothing of its own.
 */
export const tidyCardText = (text: DeckCardText): DeckCardText | undefined => {
  const words = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  const abilities = (text.abilities ?? []).flatMap((ability) => {
    const name = words(ability.name);
    return name
      ? [
          {
            name,
            kind: words(ability.kind) ?? 'Ability',
            text: ability.text.trim(),
          },
        ]
      : [];
  });
  const attacks = (text.attacks ?? []).flatMap((attack) => {
    const name = words(attack.name);
    const effect = words(attack.text);
    return name
      ? [
          {
            name,
            cost: [...attack.cost],
            damage: attack.damage.trim(),
            ...(effect ? { text: effect } : {}),
          },
        ]
      : [];
  });
  const tidy: Record<string, unknown> = {};
  if (text.hp !== undefined && text.hp > 0) tidy.hp = text.hp;
  if (text.types && text.types.length > 0) tidy.types = [...text.types];
  if (words(text.stage)) tidy.stage = words(text.stage);
  if (words(text.evolvesFrom) && text.stage !== 'Basic')
    tidy.evolvesFrom = words(text.evolvesFrom);
  if (abilities.length > 0) tidy.abilities = abilities;
  if (attacks.length > 0) tidy.attacks = attacks;
  if (text.weakness) {
    tidy.weakness = text.weakness;
    if (text.weaknessValue) tidy.weaknessValue = text.weaknessValue;
  }
  if (text.resistance) {
    tidy.resistance = text.resistance;
    if (text.resistanceValue) tidy.resistanceValue = text.resistanceValue;
  }
  if (text.retreat !== undefined && text.retreat > 0)
    tidy.retreat = text.retreat;
  if (words(text.rules)) tidy.rules = words(text.rules);
  return Object.keys(tidy).length > 0 ? (tidy as DeckCardText) : undefined;
};

/** Whether tidied text is text a card can carry to the table. */
export const isWritableCardText = (text: DeckCardText | undefined): boolean =>
  text === undefined || isCardText(text);

/** Moves written with words but no name, which would be dropped. */
export const hasUnnamedMoves = (text: DeckCardText): boolean =>
  [...(text.abilities ?? []), ...(text.attacks ?? [])].some(
    (move) =>
      move.name.trim() === '' &&
      ((move.text ?? '').trim() !== '' ||
        ('cost' in move && (move.cost.length > 0 || move.damage.trim() !== '')))
  );

/** A select of the eleven types, with none first. */
const TypeSelect = ({
  value,
  label,
  onChange,
  id,
}: {
  readonly value: EnergyType | undefined;
  readonly label: string;
  readonly onChange: (type: EnergyType | undefined) => void;
  readonly id?: string;
}) => (
  <select
    {...(id ? { id } : {})}
    className="ds-select card-text-editor__type"
    aria-label={label}
    value={value ?? ''}
    onChange={(event) =>
      onChange((event.target.value || undefined) as EnergyType | undefined)
    }
  >
    <option value="">—</option>
    {ENERGY_TYPES.map((type) => (
      <option key={type} value={type}>
        {energyTypeName(type)}
      </option>
    ))}
  </select>
);

/** An attack's cost: its symbols, each taken off with a press; + adds one. */
const CostPicker = ({
  cost,
  onChange,
}: {
  readonly cost: readonly EnergyType[];
  readonly onChange: (cost: readonly EnergyType[]) => void;
}) => {
  const { t } = useLingui();
  const full = cost.length >= CARD_TEXT_LIMITS.cost;
  return (
    <div
      className="card-text-editor__cost"
      role="group"
      aria-label={t({
        message: 'Energy cost',
        comment: "An attack's Energy cost in the card text form.",
      })}
    >
      {cost.map((type, index) => {
        const typeName = energyTypeName(type);
        return (
          <button
            key={`${type}-${String(index)}`}
            type="button"
            className="card-text-editor__cost-symbol"
            aria-label={t({
              message: `Remove ${typeName}`,
              comment:
                'Takes one Energy symbol off an attack\'s cost. {typeName} is a type ("Fire").',
            })}
            onClick={() =>
              onChange(cost.filter((_, position) => position !== index))
            }
          >
            <EnergySymbol type={type} />
          </button>
        );
      })}
      <select
        className="ds-select card-text-editor__cost-add"
        aria-label={t({
          message: 'Add an Energy to the cost',
          comment: 'A list of the eleven types; choosing one adds it.',
        })}
        value=""
        disabled={full}
        onChange={(event) => {
          const type = event.target.value as EnergyType;
          if (type) onChange([...cost, type]);
        }}
      >
        <option value="">{cost.length === 0 ? t`No cost` : '+'}</option>
        {ENERGY_TYPES.map((type) => (
          <option key={type} value={type}>
            {energyTypeName(type)}
          </option>
        ))}
      </select>
    </div>
  );
};

/**
 * What a card says, written by a player (ADR-043): a Pokémon's HP, type,
 * stage, Abilities, attacks, Weakness, Resistance and Retreat, and any
 * card's rules. Each field is bounded as the table bounds it.
 */
export const CardTextEditor = ({
  category,
  value,
  onChange,
}: {
  readonly category: CardCategory;
  readonly value: DeckCardText;
  readonly onChange: (next: DeckCardText) => void;
}) => {
  const { t } = useLingui();
  const ids = useId();
  const set = (patch: Partial<Record<keyof DeckCardText, unknown>>): void => {
    const next: Record<string, unknown> = { ...value, ...patch };
    for (const key of Object.keys(next))
      if (next[key] === undefined) delete next[key];
    onChange(next as DeckCardText);
  };
  const abilities = value.abilities ?? [];
  const attacks = value.attacks ?? [];
  const setAbility = (index: number, patch: Partial<CatalogAbility>) =>
    set({
      abilities: abilities.map((ability, position) =>
        position === index ? { ...ability, ...patch } : ability
      ),
    });
  const setAttack = (index: number, patch: Partial<CatalogAttack>) =>
    set({
      attacks: attacks.map((attack, position) =>
        position === index ? { ...attack, ...patch } : attack
      ),
    });
  const pokemon = category === 'Pokémon';
  const stage = value.stage;
  const stages: readonly string[] =
    stage && !(STAGES as readonly string[]).includes(stage)
      ? [...STAGES, stage]
      : STAGES;

  return (
    <div className="card-text-editor" data-category={category}>
      {pokemon ? (
        <>
          <div className="card-text-editor__row">
            <label className="card-text-editor__field is-narrow">
              <span>
                <Trans context="hit points">HP</Trans>
              </span>
              <input
                id={`${ids}-hp`}
                className="ds-input"
                type="number"
                inputMode="numeric"
                min={0}
                max={CARD_TEXT_LIMITS.hp}
                step={10}
                value={value.hp ?? ''}
                onChange={(event) => {
                  const hp = Number.parseInt(event.target.value, 10);
                  set({
                    hp: Number.isFinite(hp)
                      ? Math.max(0, Math.min(CARD_TEXT_LIMITS.hp, hp))
                      : undefined,
                  });
                }}
              />
            </label>
            <label className="card-text-editor__field">
              <span>
                <Trans context="a Pokémon's type">Type</Trans>
              </span>
              <TypeSelect
                id={`${ids}-type`}
                label={t({ message: 'Type', context: "a Pokémon's type" })}
                value={value.types?.[0]}
                onChange={(type) => set({ types: type ? [type] : undefined })}
              />
            </label>
            <label className="card-text-editor__field">
              <span>
                <Trans context="Pokémon stage">Stage</Trans>
              </span>
              <select
                className="ds-select"
                value={stage ?? ''}
                onChange={(event) =>
                  set({ stage: event.target.value || undefined })
                }
              >
                <option value="">—</option>
                {stages.map((name) => (
                  <option key={name} value={name}>
                    {stageName(name)}
                  </option>
                ))}
              </select>
            </label>
            {stage && stage !== 'Basic' ? (
              <label className="card-text-editor__field is-wide">
                <span>
                  <Trans>Evolves from</Trans>
                </span>
                <input
                  className="ds-input"
                  type="text"
                  maxLength={CARD_TEXT_LIMITS.name}
                  value={value.evolvesFrom ?? ''}
                  onChange={(event) =>
                    set({ evolvesFrom: event.target.value || undefined })
                  }
                />
              </label>
            ) : null}
          </div>

          <section className="card-text-editor__moves">
            {abilities.map((ability, index) => (
              <fieldset
                key={`ability-${String(index)}`}
                className="card-text-editor__move is-ability"
              >
                <legend className="ds-visually-hidden">
                  {t({
                    message: `Ability ${index + 1}`,
                    comment: 'One of the Abilities in the card text form.',
                  })}
                </legend>
                <div className="card-text-editor__move-head">
                  <select
                    className="ds-select card-text-editor__kind"
                    aria-label={t`Kind`}
                    value={ability.kind}
                    onChange={(event) =>
                      setAbility(index, { kind: event.target.value })
                    }
                  >
                    {[
                      ...ABILITY_KINDS,
                      ...((ABILITY_KINDS as readonly string[]).includes(
                        ability.kind
                      )
                        ? []
                        : [ability.kind]),
                    ].map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                  <input
                    className="ds-input card-text-editor__name"
                    type="text"
                    aria-label={t({
                      message: 'Ability name',
                      comment: "An Ability's name in the card text form.",
                    })}
                    placeholder={t`Name`}
                    maxLength={CARD_TEXT_LIMITS.name}
                    value={ability.name}
                    onChange={(event) =>
                      setAbility(index, { name: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="ds-icon-button card-text-editor__remove"
                    aria-label={t({
                      message: 'Remove this Ability',
                      comment: 'Takes an Ability out of the card text form.',
                    })}
                    onClick={() =>
                      set({
                        abilities: abilities.filter(
                          (_, position) => position !== index
                        ),
                      })
                    }
                  >
                    <TrashIcon {...decorative} weight="bold" />
                  </button>
                </div>
                <textarea
                  className="ds-textarea card-text-editor__text"
                  aria-label={t({
                    message: 'What it does',
                    comment:
                      "An Ability's or attack's text in the card text form.",
                  })}
                  placeholder={t({
                    message: 'What it does',
                    comment:
                      "An Ability's or attack's text in the card text form.",
                  })}
                  rows={2}
                  maxLength={CARD_TEXT_LIMITS.moveText}
                  value={ability.text}
                  onChange={(event) =>
                    setAbility(index, { text: event.target.value })
                  }
                />
              </fieldset>
            ))}
            {attacks.map((attack, index) => (
              <fieldset
                key={`attack-${String(index)}`}
                className="card-text-editor__move is-attack"
              >
                <legend className="ds-visually-hidden">
                  {t({
                    message: `Attack ${index + 1}`,
                    comment: 'One of the attacks in the card text form.',
                  })}
                </legend>
                <div className="card-text-editor__move-head">
                  <CostPicker
                    cost={attack.cost}
                    onChange={(cost) => setAttack(index, { cost })}
                  />
                  <input
                    className="ds-input card-text-editor__name"
                    type="text"
                    aria-label={t({
                      message: 'Attack name',
                      comment: "An attack's name in the card text form.",
                    })}
                    placeholder={t`Name`}
                    maxLength={CARD_TEXT_LIMITS.name}
                    value={attack.name}
                    onChange={(event) =>
                      setAttack(index, { name: event.target.value })
                    }
                  />
                  <input
                    className="ds-input card-text-editor__damage ds-number"
                    type="text"
                    aria-label={t({
                      message: 'Damage',
                      comment:
                        'An attack\'s damage as printed in the card text form ("30+", "120").',
                    })}
                    placeholder="0"
                    maxLength={CARD_TEXT_LIMITS.damage}
                    value={attack.damage}
                    onChange={(event) =>
                      setAttack(index, { damage: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="ds-icon-button card-text-editor__remove"
                    aria-label={t({
                      message: 'Remove this attack',
                      comment: 'Takes an attack out of the card text form.',
                    })}
                    onClick={() =>
                      set({
                        attacks: attacks.filter(
                          (_, position) => position !== index
                        ),
                      })
                    }
                  >
                    <TrashIcon {...decorative} weight="bold" />
                  </button>
                </div>
                <textarea
                  className="ds-textarea card-text-editor__text"
                  aria-label={t({
                    message: 'What it does',
                    comment:
                      "An Ability's or attack's text in the card text form.",
                  })}
                  placeholder={t({
                    message: 'What it does',
                    comment:
                      "An Ability's or attack's text in the card text form.",
                  })}
                  rows={2}
                  maxLength={CARD_TEXT_LIMITS.moveText}
                  value={attack.text ?? ''}
                  onChange={(event) =>
                    setAttack(index, { text: event.target.value })
                  }
                />
              </fieldset>
            ))}
            <div className="card-text-editor__add">
              <button
                type="button"
                className="ds-button ds-button--ghost"
                disabled={abilities.length >= CARD_TEXT_LIMITS.abilities}
                onClick={() =>
                  set({
                    abilities: [
                      ...abilities,
                      { name: '', kind: 'Ability', text: '' },
                    ],
                  })
                }
              >
                <PlusIcon {...decorative} weight="bold" />
                <Trans>Ability</Trans>
              </button>
              <button
                type="button"
                className="ds-button ds-button--ghost"
                disabled={attacks.length >= CARD_TEXT_LIMITS.attacks}
                onClick={() =>
                  set({
                    attacks: [...attacks, { name: '', cost: [], damage: '' }],
                  })
                }
              >
                <PlusIcon {...decorative} weight="bold" />
                <Trans context="add an attack">Attack</Trans>
              </button>
            </div>
          </section>

          <div className="card-text-editor__row">
            <div className="card-text-editor__field">
              <span>{t`Weakness`}</span>
              <span className="card-text-editor__pair">
                <TypeSelect
                  label={t`Weakness`}
                  value={value.weakness}
                  onChange={(weakness) =>
                    set({
                      weakness,
                      weaknessValue: weakness
                        ? (value.weaknessValue ?? '×2')
                        : undefined,
                    })
                  }
                />
                {value.weakness ? (
                  <select
                    className="ds-select card-text-editor__modifier"
                    aria-label={t({
                      message: 'Weakness amount',
                      comment: '×2, +20…',
                    })}
                    value={value.weaknessValue ?? '×2'}
                    onChange={(event) =>
                      set({ weaknessValue: event.target.value })
                    }
                  >
                    {WEAKNESS_VALUES.map((modifier) => (
                      <option key={modifier} value={modifier}>
                        {modifier}
                      </option>
                    ))}
                  </select>
                ) : null}
              </span>
            </div>
            <div className="card-text-editor__field">
              <span>{t`Resistance`}</span>
              <span className="card-text-editor__pair">
                <TypeSelect
                  label={t`Resistance`}
                  value={value.resistance}
                  onChange={(resistance) =>
                    set({
                      resistance,
                      resistanceValue: resistance
                        ? (value.resistanceValue ?? '-30')
                        : undefined,
                    })
                  }
                />
                {value.resistance ? (
                  <select
                    className="ds-select card-text-editor__modifier"
                    aria-label={t({
                      message: 'Resistance amount',
                      comment: '-30, -20…',
                    })}
                    value={value.resistanceValue ?? '-30'}
                    onChange={(event) =>
                      set({ resistanceValue: event.target.value })
                    }
                  >
                    {RESISTANCE_VALUES.map((modifier) => (
                      <option key={modifier} value={modifier}>
                        {modifier}
                      </option>
                    ))}
                  </select>
                ) : null}
              </span>
            </div>
            <label className="card-text-editor__field is-narrow">
              <span>{t`Retreat`}</span>
              <select
                className="ds-select"
                value={value.retreat ?? 0}
                onChange={(event) =>
                  set({ retreat: Number(event.target.value) || undefined })
                }
              >
                {Array.from({ length: MAX_RETREAT + 1 }, (_, count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      ) : null}
      <p className="card-text-editor__hint">
        {t({
          message: `Write ${'{R}'}, ${'{W}'}, ${'{C}'}… for Energy symbols.`,
          comment:
            'A hint under the card text form. {0}, {1} and {2} are the codes "{R}", "{W}" and "{C}", drawn as the Fire, Water and Colorless Energy symbols.',
        })}
      </p>
      <label className="card-text-editor__field is-full">
        <span>
          {pokemon ? (
            <Trans comment="A Pokémon's rule box text (ex, V…) in the card text form.">
              Rules
            </Trans>
          ) : (
            <Trans comment="A Trainer's or Energy's text in the card text form.">
              Effect
            </Trans>
          )}
        </span>
        <textarea
          className="ds-textarea card-text-editor__text"
          rows={pokemon ? 2 : 4}
          maxLength={CARD_TEXT_LIMITS.rules}
          value={value.rules ?? ''}
          onChange={(event) => set({ rules: event.target.value || undefined })}
        />
      </label>
    </div>
  );
};
