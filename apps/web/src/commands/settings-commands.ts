import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { CubeIcon } from '@phosphor-icons/react/dist/csr/Cube';
import { GaugeIcon } from '@phosphor-icons/react/dist/csr/Gauge';
import { ImageIcon } from '@phosphor-icons/react/dist/csr/Image';
import { PaletteIcon } from '@phosphor-icons/react/dist/csr/Palette';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { ToggleRightIcon } from '@phosphor-icons/react/dist/csr/ToggleRight';
import { TranslateIcon } from '@phosphor-icons/react/dist/csr/Translate';
import { WaveSineIcon } from '@phosphor-icons/react/dist/csr/WaveSine';
import type { Icon } from '@phosphor-icons/react';

import {
  boardViewSettings,
  type BoardShowChoice,
  type BoardViewSettings,
} from '../board/view/board-view-settings.js';
import {
  CARD_IMAGE_LANGUAGE_NAMES,
  CARD_IMAGE_PREFERENCES,
  cardImageLanguageFor,
  type CardImageChoice,
} from '../i18n/card-image-language.js';
import { LANGUAGE_PREFERENCES } from '../i18n/language-preference.js';
import { browserLocale, LOCALES } from '../i18n/locales.js';
import {
  depthSettings,
  type TableDepthMode,
} from '../motion/depth-settings.js';
import {
  motionSettings,
  type AnimationSpeed,
  type ReduceMotionChoice,
} from '../motion/motion-settings.js';
import { preferences } from '../preferences/preference-store.js';
import { TABLE_ARTS } from '../session/table-art.js';
import { TABLE_PREFERENCES } from '../session/table-preferences.js';
import type { CommandSection, PaletteCommand } from './types.js';

/** A setting with a few values: its current one shown, the rest one press away. */
const choice = <Value extends string>(options: {
  readonly id: string;
  readonly title: string;
  readonly breadcrumb: string;
  readonly section: CommandSection;
  readonly icon: Icon;
  readonly keywords: readonly string[];
  readonly current: Value;
  readonly choices: readonly {
    readonly value: Value;
    readonly label: string;
    readonly lang?: string;
  }[];
  readonly choose: (value: Value) => void;
  /** What its row says it is set to, when the choice's own name is long. */
  readonly status?: string;
}): PaletteCommand => ({
  id: options.id,
  title: options.title,
  section: options.section,
  icon: options.icon,
  keywords: options.keywords,
  status:
    options.status ??
    options.choices.find((entry) => entry.value === options.current)?.label ??
    '',
  submenu: () => ({
    breadcrumb: options.breadcrumb,
    commands: options.choices.map((entry): PaletteCommand => ({
      id: `${options.id}.${entry.value}`,
      title: entry.label,
      section: options.section,
      active: entry.value === options.current,
      run: () => options.choose(entry.value),
    })),
  }),
});

/** A setting that is on or off: the command turns it the other way. */
const toggle = (options: {
  readonly id: string;
  readonly title: string;
  readonly section: CommandSection;
  readonly keywords: readonly string[];
  readonly on: boolean;
  readonly set: (on: boolean) => void;
}): PaletteCommand => ({
  id: options.id,
  title: options.title,
  section: options.section,
  icon: ToggleRightIcon,
  keywords: options.keywords,
  status: options.on
    ? t({ message: 'On', context: 'setting' })
    : t({ message: 'Off', context: 'setting' }),
  keepOpen: true,
  run: () => options.set(!options.on),
});

/** The page's own settings, wherever the palette opens. */
export const appSettingCommands = (): PaletteCommand[] => {
  const store = preferences();
  const { language } = store.get(LANGUAGE_PREFERENCES);
  const browser =
    LOCALES.find(({ locale }) => locale === browserLocale())?.name ?? '';
  const { cardImages } = store.get(CARD_IMAGE_PREFERENCES);
  const following =
    CARD_IMAGE_LANGUAGE_NAMES[
      cardImageLanguageFor(
        'app',
        language === 'auto' ? browserLocale() : language
      )
    ];
  const motion = motionSettings().getSnapshot();
  const depth = depthSettings().getSnapshot();
  const { art } = store.get(TABLE_PREFERENCES);
  return [
    choice({
      id: 'settings.language',
      title: t`Language…`,
      breadcrumb: t`Language`,
      section: 'settings',
      icon: TranslateIcon,
      keywords: ['language', 'translate', 'locale'],
      current: language,
      ...(language === 'auto' ? { status: browser } : {}),
      choices: [
        { value: 'auto', label: t`Browser language (${browser})` },
        ...LOCALES.map(({ locale, name }) => ({
          value: locale,
          label: name,
          lang: locale,
        })),
      ],
      choose: (value) => store.set(LANGUAGE_PREFERENCES, { language: value }),
    }),
    choice<CardImageChoice>({
      id: 'settings.cardImages',
      title: t`Card image language…`,
      breadcrumb: t`Card images`,
      section: 'settings',
      icon: ImageIcon,
      keywords: ['card images', 'scans', 'language'],
      current: cardImages,
      ...(cardImages === 'app' ? { status: following } : {}),
      choices: [
        { value: 'app', label: t`Page language (${following})` },
        ...Object.entries(CARD_IMAGE_LANGUAGE_NAMES).map(([value, label]) => ({
          value: value as CardImageChoice,
          label,
        })),
      ],
      choose: (value) =>
        store.set(CARD_IMAGE_PREFERENCES, { cardImages: value }),
    }),
    choice<TableDepthMode>({
      id: 'settings.tableView',
      title: t`Table view…`,
      breadcrumb: t`Table view`,
      section: 'table',
      icon: CubeIcon,
      keywords: ['3d', 'flat', 'raised', 'tabletop', 'tilt', 'depth'],
      current: depth.mode,
      choices: [
        {
          value: 'auto',
          label: t({ message: 'Auto', context: 'table depth setting' }),
        },
        {
          value: 'flat',
          label: t({ message: 'Flat', context: 'table depth setting' }),
        },
        {
          value: 'depth',
          label: t({ message: 'Raised', context: 'table depth setting' }),
        },
        {
          value: 'table',
          label: t({ message: 'Tabletop', context: 'table depth setting' }),
        },
      ],
      choose: (mode) => depthSettings().update({ mode }),
    }),
    choice({
      id: 'settings.tableStyle',
      title: t`Table style…`,
      breadcrumb: t`Table style`,
      section: 'table',
      icon: PaletteIcon,
      keywords: ['theme', 'look', 'colour', 'color', 'mat'],
      current: art,
      choices: TABLE_ARTS.map((look) => ({
        value: look.id,
        label: i18n._(look.name),
      })),
      choose: (value) => store.patch(TABLE_PREFERENCES, { art: value }),
    }),
    choice<AnimationSpeed>({
      id: 'settings.animationSpeed',
      title: t`Animation speed…`,
      breadcrumb: t`Animation speed`,
      section: 'settings',
      icon: GaugeIcon,
      keywords: ['animation', 'speed', 'fast', 'slow'],
      current: motion.animationSpeed,
      choices: [
        {
          value: 'relaxed',
          label: t({ message: 'Relaxed', context: 'animation speed' }),
        },
        {
          value: 'normal',
          label: t({ message: 'Normal', context: 'animation speed' }),
        },
        {
          value: 'fast',
          label: t({ message: 'Fast', context: 'animation speed' }),
        },
        {
          value: 'instant',
          label: t({ message: 'Instant', context: 'animation speed' }),
        },
      ],
      choose: (animationSpeed) => motionSettings().update({ animationSpeed }),
    }),
    choice<ReduceMotionChoice>({
      id: 'settings.reduceMotion',
      title: t`Reduce motion…`,
      breadcrumb: t`Reduce motion`,
      section: 'settings',
      icon: WaveSineIcon,
      keywords: ['motion', 'animation', 'accessibility'],
      current: motion.reduceMotion,
      choices: [
        {
          value: 'system',
          label: t({ message: 'System', context: 'reduce motion setting' }),
        },
        { value: 'reduce', label: t({ message: 'On', context: 'setting' }) },
        { value: 'full', label: t({ message: 'Off', context: 'setting' }) },
      ],
      choose: (reduceMotion) => motionSettings().update({ reduceMotion }),
    }),
  ];
};

/** The table's view switches (Settings, Table), for the room's mode. */
export const boardViewCommands = (options: {
  readonly solo: boolean;
}): PaletteCommand[] => {
  const store = boardViewSettings();
  const view = store.getSnapshot();
  const set =
    <Key extends keyof BoardViewSettings>(key: Key) =>
    (value: BoardViewSettings[Key]) =>
      store.update({ [key]: value } as Partial<BoardViewSettings>);
  const commands: PaletteCommand[] = [
    choice<BoardShowChoice>({
      id: 'table.show',
      title: t`Show halves…`,
      breadcrumb: t`Show`,
      section: 'table',
      icon: SlidersHorizontalIcon,
      keywords: ['hide', 'half', 'mine', 'theirs', 'both'],
      current: view.show,
      choices: [
        {
          value: 'both',
          label: t({
            message: 'Both',
            context: 'show both halves of the table',
          }),
        },
        {
          value: 'mine',
          label: t({ message: 'Mine', context: 'my half of the table' }),
        },
        {
          value: 'theirs',
          label: t({
            message: 'Theirs',
            context: "the opponent's half of the table",
          }),
        },
      ],
      choose: set('show'),
    }),
    toggle({
      id: 'table.lostZone',
      title: t`Lost Zone`,
      section: 'table',
      keywords: ['lost zone', 'piece'],
      // On: shown even while empty; off: shown while it holds cards.
      on: view.lostZone === 'shown',
      set: (on) => store.update({ lostZone: on ? 'shown' : 'auto' }),
    }),
    toggle({
      id: 'table.vstarMarker',
      title: t`VSTAR marker`,
      section: 'table',
      keywords: ['vstar', 'marker', 'piece'],
      on: view.vstarMarker,
      set: set('vstarMarker'),
    }),
    toggle({
      id: 'table.gxMarker',
      title: t`GX marker`,
      section: 'table',
      keywords: ['gx', 'marker', 'piece'],
      on: view.gxMarker,
      set: set('gxMarker'),
    }),
    toggle({
      id: 'table.opponentCardsUpright',
      title: t`Opponent's cards face me`,
      section: 'table',
      keywords: ['upright', 'rotate', 'opponent'],
      on: view.opponentCardsUpright,
      set: set('opponentCardsUpright'),
    }),
    toggle({
      id: 'table.zoneOutlines',
      title: t`Zone outlines`,
      section: 'table',
      keywords: ['outline', 'zones'],
      on: view.zoneOutlines,
      set: set('zoneOutlines'),
    }),
    toggle({
      id: 'table.hoverPreview',
      title: t`Large card preview on hover`,
      section: 'table',
      keywords: ['preview', 'hover', 'zoom'],
      on: view.hoverPreview,
      set: set('hoverPreview'),
    }),
  ];
  if (options.solo) {
    commands.push(
      toggle({
        id: 'table.hideOpponentHand',
        title: t`Hide opponent's hand`,
        section: 'table',
        keywords: ['hand', 'hide', 'cover'],
        on: view.hideOpponentHand,
        set: set('hideOpponentHand'),
      })
    );
  }
  return commands;
};
