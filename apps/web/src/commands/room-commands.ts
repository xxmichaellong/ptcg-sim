import { t } from '@lingui/core/macro';
import { ArrowUUpLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowUUpLeft';
import { BroomIcon } from '@phosphor-icons/react/dist/csr/Broom';
import { ChatCircleTextIcon } from '@phosphor-icons/react/dist/csr/ChatCircleText';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { ScrollIcon } from '@phosphor-icons/react/dist/csr/Scroll';

import {
  primaryEntries,
  restEntries,
  type AppMenuModel,
} from '../session/shell/AppMenu.js';
import type { PaletteCommand } from './types.js';
import { menuCommands } from './ui-commands.js';

export interface RoomCommandContext {
  readonly menu: AppMenuModel;
  readonly shortcutsHint?: string | undefined;
  readonly log: {
    readonly open: boolean;
    readonly setOpen: (open: boolean) => void;
    readonly download?: () => void;
    readonly clear?: () => void;
  };
  /** Sends a chat line, where the room takes chat. */
  readonly say?: (text: string) => boolean;
  /** The deck screen is open over the table. */
  readonly deckOpen: boolean;
  readonly closeDeck: () => void;
}

/**
 * The room's commands (ADR-035 §3): the app menu's entries, the Log and
 * chat, and the way back from the deck screen.
 */
export const roomCommands = (context: RoomCommandContext): PaletteCommand[] => {
  const fullscreen =
    typeof document !== 'undefined' && document.fullscreenElement !== null;
  const commands = menuCommands([
    ...primaryEntries(context.menu, context.shortcutsHint, false),
    ...restEntries(context.menu, fullscreen),
  ]);
  if (context.deckOpen) {
    commands.unshift({
      id: 'room.backToTable',
      title: t`Back to the table`,
      section: 'room',
      icon: ArrowUUpLeftIcon,
      keywords: ['table', 'close', 'back', 'deck'],
      promoted: true,
      run: context.closeDeck,
    });
    return commands;
  }
  const { log } = context;
  commands.push({
    id: 'log.toggle',
    title: log.open ? t`Close log` : t`Open log`,
    // The app bar's Log button, by its own label.
    aliases: [t`Log`],
    section: 'table',
    icon: ScrollIcon,
    keywords: ['log', 'chat', 'history', 'activity'],
    run: () => log.setOpen(!log.open),
  });
  if (log.download) {
    commands.push({
      id: 'log.download',
      title: t`Download log`,
      section: 'table',
      icon: DownloadSimpleIcon,
      keywords: ['log', 'download', 'export'],
      run: log.download,
    });
  }
  if (log.clear) {
    commands.push({
      id: 'log.clear',
      title: t`Clear log`,
      section: 'table',
      icon: BroomIcon,
      keywords: ['log', 'clear'],
      dangerous: true,
      run: log.clear,
    });
  }
  const say = context.say;
  if (say) {
    commands.push({
      id: 'chat.say',
      title: t`Say…`,
      section: 'room',
      icon: ChatCircleTextIcon,
      keywords: ['chat', 'message', 'say', 'talk'],
      text: {
        label: t`Chat message`,
        placeholder: t({ message: 'Message', context: 'chat' }),
        maxLength: 500,
      },
      run: ({ text }) => {
        if (text) say(text);
      },
    });
  }
  return commands;
};
