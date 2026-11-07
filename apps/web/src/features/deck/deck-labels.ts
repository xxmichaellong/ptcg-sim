import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type {
  CardCategory,
  CatalogSort,
  DeckFormatId,
  EnergyType,
} from '@ptcgsim/deck-core';

/**
 * The deck screen's names for the game's own words: formats, card kinds,
 * stages, types and sorts (ADR-034). The values themselves stay English --
 * they are what the catalog, the search syntax and saved decks hold -- and
 * these say them in the page's language when shown. A value with no name
 * here (one a newer catalog brought) is shown as it is.
 */

const FORMAT_NAMES: Readonly<Record<DeckFormatId, MessageDescriptor>> = {
  standard: msg({ message: 'Standard', context: 'deck format' }),
  expanded: msg({ message: 'Expanded', context: 'deck format' }),
  unlimited: msg({ message: 'Unlimited', context: 'deck format' }),
  pocket: msg({
    message: 'TCG Pocket',
    context: 'deck format',
    comment: 'The Pokémon TCG Pocket app; keep its official name.',
  }),
};

export const formatName = (format: DeckFormatId): string =>
  i18n._(FORMAT_NAMES[format]);

const CATEGORY_NAMES: Readonly<Record<CardCategory, MessageDescriptor>> = {
  Pokémon: msg({ message: 'Pokémon', context: 'card kind' }),
  Trainer: msg({ message: 'Trainer', context: 'card kind' }),
  Energy: msg({ message: 'Energy', context: 'card kind' }),
};

export const categoryName = (category: CardCategory): string =>
  i18n._(CATEGORY_NAMES[category]);

const STAGE_NAMES: Readonly<Record<string, MessageDescriptor>> = {
  Basic: msg({ message: 'Basic', context: 'Pokémon stage' }),
  'Stage 1': msg({ message: 'Stage 1', context: 'Pokémon stage' }),
  'Stage 2': msg({ message: 'Stage 2', context: 'Pokémon stage' }),
  Mega: msg({ message: 'Mega', context: 'Pokémon stage' }),
  Restored: msg({ message: 'Restored', context: 'Pokémon stage' }),
  Baby: msg({ message: 'Baby', context: 'Pokémon stage' }),
  'Level-Up': msg({ message: 'Level-Up', context: 'Pokémon stage' }),
};

/** A Pokémon's stage; mechanic names (VMAX, BREAK, LEGEND…) stay as printed. */
export const stageName = (stage: string): string => {
  const name = STAGE_NAMES[stage];
  return name ? i18n._(name) : stage;
};

const TRAINER_TYPE_NAMES: Readonly<Record<string, MessageDescriptor>> = {
  Supporter: msg({ message: 'Supporter', context: 'Trainer card kind' }),
  Item: msg({ message: 'Item', context: 'Trainer card kind' }),
  Tool: msg({ message: 'Tool', context: 'Trainer card kind: Pokémon Tool' }),
  Stadium: msg({ message: 'Stadium', context: 'Trainer card kind' }),
  'Technical Machine': msg({
    message: 'Technical Machine',
    context: 'Trainer card kind',
  }),
  Other: msg({ message: 'Other', context: 'Trainer card kind' }),
};

export const trainerTypeName = (kind: string): string => {
  const name = TRAINER_TYPE_NAMES[kind];
  return name ? i18n._(name) : kind;
};

const TRAINER_TYPE_PLURALS: Readonly<Record<string, MessageDescriptor>> = {
  Supporter: msg({ message: 'Supporters', context: 'Trainer cards by kind' }),
  Item: msg({ message: 'Items', context: 'Trainer cards by kind' }),
  Tool: msg({ message: 'Tools', context: 'Trainer cards by kind' }),
  Stadium: msg({ message: 'Stadiums', context: 'Trainer cards by kind' }),
  'Technical Machine': msg({
    message: 'Technical Machines',
    context: 'Trainer cards by kind',
  }),
  Other: msg({ message: 'Other Trainers', context: 'Trainer cards by kind' }),
};

/** A kind of Trainer as a heading over its cards: "Supporters". */
export const trainerTypePlural = (kind: string): string => {
  const name = TRAINER_TYPE_PLURALS[kind];
  return name ? i18n._(name) : `${kind}s`;
};

const ENERGY_TYPE_NAMES: Readonly<Record<EnergyType, MessageDescriptor>> = {
  Grass: msg({ message: 'Grass', context: 'Pokémon type' }),
  Fire: msg({ message: 'Fire', context: 'Pokémon type' }),
  Water: msg({ message: 'Water', context: 'Pokémon type' }),
  Lightning: msg({ message: 'Lightning', context: 'Pokémon type' }),
  Psychic: msg({ message: 'Psychic', context: 'Pokémon type' }),
  Fighting: msg({ message: 'Fighting', context: 'Pokémon type' }),
  Darkness: msg({ message: 'Darkness', context: 'Pokémon type' }),
  Metal: msg({ message: 'Metal', context: 'Pokémon type' }),
  Fairy: msg({ message: 'Fairy', context: 'Pokémon type' }),
  Dragon: msg({ message: 'Dragon', context: 'Pokémon type' }),
  Colorless: msg({ message: 'Colorless', context: 'Pokémon type' }),
};

/** A type's name: "Fire". Unknown ones (a hand-typed Weakness) as they are. */
export const energyTypeName = (type: string): string => {
  const name = ENERGY_TYPE_NAMES[type as EnergyType];
  return name ? i18n._(name) : type;
};

const ENERGY_KIND_NAMES: Readonly<
  Record<'Basic' | 'Special', MessageDescriptor>
> = {
  Basic: msg({ message: 'Basic', context: 'Energy card kind' }),
  Special: msg({ message: 'Special', context: 'Energy card kind' }),
};

export const energyKindName = (kind: 'Basic' | 'Special'): string =>
  i18n._(ENERGY_KIND_NAMES[kind]);

const ENERGY_CARD_NAMES: Readonly<
  Record<'Basic' | 'Special', MessageDescriptor>
> = {
  Basic: msg`Basic Energy`,
  Special: msg`Special Energy`,
};

/** "Basic Energy" or "Special Energy". */
export const energyCardName = (kind: 'Basic' | 'Special'): string =>
  i18n._(ENERGY_CARD_NAMES[kind]);

const TAG_NAMES: Readonly<Record<string, MessageDescriptor>> = {
  Radiant: msg({ message: 'Radiant', context: 'Pokémon card mechanic' }),
  Ancient: msg({ message: 'Ancient', context: 'Pokémon card mechanic' }),
  Future: msg({ message: 'Future', context: 'Pokémon card mechanic' }),
  Mega: msg({ message: 'Mega', context: 'Pokémon card mechanic' }),
  'Prism Star': msg({
    message: 'Prism Star',
    context: 'Pokémon card mechanic',
  }),
  'Single Strike': msg({
    message: 'Single Strike',
    context: 'Pokémon card mechanic',
  }),
  'Rapid Strike': msg({
    message: 'Rapid Strike',
    context: 'Pokémon card mechanic',
  }),
  'Fusion Strike': msg({
    message: 'Fusion Strike',
    context: 'Pokémon card mechanic',
  }),
};

/**
 * A card mechanic's name. Those printed as logos (ex, V, VSTAR, VMAX,
 * Tera, ACE SPEC, BREAK…) read the same in every language and stay.
 */
export const tagName = (tag: string): string => {
  const name = TAG_NAMES[tag];
  return name ? i18n._(name) : tag;
};

const SORT_NAMES: Readonly<Record<CatalogSort, MessageDescriptor>> = {
  newest: msg({ message: 'Newest', context: 'sort cards by' }),
  oldest: msg({ message: 'Oldest', context: 'sort cards by' }),
  name: msg({ message: 'Name', context: 'sort cards by' }),
  hp: msg({ message: 'HP', context: 'sort cards by' }),
  type: msg({ message: 'Type', context: 'sort cards by' }),
  set: msg({ message: 'Set & number', context: 'sort cards by' }),
};

export const sortName = (sort: CatalogSort): string => i18n._(SORT_NAMES[sort]);
