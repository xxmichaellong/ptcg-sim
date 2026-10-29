import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { AngleIcon } from '@phosphor-icons/react/dist/csr/Angle';
import { CubeIcon } from '@phosphor-icons/react/dist/csr/Cube';
import { GaugeIcon } from '@phosphor-icons/react/dist/csr/Gauge';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { ImageIcon } from '@phosphor-icons/react/dist/csr/Image';
import { ImageSquareIcon } from '@phosphor-icons/react/dist/csr/ImageSquare';
import { LinkSimpleIcon } from '@phosphor-icons/react/dist/csr/LinkSimple';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { PaletteIcon } from '@phosphor-icons/react/dist/csr/Palette';
import { RowsIcon } from '@phosphor-icons/react/dist/csr/Rows';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack';
import { ToggleRightIcon } from '@phosphor-icons/react/dist/csr/ToggleRight';
import { TranslateIcon } from '@phosphor-icons/react/dist/csr/Translate';
import { WaveSineIcon } from '@phosphor-icons/react/dist/csr/WaveSine';
import type { Icon } from '@phosphor-icons/react';
import { TABLE_SPLIT, TABLE_TILT_MAXIMUM } from '@ptcgsim/renderer-contract';

import {
  boardViewSettings,
  type BoardShowChoice,
  type BoardViewSettings,
} from '../board/view/board-view-settings.js';
import { resetTableView } from '../board/view/TableViewControls.js';
import { CARD_BACK_VIEW_PREFERENCES } from '../card-backs/card-back-preferences.js';
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
import {
  ROOM_WALLPAPERS,
  type BackgroundChoice,
  type RoomBackground,
} from '../session/browser-room-background.js';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from '../session/shell/settings-sheet-state.js';
import { TABLE_ARTS } from '../session/table-art.js';
import { TABLE_PREFERENCES } from '../session/table-preferences.js';
import { TOUCH_ONLY_QUERY } from '../ui/breakpoints.js';
import type { CommandSection, PaletteCommand } from './types.js';

/** A setting with a few values: its current one shown, the rest one press away. */
export const choice = <Value extends string>(options: {
  readonly id: string;
  readonly title: string;
  readonly breadcrumb: string;
  readonly section: CommandSection;
  /** Where it is in Settings: the section's heading. */
  readonly detail?: string;
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
  ...(options.detail ? { detail: options.detail } : {}),
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
export const toggle = (options: {
  readonly id: string;
  readonly title: string;
  readonly section: CommandSection;
  readonly detail?: string;
  readonly keywords: readonly string[];
  readonly on: boolean;
  readonly set: (on: boolean) => void;
}): PaletteCommand => ({
  id: options.id,
  title: options.title,
  section: options.section,
  ...(options.detail ? { detail: options.detail } : {}),
  icon: ToggleRightIcon,
  keywords: options.keywords,
  status: options.on
    ? t({ message: 'On', context: 'setting' })
    : t({ message: 'Off', context: 'setting' }),
  keepOpen: true,
  run: () => options.set(!options.on),
});

/** Settings' section headings, as the sheet shows them. */
export const settingsSectionName = (section: SettingsSectionId): string => {
  switch (section) {
    case 'room':
      return t`Room`;
    case 'table':
      return t`Table`;
    case 'cards':
      return t`Cards`;
    case 'motion':
      return t`Motion`;
    case 'keys':
      return t`Keys`;
    case 'language':
      return t`Language`;
  }
};

const touchOnly = (): boolean =>
  typeof globalThis.matchMedia === 'function' &&
  globalThis.matchMedia(TOUCH_ONLY_QUERY).matches;

/**
 * Settings itself, and each of its sections ("Settings: Cards"), for the
 * screen whose sheet it is.
 */
export const settingsSheetCommands = (options: {
  readonly sections: readonly SettingsSectionId[];
  readonly open: (section?: SettingsSectionId) => void;
  /** Settings' own key (`,`). */
  readonly hint?: string | undefined;
  readonly darkMode: boolean;
  readonly onDarkModeChange: (enabled: boolean) => void;
  readonly background: BackgroundChoice;
}): PaletteCommand[] => [
  {
    id: 'menu.settings',
    title: t`Settings`,
    section: 'settings',
    icon: GearSixIcon,
    ...(options.hint ? { hint: options.hint } : {}),
    keywords: ['settings', 'options', 'preferences'],
    promoted: true,
    run: () => options.open(),
  },
  ...SETTINGS_SECTIONS.filter((section) =>
    options.sections.includes(section)
  ).map((section): PaletteCommand => ({
    id: `settings.section.${section}`,
    title: t({
      message: `Settings: ${settingsSectionName(section)}`,
      comment: 'Opens Settings at that section',
    }),
    section: 'settings',
    icon: GearSixIcon,
    keywords: ['settings', section],
    demoted: true,
    run: () => options.open(section),
  })),
  backgroundCommand(options.background, () => options.open('table')),
  toggle({
    id: 'settings.darkMode',
    title: t`Dark mode`,
    section: 'settings',
    detail: settingsSectionName('table'),
    keywords: ['dark', 'night', 'day', 'theme', 'light'],
    on: options.darkMode,
    set: options.onDarkModeChange,
  }),
];

/**
 * Background…: the desk, nothing, a wallpaper, the player's own picture in
 * use, or one more -- a picture (in Settings, where it is picked or
 * dropped) or a link.
 */
const backgroundCommand = (
  background: BackgroundChoice,
  openTable: () => void
): PaletteCommand => {
  const { current } = background;
  const wallpaper =
    current?.kind === 'image'
      ? ROOM_WALLPAPERS.findIndex((entry) => entry.url === current.url)
      : -1;
  const selected = !current
    ? 'desk'
    : current.kind === 'blank'
      ? 'none'
      : wallpaper >= 0
        ? `wallpaper${String(wallpaper + 1)}`
        : 'custom';
  const named = (value: string): string => {
    switch (value) {
      case 'desk':
        return t({ message: 'Desk', context: 'the default background' });
      case 'none':
        return t({ message: 'None', context: 'no background' });
      case 'custom':
        return t({ message: 'Custom', context: "the player's own background" });
      default:
        return t`Wallpaper ${value.slice('wallpaper'.length)}`;
    }
  };
  const pick = (
    value: string,
    next: RoomBackground | undefined
  ): PaletteCommand => ({
    id: `settings.background.${value}`,
    title: named(value),
    section: 'settings',
    active: selected === value,
    run: () => background.onChange(next),
  });
  return {
    id: 'settings.background',
    title: t`Background…`,
    section: 'settings',
    detail: settingsSectionName('table'),
    icon: ImageSquareIcon,
    keywords: ['background', 'wallpaper', 'desk', 'picture', 'image'],
    status: named(selected),
    submenu: () => ({
      breadcrumb: t`Background`,
      commands: [
        pick('desk', undefined),
        pick('none', { kind: 'blank' }),
        ...ROOM_WALLPAPERS.map((entry, index) =>
          pick(`wallpaper${String(index + 1)}`, {
            kind: 'image',
            url: entry.url,
          })
        ),
        ...(selected === 'custom' ? [pick('custom', current)] : []),
        {
          id: 'settings.background.picture',
          title: t`Custom image…`,
          section: 'settings',
          icon: PlusIcon,
          run: openTable,
        },
        {
          id: 'settings.background.link',
          title: t`From a link…`,
          section: 'settings',
          icon: LinkSimpleIcon,
          run: background.onRequestLink,
        },
      ],
    }),
  };
};

/**
 * Settings' rows kept on this device, wherever the palette opens: titled as
 * in the sheet, its section read after.
 */
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
  const depthStore = depthSettings();
  const depth = depthStore.getSnapshot();
  const viewStore = boardViewSettings();
  const view = viewStore.getSnapshot();
  const { art } = store.get(TABLE_PREFERENCES);
  const { opponentCustomBacks } = store.get(CARD_BACK_VIEW_PREFERENCES);
  const setView =
    <Key extends keyof BoardViewSettings>(key: Key) =>
    (value: BoardViewSettings[Key]) =>
      viewStore.update({ [key]: value } as Partial<BoardViewSettings>);
  const table = settingsSectionName('table');
  const cards = settingsSectionName('cards');
  const motionName = settingsSectionName('motion');
  const languageName = settingsSectionName('language');
  const touch = touchOnly();
  const lower = Math.round(view.split * 100);
  const commands: PaletteCommand[] = [
    // Table
    choice({
      id: 'settings.tableStyle',
      title: t({ message: 'Style…', context: "the table's look" }),
      breadcrumb: t({ message: 'Style', context: "the table's look" }),
      section: 'settings',
      detail: table,
      icon: PaletteIcon,
      keywords: ['table style', 'theme', 'look', 'colour', 'color', 'mat'],
      current: art,
      choices: TABLE_ARTS.map((look) => ({
        value: look.id,
        label: i18n._(look.name),
      })),
      choose: (value) => store.patch(TABLE_PREFERENCES, { art: value }),
    }),
    choice<TableDepthMode>({
      id: 'settings.tableView',
      title: t({ message: 'Depth…', context: 'how 3D the table looks' }),
      breadcrumb: t({ message: 'Depth', context: 'how 3D the table looks' }),
      section: 'settings',
      detail: table,
      icon: CubeIcon,
      keywords: ['3d', 'flat', 'raised', 'tabletop', 'tilt', 'table view'],
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
      choose: (mode) => depthStore.update({ mode }),
    }),
    {
      id: 'settings.tableAngle',
      title: t({ message: 'Angle…', context: "the table's tilt" }),
      section: 'settings',
      detail: table,
      icon: AngleIcon,
      keywords: ['angle', 'tilt', 'tabletop'],
      status: `${String(depth.tilt)}°`,
      count: {
        label: t`Angle in degrees`,
        min: 0,
        max: TABLE_TILT_MAXIMUM,
        initial: depth.tilt,
        title: (count) => t`Angle ${count}°`,
      },
      run: ({ count }) => {
        if (count !== undefined) depthStore.update({ tilt: count });
      },
    },
    choice({
      id: 'settings.tableThickness',
      title: t({ message: 'Thickness…', context: "the cards' thickness" }),
      breadcrumb: t({ message: 'Thickness', context: "the cards' thickness" }),
      section: 'settings',
      detail: table,
      icon: StackIcon,
      keywords: ['thickness', 'card thickness', 'depth'],
      current: depth.strength.toFixed(1),
      status: `${depth.strength.toFixed(1)}×`,
      choices: ['0.0', '0.5', '1.0', '1.5', '2.0'].map((value) => ({
        value,
        label: `${value}×`,
      })),
      choose: (value) => depthStore.update({ strength: Number(value) }),
    }),
    choice<BoardShowChoice>({
      id: 'table.show',
      title: t({ message: 'Halves…', context: 'which halves of the table' }),
      breadcrumb: t({
        message: 'Halves',
        context: 'which halves of the table',
      }),
      section: 'settings',
      detail: table,
      icon: SlidersHorizontalIcon,
      keywords: ['show', 'hide', 'half', 'mine', 'theirs', 'both'],
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
      choose: setView('show'),
    }),
    {
      id: 'settings.tableSplit',
      title: t({ message: 'Split…', context: 'the table between the halves' }),
      section: 'settings',
      detail: table,
      icon: RowsIcon,
      keywords: ['split', 'halves', 'height', 'resize'],
      status: `${String(100 - lower)} · ${String(lower)}`,
      count: {
        label: t`My half, in percent`,
        min: Math.round(TABLE_SPLIT.minimumLowerShare * 100),
        max: Math.round(TABLE_SPLIT.maximumLowerShare * 100),
        initial: lower,
        title: (count) => t`My half ${count}% of the table`,
      },
      run: ({ count }) => {
        if (count !== undefined) viewStore.update({ split: count / 100 });
      },
    },
    toggle({
      id: 'table.zoneOutlines',
      title: t`Zone outlines`,
      section: 'settings',
      detail: table,
      keywords: ['outline', 'zones'],
      on: view.zoneOutlines,
      set: setView('zoneOutlines'),
    }),
    {
      id: 'settings.resetTable',
      title: t`Reset table settings`,
      section: 'settings',
      detail: table,
      icon: ArrowCounterClockwiseIcon,
      keywords: ['reset', 'default', 'table view', 'depth'],
      run: resetTableView,
    },
    // Cards
    toggle({
      id: 'table.opponentCardsUpright',
      title: t`Opponent's cards face me`,
      section: 'settings',
      detail: cards,
      keywords: ['upright', 'rotate', 'opponent'],
      on: view.opponentCardsUpright,
      set: setView('opponentCardsUpright'),
    }),
    ...(touch
      ? []
      : [
          toggle({
            id: 'table.hoverPreview',
            title: t`Preview on hover`,
            section: 'settings',
            detail: cards,
            keywords: ['preview', 'hover', 'zoom', 'large'],
            on: view.hoverPreview,
            set: setView('hoverPreview'),
          }),
        ]),
    toggle({
      id: 'settings.naturalPlacement',
      title: t`Natural placement`,
      section: 'settings',
      detail: cards,
      keywords: ['scatter', 'askew', 'natural', 'placement'],
      on: depth.scatter !== false,
      set: (scatter) => depthStore.update({ scatter }),
    }),
    toggle({
      id: 'settings.opponentCustomBacks',
      title: t`Opponents' custom backs`,
      section: 'settings',
      detail: cards,
      keywords: ['card back', 'sleeve', 'opponent', 'custom'],
      on: opponentCustomBacks,
      set: (enabled) =>
        store.set(CARD_BACK_VIEW_PREFERENCES, {
          opponentCustomBacks: enabled,
        }),
    }),
    // Motion
    choice<ReduceMotionChoice>({
      id: 'settings.reduceMotion',
      title: t`Reduce motion…`,
      breadcrumb: t`Reduce motion`,
      section: 'settings',
      detail: motionName,
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
    choice<AnimationSpeed>({
      id: 'settings.animationSpeed',
      title: t({ message: 'Speed…', context: 'animation speed' }),
      breadcrumb: t({ message: 'Speed', context: 'animation speed' }),
      section: 'settings',
      detail: motionName,
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
    toggle({
      id: 'settings.liftWhileDragging',
      title: t`Lift while dragging`,
      section: 'settings',
      detail: motionName,
      keywords: ['lift', 'drag', 'depth'],
      on: depth.lift,
      set: (lift) => depthStore.update({ lift }),
    }),
    toggle({
      id: 'settings.animateStacks',
      title: t`Animate stacks`,
      section: 'settings',
      detail: motionName,
      keywords: ['stack', 'height', 'animate'],
      on: depth.animate,
      set: (animate) => depthStore.update({ animate }),
    }),
    ...(touch
      ? []
      : [
          toggle({
            id: 'settings.parallax',
            title: t`Parallax`,
            section: 'settings',
            detail: motionName,
            keywords: ['parallax', 'pointer', 'lean', 'tilt'],
            on: depth.parallax === true,
            set: (parallax) => depthStore.update({ parallax }),
          }),
        ]),
    // Language
    choice({
      id: 'settings.language',
      title: t`Language…`,
      breadcrumb: t`Language`,
      section: 'settings',
      detail: languageName,
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
      title: t`Card images…`,
      breadcrumb: t`Card images`,
      section: 'settings',
      detail: languageName,
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
  ];
  return commands;
};

/**
 * The table's own pieces and the Solo cover, which are not Settings: the
 * Lost Zone and the markers (also on the mat's +) and the opponent's hand
 * (also on its pill).
 */
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
