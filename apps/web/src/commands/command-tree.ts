import type { CommandSection, PaletteCommand, PaletteScreen } from './types.js';

/** Joins the breadcrumbs of a nested command's path. */
export const PATH_SEPARATOR = ' › ';

/** A title as it reads in a path: "Move card…" → "Move card". */
export const crumbTitle = (command: PaletteCommand): string =>
  command.title.replace(/…$/u, '');

/**
 * One searchable command on a screen: listed on it, or nested in a
 * sub-screen below it, so a search can land on "Language › Français"
 * without the player opening Language first.
 */
export interface CommandEntry {
  readonly command: PaletteCommand;
  /** The sub-screens above it, outermost first; empty when listed directly. */
  readonly ancestors: readonly PaletteCommand[];
  /** Their breadcrumbs, as shown before a nested result. */
  readonly path: readonly string[];
  /** Their titles, for matching ("view flat" → Table view › Flat). */
  readonly ancestorText: string;
  /** Its top-level ancestor's section. */
  readonly section: CommandSection;
  readonly promoted: boolean;
}

/**
 * Lists a screen's commands and, depth first, what their sub-screens hold,
 * except where a command keeps its choices to itself (a card's actions:
 * the search would otherwise list every action of every card).
 */
export const flattenCommands = (
  commands: readonly PaletteCommand[],
  searchesInto: (command: PaletteCommand) => boolean = () => true
): CommandEntry[] => {
  const entries: CommandEntry[] = [];
  const visit = (
    command: PaletteCommand,
    parent: {
      readonly entry: CommandEntry;
      readonly screen: PaletteScreen;
    } | null
  ): void => {
    const entry: CommandEntry = parent
      ? {
          command,
          ancestors: [...parent.entry.ancestors, parent.entry.command],
          path: [...parent.entry.path, parent.screen.breadcrumb],
          ancestorText: [
            parent.entry.ancestorText,
            crumbTitle(parent.entry.command),
          ]
            .filter((text) => text !== '')
            .join(' '),
          section: parent.entry.section,
          promoted: parent.entry.promoted || command.promoted === true,
        }
      : {
          command,
          ancestors: [],
          path: [],
          ancestorText: '',
          section: command.section,
          promoted: command.promoted === true,
        };
    entries.push(entry);
    if (!command.submenu || !searchesInto(command)) return;
    const screen = command.submenu();
    for (const child of screen.commands) visit(child, { entry, screen });
  };
  for (const command of commands) visit(command, null);
  return entries;
};
