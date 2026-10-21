import type { Icon } from '@phosphor-icons/react';

/**
 * The palette's sections, in the order an empty search lists them
 * (ADR-035 §3). Recent is drawn above them.
 */
export const COMMAND_SECTIONS = [
  'selected',
  'turn',
  'deck',
  'cards',
  'piles',
  'table',
  'room',
  'settings',
  'help',
] as const;
export type CommandSection = (typeof COMMAND_SECTIONS)[number];

/** A number a command takes, inline ("draw 3") or asked for. */
export interface CommandCount {
  /** What the field asks for: "How many cards?". */
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /** What the field starts at when it asks. */
  readonly initial?: number;
  /** The title with the number in it: "Draw 3 cards". */
  readonly title: (count: number) => string;
}

/** Text a command takes, asked for in the field ("Say…"). */
export interface CommandText {
  readonly label: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
}

export interface CommandInput {
  readonly count?: number;
  readonly text?: string;
}

/**
 * One thing the palette can do. It runs an action the table already has,
 * through the same path as its button, menu entry or key (ADR-035 §1).
 * A command has exactly one of `run` and `submenu`.
 */
export interface PaletteCommand {
  /**
   * Stable and namespaced (`turn.attack`, `card.moveTo.bench`): recents
   * remember commands by it.
   */
  readonly id: string;
  /** In the player's language. */
  readonly title: string;
  readonly section: CommandSection;
  /**
   * Other words it answers to, matched a little below its title: synonyms,
   * and English words, so they work in every language.
   */
  readonly keywords?: readonly string[];
  readonly icon?: Icon;
  /** A picture in the icon's place: a card's own face. */
  readonly image?: { readonly src: string; readonly fallback?: string };
  /** What it acts on, read after the title: a card's name, a seat. */
  readonly detail?: string;
  /** The key that does the same, from the player's keymap. */
  readonly hint?: string;
  /** The current value of a setting it changes: "Flat". */
  readonly status?: string;
  /** The current choice among its siblings, or a setting that is on. */
  readonly active?: boolean;
  /** Asks for a second Enter before it runs. */
  readonly dangerous?: boolean;
  /** Stays open after running, for a step taken again (draw one, +10). */
  readonly keepOpen?: boolean;
  /** Listed only when searched for (every card, every language). */
  readonly requiresQuery?: boolean;
  /** Ranked a little above its peers. */
  readonly promoted?: boolean;
  /**
   * False: a search from the screen above doesn't look into its choices
   * (a card's actions, which would list every action of every card).
   */
  readonly nestedSearch?: false;
  readonly count?: CommandCount;
  readonly text?: CommandText;
  readonly submenu?: () => PaletteScreen;
  readonly run?: (input: CommandInput) => void;
}

/** A screen of choices a command opens. */
export interface PaletteScreen {
  /** Shown in the search field while it is open: "Move Pikachu". */
  readonly breadcrumb: string;
  readonly placeholder?: string;
  readonly commands: readonly PaletteCommand[];
}
