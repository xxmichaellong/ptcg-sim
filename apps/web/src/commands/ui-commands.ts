import { t } from '@lingui/core/macro';
import { GraduationCapIcon } from '@phosphor-icons/react/dist/csr/GraduationCap';
import { LightningIcon } from '@phosphor-icons/react/dist/csr/Lightning';

import type { RailAction } from '../board/rail/TableRail.js';
import type { ActionMenuEntry } from '../ui/ActionMenu.js';
import type { CommandSection, PaletteCommand } from './types.js';

/**
 * The rail's and the menu's buttons as commands (ADR-035 §1): the palette
 * offers exactly what they offer, when they offer it, and runs the same
 * handler.
 */

interface Meaning {
  readonly section: CommandSection;
  readonly title?: string;
  readonly keywords?: readonly string[];
  readonly dangerous?: boolean;
}

/**
 * "p2AttackButton" → "attack": one id for either seat's button. Play
 * online's "p2Button" keeps its name ("p2").
 */
const commandId = (id: string): string => {
  const bare = id
    .replace(/(Button|MenuItem)$/u, '')
    .replace(/^p2(?=[A-Z])/u, '');
  return bare.charAt(0).toLowerCase() + bare.slice(1);
};

const RAIL_MEANINGS: Readonly<Record<string, () => Meaning>> = {
  setup: () => ({ section: 'turn', keywords: ['setup', 'start', 'prizes'] }),
  reset: () => ({
    section: 'turn',
    dangerous: true,
    keywords: ['reset', 'clear'],
  }),
  turn: () => ({ section: 'turn', keywords: ['turn', 'start'] }),
  attack: () => ({ section: 'turn', keywords: ['attack'] }),
  pass: () => ({ section: 'turn', keywords: ['pass', 'end turn'] }),
  undo: () => ({ section: 'turn', keywords: ['undo', 'back'] }),
  mulligan: () => ({ section: 'turn', keywords: ['mulligan'] }),
  setupBoth: () => ({ section: 'turn', keywords: ['setup', 'both'] }),
  resetBoth: () => ({
    section: 'turn',
    dangerous: true,
    keywords: ['reset', 'both'],
  }),
  loadDeck: () => ({ section: 'turn', keywords: ['deck', 'load', 'import'] }),
  flipBoard: () => ({
    section: 'table',
    title: t`Turn the table around`,
    keywords: ['flip', 'switch side', 'rotate', 'other seat'],
  }),
};

const command = (
  id: string,
  title: string,
  meaning: Meaning,
  extra: Pick<PaletteCommand, 'icon' | 'hint' | 'detail'> & {
    /** The button's own label, which the lessons name it by ("Passen"). */
    readonly label?: string;
  },
  run: () => void
): PaletteCommand => {
  const named = meaning.title ?? title;
  // Found by the names the button shows too (its label, its tooltip) when
  // the palette names it otherwise ("Flip the table").
  const aliases = [...new Set([extra.label, title])].filter(
    (alias): alias is string => alias !== undefined && alias !== named
  );
  return {
    id,
    title: named,
    section: meaning.section,
    icon: extra.icon ?? LightningIcon,
    ...(extra.hint ? { hint: extra.hint } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(meaning.keywords ? { keywords: meaning.keywords } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(meaning.dangerous ? { dangerous: true } : {}),
    run: () => run(),
  };
};

/**
 * The table rail's actions and its More, for the seat it acts for.
 * `skip` leaves out what another source lists better (the coins).
 */
export const railCommands = (
  composed: {
    readonly actions: readonly RailAction[];
    readonly more?: readonly ActionMenuEntry[];
  },
  options: {
    readonly replaying: boolean;
    readonly seat?: string;
    readonly skip?: ReadonlySet<string>;
  }
): PaletteCommand[] => {
  const commands: PaletteCommand[] = [];
  const seen = new Set<string>();
  const add = (
    id: string,
    title: string,
    extra: Pick<PaletteCommand, 'icon' | 'hint'> & {
      readonly label?: string;
    },
    run: () => void
  ) => {
    const bare = commandId(id);
    if (options.skip?.has(bare)) return;
    const key =
      options.replaying && bare !== 'flipBoard'
        ? `replay.${bare}`
        : `rail.${bare}`;
    if (seen.has(key)) return;
    seen.add(key);
    const meaning: Meaning = options.replaying
      ? bare === 'flipBoard'
        ? RAIL_MEANINGS.flipBoard!()
        : { section: 'room', keywords: ['replay'] }
      : (RAIL_MEANINGS[bare]?.() ?? { section: 'turn' });
    commands.push(
      command(
        key,
        title,
        meaning,
        {
          ...extra,
          ...(options.seat && meaning.section === 'turn'
            ? { detail: options.seat }
            : {}),
        },
        run
      )
    );
  };
  for (const action of composed.actions) {
    add(
      action.id,
      action.title ?? action.label,
      {
        icon: action.icon,
        label: action.label,
        ...(action.hint ? { hint: action.hint } : {}),
      },
      action.onSelect
    );
  }
  for (const entry of composed.more ?? []) {
    if (entry.kind === 'separator' || entry.kind === 'label') continue;
    if (entry.disabled || typeof entry.label !== 'string' || !entry.id)
      continue;
    add(
      entry.id,
      entry.label,
      {
        ...(entry.icon ? { icon: entry.icon } : {}),
        ...(entry.hint ? { hint: entry.hint } : {}),
      },
      entry.onSelect
    );
  }
  return commands;
};

const MENU_MEANINGS: Readonly<Record<string, () => Meaning>> = {
  p1: () => ({
    section: 'room',
    title: t`Go to the Solo table`,
    keywords: ['solo', 'practice'],
  }),
  deckImport: () => ({
    section: 'room',
    title: t`Open the deck screen`,
    keywords: ['deck', 'load', 'import', 'build'],
  }),
  p2: () => ({
    section: 'room',
    keywords: ['online', 'multiplayer', 'invite', 'friend'],
  }),
  shortcuts: () => ({
    section: 'help',
    keywords: ['keys', 'hotkeys', 'keyboard'],
  }),
  settings: () => ({
    section: 'settings',
    title: t`Open Settings`,
    keywords: ['settings', 'options', 'preferences'],
  }),
  exitReplay: () => ({ section: 'room', keywords: ['replay', 'exit'] }),
  importReplay: () => ({
    section: 'room',
    keywords: ['replay', 'watch', 'file'],
  }),
  saveOnlineGame: () => ({ section: 'room', keywords: ['save'] }),
  resumeSavedGame: () => ({
    section: 'room',
    keywords: ['resume', 'load', 'save'],
  }),
  exportState: () => ({
    section: 'room',
    keywords: ['replay', 'download', 'export'],
  }),
  fullscreen: () => ({
    section: 'table',
    keywords: ['fullscreen', 'full screen'],
  }),
  tutorial: () => ({
    section: 'help',
    keywords: ['help', 'tutorial', 'learn', 'lessons'],
  }),
  // On the practice table: the lessons are what "lesson" or "help" look
  // for there, not the way out of them, which drops the table and the
  // lesson (a second Enter, as found by "tutorial").
  leaveTutorial: () => ({
    section: 'room',
    dangerous: true,
    keywords: ['leave', 'exit', 'quit'],
  }),
  changelog: () => ({
    section: 'help',
    title: t`What's new`,
    keywords: ['changelog', 'release', 'version'],
  }),
  donations: () => ({
    section: 'help',
    keywords: ['sponsor', 'donate', 'support'],
  }),
  discord: () => ({
    section: 'help',
    keywords: ['discord', 'community', 'chat'],
  }),
  copyInvitation: () => ({
    section: 'room',
    keywords: ['invite', 'invitation', 'copy', 'friend'],
  }),
  leaveRoom: () => ({ section: 'room', keywords: ['leave', 'quit', 'exit'] }),
};

/** The app menu's rows (the toolbar and its More), as commands. */
export const menuCommands = (
  entries: readonly (
    | ActionMenuEntry
    | {
        readonly id: string;
        readonly label: string;
        readonly icon?: RailAction['icon'];
        readonly hint?: string | undefined;
        readonly onSelect: () => void;
      }
  )[]
): PaletteCommand[] => {
  const commands: PaletteCommand[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (
      'kind' in entry &&
      (entry.kind === 'separator' || entry.kind === 'label')
    )
      continue;
    if (!('onSelect' in entry) || !entry.id || typeof entry.label !== 'string')
      continue;
    if ('disabled' in entry && entry.disabled) continue;
    const bare = commandId(entry.id);
    // The button that opens the palette has nothing to do in it.
    if (bare === 'commands') continue;
    const meaning = MENU_MEANINGS[bare]?.() ?? { section: 'room' as const };
    const id = `menu.${bare}`;
    if (seen.has(id)) continue;
    seen.add(id);
    commands.push(
      command(
        id,
        entry.label,
        meaning,
        {
          label: entry.label,
          ...(entry.icon ? { icon: entry.icon } : {}),
          ...(entry.hint ? { hint: entry.hint } : {}),
          ...(bare === 'changelog' ? { detail: entry.label } : {}),
        },
        entry.onSelect
      )
    );
  }
  return commands;
};

/**
 * Each tutorial lesson as a command of its own (ADR-038), so "tutorial
 * damage" goes straight to that lesson: from a Solo table, or on the
 * practice table to change lesson.
 */
export const tutorialLessonCommands = (
  lessons: readonly { readonly id: string; readonly title: string }[],
  start: (lesson: string) => void,
  options: { readonly practice?: boolean } = {}
): PaletteCommand[] =>
  lessons.map((lesson) => {
    const tutorial = t`Tutorial`;
    return {
      id: `tutorial.${lesson.id}`,
      title: lesson.title,
      section: 'help',
      icon: GraduationCapIcon,
      detail: tutorial,
      demoted: true,
      // On the practice table "help" or "lessons" asks for a lesson, before
      // any table action those letters happen to spell out.
      ...(options.practice ? { aliases: ['lessons', 'learn', 'help'] } : {}),
      // A search matches one text at a time: "tutorial damage" needs the
      // two together, in English and in the page's language.
      keywords: [
        'tutorial',
        'lessons',
        'learn',
        tutorial,
        `tutorial ${lesson.title}`,
        `${tutorial} ${lesson.title}`,
      ],
      run: () => start(lesson.id),
    };
  });
