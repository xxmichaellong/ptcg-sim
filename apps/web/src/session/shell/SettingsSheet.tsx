import {
  PlayerNameControls,
  type PlayerNameChoice,
} from '../PlayerNameControls.js';
import { Trans, useLingui } from '@lingui/react/macro';
import type { Icon } from '@phosphor-icons/react';
import { ArrowsDownUpIcon } from '@phosphor-icons/react/dist/csr/ArrowsDownUp';
import { BugIcon } from '@phosphor-icons/react/dist/csr/Bug';
import { CardFanIcon } from '../../ui/CardFanIcon.js';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/csr/DiscordLogo';
import { FilmReelIcon } from '@phosphor-icons/react/dist/csr/FilmReel';
import { GithubLogoIcon } from '@phosphor-icons/react/dist/csr/GithubLogo';
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { InfoIcon } from '@phosphor-icons/react/dist/csr/Info';
import { KeyboardIcon } from '@phosphor-icons/react/dist/csr/Keyboard';
import { PaletteIcon } from '@phosphor-icons/react/dist/csr/Palette';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { TranslateIcon } from '@phosphor-icons/react/dist/csr/Translate';
import { ShootingStarIcon } from '@phosphor-icons/react/dist/csr/ShootingStar';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { CARD_IMAGE_LANGUAGES, isCardImageLanguage } from '@ptcgsim/deck-core';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';

import { AccountSavesGroup } from '../../account/AccountSaves.js';
import {
  AccountPage,
  AccountRow,
  DeleteAccountPage,
  SignOutPage,
  SignInMethodsPage,
  SignInPage,
} from '../../account/AccountPages.js';
import {
  AccountReplaysPage,
  AccountReplaysRow,
} from '../../account/AccountReplaysPage.js';
import { useAccount } from '../../account/account-state.js';
import { TableArtControls } from '../../board/view/TableArtControls.js';
import {
  CardViewControls,
  DepthMotionControls,
  ResetTableButton,
  TableDepthControls,
  MirrorOpponentControl,
  TableHalvesControls,
  ZoneOutlinesControl,
} from '../../board/view/TableViewControls.js';
import { CARD_BACK_VIEW_PREFERENCES } from '../../card-backs/card-back-preferences.js';
import { editBrowserCoin } from '../browser-coin.js';
import {
  settingsPageName,
  settingsSheetCommands,
} from '../../commands/settings-commands.js';
import { useCommandSource } from '../../commands/registry.js';
import { openShortcutsDialog } from '../../hotkeys/shortcuts-dialog-state.js';
import {
  CARD_IMAGE_LANGUAGE_NAMES,
  CARD_IMAGE_PREFERENCES,
  cardImageLanguageFor,
  type CardImageChoice,
} from '../../i18n/card-image-language.js';
import {
  LANGUAGE_PREFERENCES,
  type LanguageChoice,
} from '../../i18n/language-preference.js';
import { browserLocale, isLocale, LOCALES } from '../../i18n/locales.js';
import { depthSettings } from '../../motion/depth-settings.js';
import {
  motionSettings,
  type AnimationSpeed,
  type ReduceMotionChoice,
} from '../../motion/motion-settings.js';
import { preferences } from '../../preferences/preference-store.js';
import { usePreference } from '../../preferences/usePreference.js';
import {
  COARSE_POINTER_QUERY,
  TOUCH_ONLY_QUERY,
  useMediaQuery,
} from '../../ui/breakpoints.js';
import {
  SegmentedControl,
  type SegmentedChoice,
} from '../../ui/FormControls.js';
import { isInputMethodKey } from '../../ui/input-method.js';
import { OVERLAY_SURFACE_ATTRIBUTE } from '../../ui/overlay-surface.js';
import {
  SettingsBlock,
  SettingsChoiceGroup,
  SettingsFooter,
  SettingsGroup,
  SettingsLinkRow,
  SettingsSwitchRow,
  type SettingsTone,
} from '../../ui/SettingsList.js';
import { Sheet } from '../../ui/Sheet.js';
import { Tooltip } from '../../ui/Tooltip.js';
import { currentBrowserInvitationClipboard } from '../browser-invitation-clipboard.js';
import { TABLE_ARTS } from '../table-art.js';
import { TABLE_PREFERENCES } from '../table-preferences.js';
import {
  menuActions,
  useAppBarPlacement,
  type AppMenuModel,
  type SettingsAction,
  type ToolbarEntry,
} from './AppMenu.js';
import {
  BackgroundChooser,
  type BackgroundChoice,
} from './BackgroundChooser.js';
import { useDockSlide, type DockSlide } from './dock-slide.js';
import {
  DISCORD_URL,
  openHelpPage,
  RELEASE_NAME,
  REPOSITORY_URL,
} from './help-pages.js';
import './settings-sheet.css';
import {
  openSettingsSheet,
  SETTINGS_PAGE_IDS,
  settingsNavigation,
  settingsPageStack,
  type SettingsPage,
  type SettingsPageRequest,
} from './settings-sheet-state.js';

export interface SettingsSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Beside the table, in the log's column, rather than over it: the table
   * makes room and stays in play while Settings is open.
   */
  readonly docked?: boolean;
  /** Carries the column in and out (useActivityDocking). */
  readonly slide?: DockSlide;
  /** The page to show as it opens ("Settings: Cards"); each ask again. */
  readonly request?: SettingsPageRequest;
  /**
   * What the room lets the player do (the app bar's model): its invites,
   * saves and replays, the tutorial and the way out, and on a phone what
   * the bar has no room for.
   */
  readonly menu?: AppMenuModel;
  readonly darkMode: boolean;
  readonly onDarkModeChange: (enabled: boolean) => void;
  /** Opens the live table coin editor, with a personal-default fallback. */
  readonly onEditCoin?: () => void;
  readonly playerNames?: readonly PlayerNameChoice[];
  /** What lies around the table, and how it changes. */
  readonly background: BackgroundChoice;
  /**
   * In a room: whether this player lets the board be turned to the other
   * side's view (both must), changeable any time during the game.
   */
  readonly boardFlip?: {
    readonly allowed: boolean;
    readonly onChange: (allowed: boolean) => void;
  };
}

/** The avatar page brings the sleeve designer's emblems, so loads with it. */
const AccountAvatarPage = lazy(
  () => import('../../account/AccountAvatarPage.js')
);

/** Opens an outside page in a new tab, keeping this one. */
const openOutside = (url: string): void => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

/** The icon tiles of the rows the app bar leaves to Settings on a phone. */
const PLACE_TONES: Readonly<Record<string, SettingsTone>> = {
  p1Button: 'blue',
  p2Button: 'green',
  deckImportButton: 'gold',
};

/** What a page needs of the drawer: to move on, and to give way. */
interface PageContext {
  /** Opens `page` from the row `opener` (its id), which the way back finds. */
  readonly navigate: (page: SettingsPage, opener: string) => void;
  /** Puts Settings away, for what it opens (one window at a time). */
  readonly leave: () => void;
  readonly touchOnly: boolean;
  readonly editCoin: () => void;
}

/** The page's language, named in itself: the browser's while it is chosen. */
const useLanguageName = (): {
  readonly name: string;
  readonly lang: string;
} => {
  const { language } = usePreference(LANGUAGE_PREFERENCES);
  const locale = language === 'auto' ? browserLocale() : language;
  const name = LOCALES.find((entry) => entry.locale === locale)?.name ?? '';
  return { name, lang: locale };
};

/** The table's look, by name. */
const useTableArtName = (): string => {
  const { i18n } = useLingui();
  const { art } = usePreference(TABLE_PREFERENCES);
  const look = TABLE_ARTS.find((entry) => entry.id === art);
  return look ? i18n._(look.name) : '';
};

/** A row for one of the room's actions; Settings gives way as it acts. */
const ActionRow = ({
  action,
  leave,
}: {
  readonly action: SettingsAction;
  readonly leave: () => void;
}) => (
  <SettingsLinkRow
    id={action.id}
    icon={action.icon}
    tone={action.tone}
    label={action.label}
    {...(action.detail ? { subtitle: action.detail } : {})}
    trailing="none"
    {...(action.danger ? { danger: true } : {})}
    {...(action.disabled ? { disabled: true } : {})}
    onClick={() => {
      leave();
      action.onSelect();
    }}
  />
);

/**
 * The first page: what the bar has no room for (on a phone), the room's
 * invites and board flip, then the pages -- the table, the cards, motion,
 * the language -- and the keys, the game's saves and replays (a page of
 * their own), the tutorial with help and About, and the ways out at the
 * foot.
 */
const HomePage = ({
  context,
  menu,
  boardFlip,
}: {
  readonly context: PageContext;
  readonly menu: AppMenuModel | undefined;
  readonly boardFlip: SettingsSheetProps['boardFlip'];
}) => {
  const { t } = useLingui();
  const { navigate, leave, touchOnly } = context;
  const placement = useAppBarPlacement(menu ?? { onSettings: () => undefined });
  const places: readonly ToolbarEntry[] = menu ? placement.inSettings : [];
  const actions = menu
    ? menuActions(menu)
    : { room: [], saves: [], tutorial: [], leave: [] };
  const language = useLanguageName();
  const tableArt = useTableArtName();
  // The account's games (ADR-053) are in Saves & replays: for a player
  // signed in, or one who could sign in to keep them.
  const account = useAccount();
  const accountGames =
    account.status === 'ready' &&
    (account.account !== null || account.providers.length > 0);
  const pageRow = (
    page: SettingsPage,
    id: string,
    icon: Icon,
    tone: SettingsTone,
    value?: { readonly text: string; readonly lang?: string }
  ) => (
    <SettingsLinkRow
      id={id}
      icon={icon}
      tone={tone}
      label={settingsPageName(page)}
      {...(value ? { value: value.text, valueLang: value.lang } : {})}
      onClick={() => navigate(page, id)}
    />
  );
  return (
    <>
      {places.length > 0 ? (
        <SettingsGroup>
          {places.map((entry) => (
            <SettingsLinkRow
              key={entry.id}
              id={entry.id}
              icon={entry.icon}
              tone={PLACE_TONES[entry.id] ?? 'slate'}
              label={entry.label}
              onClick={() => {
                leave();
                entry.onSelect();
              }}
            />
          ))}
        </SettingsGroup>
      ) : null}
      {actions.room.length > 0 || boardFlip ? (
        <SettingsGroup {...(menu?.heading ? { heading: menu.heading } : {})}>
          {actions.room.map((action) => (
            <ActionRow key={action.id} action={action} leave={leave} />
          ))}
          {boardFlip ? (
            <SettingsSwitchRow
              id="coachingModeCheckbox"
              icon={ArrowsDownUpIcon}
              tone="teal"
              label={t`Allow board flip`}
              subtitle={t`Both players must allow it.`}
              checked={boardFlip.allowed}
              onChange={boardFlip.onChange}
            />
          ) : null}
        </SettingsGroup>
      ) : null}
      <SettingsGroup>
        {pageRow('table', 'settingsTableRow', PaletteIcon, 'green', {
          text: tableArt,
        })}
        {pageRow('cards', 'settingsCardsRow', CardFanIcon, 'blue')}
        {pageRow('motion', 'settingsMotionRow', ShootingStarIcon, 'purple')}
        {pageRow('language', 'settingsLanguageRow', TranslateIcon, 'teal', {
          text: language.name,
          lang: language.lang,
        })}
        {touchOnly ? null : (
          <SettingsLinkRow
            id="editShortcutsButton"
            icon={KeyboardIcon}
            tone="slate"
            label={t`Keyboard shortcuts`}
            onClick={() => {
              leave();
              openShortcutsDialog();
            }}
          />
        )}
      </SettingsGroup>
      {actions.saves.length > 0 || accountGames ? (
        <SettingsGroup>
          {pageRow('saves', 'settingsSavesRow', FilmReelIcon, 'gold')}
        </SettingsGroup>
      ) : null}
      <SettingsGroup>
        {actions.tutorial.map((action) => (
          <ActionRow key={action.id} action={action} leave={leave} />
        ))}
        {pageRow('reportBug', 'settingsReportBugRow', BugIcon, 'red')}
        {pageRow('about', 'settingsAboutRow', InfoIcon, 'pink')}
      </SettingsGroup>
      {actions.leave.length > 0 ? (
        <SettingsFooter>
          {actions.leave.map((action) => (
            <button
              key={action.id}
              id={action.id}
              type="button"
              className="settings-footer__action"
              data-danger={action.danger ? 'true' : undefined}
              onClick={() => {
                leave();
                action.onSelect();
              }}
            >
              <action.icon
                aria-hidden="true"
                weight="bold"
                className={action.mirrored ? 'ds-mirror-rtl' : undefined}
              />
              {action.label}
            </button>
          ))}
        </SettingsFooter>
      ) : null}
    </>
  );
};

/**
 * The game's saves and replays: watching one, saving the game online and
 * resuming it, and downloading what has been played. Each gives way as it
 * acts.
 */
const SavesPage = ({
  menu,
  context,
}: {
  readonly menu: AppMenuModel | undefined;
  readonly context: PageContext;
}) => {
  const saves = menu ? menuActions(menu).saves : [];
  const resume = menu?.game?.onResumeSavedText;
  return (
    <>
      <AccountReplaysRow
        onOpen={() => context.navigate('accountReplays', 'accountReplaysRow')}
        onSignIn={() => context.navigate('signIn', 'accountReplaysSignInRow')}
      />
      {saves.length > 0 ? (
        <SettingsGroup>
          {saves.map((action) => (
            <ActionRow key={action.id} action={action} leave={context.leave} />
          ))}
        </SettingsGroup>
      ) : null}
      {resume ? (
        <AccountSavesGroup
          resume={resume}
          leave={context.leave}
          busy={menu?.game?.busy === true}
        />
      ) : null}
    </>
  );
};

/** The table: its look, then how it is shown, and putting that back. */
const TablePage = ({
  background,
  darkMode,
  onDarkModeChange,
}: {
  readonly background: BackgroundChoice;
  readonly darkMode: boolean;
  readonly onDarkModeChange: (enabled: boolean) => void;
}) => {
  const { t } = useLingui();
  return (
    <>
      <SettingsGroup
        heading={t({ message: 'Look', context: "the table's look" })}
      >
        <SettingsBlock>
          <TableArtControls />
        </SettingsBlock>
        <SettingsBlock>
          <BackgroundChooser choice={background} />
        </SettingsBlock>
        <SettingsSwitchRow
          id="darkModeCheckbox"
          label={t`Dark mode`}
          checked={darkMode}
          onChange={onDarkModeChange}
        />
      </SettingsGroup>
      <SettingsGroup
        heading={t({ message: 'View', context: 'how the table is shown' })}
      >
        <SettingsBlock>
          <TableDepthControls />
        </SettingsBlock>
        <SettingsBlock>
          <TableHalvesControls />
        </SettingsBlock>
        <MirrorOpponentControl />
        <ZoneOutlinesControl />
      </SettingsGroup>
      <SettingsGroup>
        <ResetTableButton />
      </SettingsGroup>
    </>
  );
};

/** The card images' language, named as the Cards page and its own page say. */
const useCardImageChoice = (): {
  readonly choice: CardImageChoice;
  readonly following: string;
} => {
  const { cardImages } = usePreference(CARD_IMAGE_PREFERENCES);
  const { language } = usePreference(LANGUAGE_PREFERENCES);
  const following =
    CARD_IMAGE_LANGUAGE_NAMES[
      cardImageLanguageFor(
        'app',
        language === 'auto' ? browserLocale() : language
      )
    ];
  return { choice: cardImages, following };
};

/** How the cards lie and read, and whose scans they show. */
const CardsPage = ({ context }: { readonly context: PageContext }) => {
  const { t } = useLingui();
  const { opponentCustomBacks } = usePreference(CARD_BACK_VIEW_PREFERENCES);
  const { choice, following } = useCardImageChoice();
  return (
    <>
      <SettingsGroup>
        <SettingsLinkRow
          id="editCoinButton"
          label={t`Coin`}
          onClick={context.editCoin}
        />
        <CardViewControls touchOnly={context.touchOnly} />
        {/* Other players' uploaded and designed backs as they chose them,
            or as the standard back (ADR-041). Presets always show. */}
        <SettingsSwitchRow
          id="opponentCardBacksCheckbox"
          label={t`Opponents' custom backs`}
          checked={opponentCustomBacks}
          onChange={(enabled) =>
            preferences().set(CARD_BACK_VIEW_PREFERENCES, {
              opponentCustomBacks: enabled,
            })
          }
        />
      </SettingsGroup>
      <SettingsGroup>
        <SettingsLinkRow
          id="cardImageLanguageRow"
          label={t`Card images`}
          value={
            choice === 'app' ? following : CARD_IMAGE_LANGUAGE_NAMES[choice]
          }
          valueLang={choice === 'app' ? undefined : choice}
          onClick={() => context.navigate('cardImages', 'cardImageLanguageRow')}
        />
      </SettingsGroup>
    </>
  );
};

/**
 * The language card images are shown in, for this player only: the page's
 * own while cards are printed in it, else English, or one chosen. Each is
 * named in itself, as the page languages are.
 */
const CardImagesPage = () => {
  const { t } = useLingui();
  const { choice, following } = useCardImageChoice();
  return (
    <SettingsChoiceGroup<CardImageChoice>
      name="cardImageLanguage"
      legend={t`Card images`}
      footer={
        <Trans>
          Only you see this. Cards without that printing keep the deck&apos;s
          scan.
        </Trans>
      }
      choices={[
        {
          value: 'app',
          id: 'cardImageLanguage-app',
          label: t`Page language`,
          subtitle: following,
        },
        ...CARD_IMAGE_LANGUAGES.map((entry) => ({
          value: entry,
          id: `cardImageLanguage-${entry}`,
          label: CARD_IMAGE_LANGUAGE_NAMES[entry],
          lang: entry,
        })),
      ]}
      value={choice}
      onChange={(value) => {
        const next: CardImageChoice = isCardImageLanguage(value)
          ? value
          : 'app';
        preferences().set(CARD_IMAGE_PREFERENCES, { cardImages: next });
      }}
    />
  );
};

/** How much things move, how fast, and the table's own movement. */
const MotionPage = ({ context }: { readonly context: PageContext }) => {
  const { t } = useLingui();
  const store = motionSettings();
  const motion = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const reduceMotionChoices: readonly SegmentedChoice<ReduceMotionChoice>[] = [
    {
      value: 'system',
      id: 'reduceMotionSystem',
      label: t({ message: 'System', context: 'reduce motion setting' }),
    },
    {
      value: 'reduce',
      id: 'reduceMotionOn',
      label: t({ message: 'On', context: 'setting' }),
    },
    {
      value: 'full',
      id: 'reduceMotionOff',
      label: t({ message: 'Off', context: 'setting' }),
    },
  ];
  const animationSpeedChoices: readonly SegmentedChoice<AnimationSpeed>[] = [
    {
      value: 'relaxed',
      id: 'animationSpeedRelaxed',
      label: t({ message: 'Relaxed', context: 'animation speed' }),
    },
    {
      value: 'normal',
      id: 'animationSpeedNormal',
      label: t({ message: 'Normal', context: 'animation speed' }),
    },
    {
      value: 'fast',
      id: 'animationSpeedFast',
      label: t({ message: 'Fast', context: 'animation speed' }),
    },
    {
      value: 'instant',
      id: 'animationSpeedInstant',
      label: t({ message: 'Instant', context: 'animation speed' }),
    },
  ];
  return (
    <>
      <SettingsGroup>
        <SettingsBlock>
          <SegmentedControl
            name="reduceMotion"
            legend={t`Reduce motion`}
            choices={reduceMotionChoices}
            value={motion.reduceMotion}
            onChange={(reduceMotion) => store.update({ reduceMotion })}
          />
        </SettingsBlock>
        <SettingsBlock>
          <SegmentedControl
            name="animationSpeed"
            legend={t({ message: 'Speed', context: 'animation speed' })}
            choices={animationSpeedChoices}
            value={motion.animationSpeed}
            onChange={(animationSpeed) => store.update({ animationSpeed })}
          />
        </SettingsBlock>
      </SettingsGroup>
      {/* Each says "Needs depth" while the table is flat. */}
      <SettingsGroup
        heading={t({ message: 'Depth', context: 'how 3D the table looks' })}
      >
        <DepthMotionControls touchOnly={context.touchOnly} />
      </SettingsGroup>
    </>
  );
};

/**
 * The page's language: the browser's, until one is chosen. Each language
 * is named in itself, so someone who cannot read the current one can still
 * find theirs.
 */
const LanguagePage = () => {
  const { t } = useLingui();
  const { language } = usePreference(LANGUAGE_PREFERENCES);
  const browser = LOCALES.find(({ locale }) => locale === browserLocale());
  return (
    <SettingsChoiceGroup<LanguageChoice>
      name="language"
      legend={t`Language`}
      choices={[
        {
          value: 'auto',
          id: 'language-auto',
          label: t`Browser language`,
          ...(browser ? { subtitle: browser.name } : {}),
        },
        ...LOCALES.map(({ locale, name }) => ({
          value: locale,
          id: `language-${locale}`,
          label: name,
          lang: locale,
        })),
      ]}
      value={language}
      onChange={(value) => {
        const choice: LanguageChoice = isLocale(value) ? value : 'auto';
        preferences().set(LANGUAGE_PREFERENCES, { language: choice });
      }}
    />
  );
};

/** What a bug report needs to find the problem, without anything private. */
const diagnostics = async (menu: AppMenuModel | undefined): Promise<string> => {
  let build = 'unknown';
  try {
    const response = await fetch('/v2/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'buildId' in body &&
      typeof body.buildId === 'string'
    ) {
      build = body.buildId;
    }
  } catch {
    // Reported as unknown.
  }
  const view = globalThis.visualViewport;
  const width = Math.round(view?.width ?? globalThis.innerWidth);
  const height = Math.round(view?.height ?? globalThis.innerHeight);
  const pointer = globalThis.matchMedia(COARSE_POINTER_QUERY).matches
    ? 'touch'
    : 'mouse';
  const { language } = preferences().get(LANGUAGE_PREFERENCES);
  return [
    `PTCG Sim v2 ${RELEASE_NAME} (${build})`,
    `Table: ${menu?.mode?.kind ?? 'lobby'}${menu?.heading ? ` · ${menu.heading}` : ''}`,
    `Window: ${String(width)}×${String(height)} @${String(globalThis.devicePixelRatio)}x, ${pointer}`,
    `Depth: ${depthSettings().getSnapshot().mode}`,
    `Language: ${language === 'auto' ? `auto (${browserLocale()})` : language}`,
    `Browser: ${globalThis.navigator.userAgent}`,
  ].join('\n');
};

/** Where to tell the team, and what to tell them. */
const ReportBugPage = ({
  menu,
}: {
  readonly menu: AppMenuModel | undefined;
}) => {
  const { t } = useLingui();
  const [copied, setCopied] = useState<'copied' | 'failed' | undefined>();
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(undefined), 2400);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <p className="settings-intro">
        <Trans>
          Something not working? Tell us and we&apos;ll take a look.
        </Trans>
      </p>
      <SettingsGroup
        footer={t`Paste the details into your report: they help find the problem.`}
      >
        <SettingsLinkRow
          id="reportOnDiscordButton"
          icon={DiscordLogoIcon}
          tone="indigo"
          label={t`Report on Discord`}
          trailing="external"
          onClick={() => openOutside(DISCORD_URL)}
        />
        <SettingsLinkRow
          id="copyDiagnosticsButton"
          icon={ClipboardTextIcon}
          tone="slate"
          label={t`Copy details`}
          value={
            copied === 'copied'
              ? t({ message: 'Copied', context: 'copied to the clipboard' })
              : copied === 'failed'
                ? t`Couldn't copy`
                : undefined
          }
          trailing="none"
          onClick={() => {
            // The write starts within the press, the details to follow: a
            // browser that asks for the press (Safari) would refuse it after
            // the build is fetched.
            const clipboard = currentBrowserInvitationClipboard();
            if (!clipboard) {
              setCopied('failed');
              return;
            }
            void clipboard.writeText(diagnostics(menu)).then(
              () => setCopied('copied'),
              () => setCopied('failed')
            );
          }}
        />
      </SettingsGroup>
    </>
  );
};

/** The release, the community, the sponsors and the source. */
const AboutPage = ({ context }: { readonly context: PageContext }) => {
  const { t } = useLingui();
  return (
    <SettingsGroup>
      <SettingsLinkRow
        id="changelogButton"
        icon={SparkleIcon}
        tone="gold"
        label={t`What's new`}
        value={RELEASE_NAME}
        onClick={() => {
          context.leave();
          openHelpPage('changelog');
        }}
      />
      <SettingsLinkRow
        id="donationsButton"
        icon={HeartIcon}
        tone="pink"
        label={t`Sponsors`}
        onClick={() => {
          context.leave();
          openHelpPage('donations');
        }}
      />
      <SettingsLinkRow
        id="discordButton"
        icon={DiscordLogoIcon}
        tone="indigo"
        label={t`Discord`}
        trailing="external"
        onClick={() => openOutside(DISCORD_URL)}
      />
      <SettingsLinkRow
        id="sourceCodeButton"
        icon={GithubLogoIcon}
        tone="slate"
        label={t`Source code`}
        trailing="external"
        onClick={() => openOutside(REPOSITORY_URL)}
      />
    </SettingsGroup>
  );
};

/** The way back to the page before, at the start of the drawer's header. */
const BackButton = ({ onBack }: { readonly onBack: () => void }) => {
  const { t } = useLingui();
  return (
    <button
      type="button"
      id="settingsBackButton"
      className="settings-back"
      aria-label={t({
        message: 'Back',
        context: 'to the settings page before',
      })}
      onClick={onBack}
    >
      <CaretLeftIcon
        aria-hidden="true"
        weight="bold"
        className="ds-mirror-rtl"
      />
    </button>
  );
};

/** Where Settings scrolls: the docked aside's body, or the sheet's. */
const scrollerOf = (node: HTMLElement | null): HTMLElement | null =>
  node?.closest<HTMLElement>(
    '.ptcgsim-settings-dock__body, .ptcgsim-sheet__body'
  ) ?? null;

/**
 * The pages, one at a time, as a stack (ADR-045): a row opens its page,
 * which slides in from the end of the line; Back (or Esc) returns to the
 * row it came from, at the scroll it was left at. Each ask to open
 * (`request`) starts again from that page's way down.
 */
const useSettingsPages = (
  open: boolean,
  request: SettingsPageRequest | undefined
) => {
  const [stack, setStack] = useState<readonly SettingsPage[]>(() =>
    settingsPageStack(request?.page ?? 'home')
  );
  const [motion, setMotion] = useState<'push' | 'pop' | 'none'>('none');
  const latest = useRef(stack);
  latest.current = stack;
  // The row each page was opened from, for the way back.
  const openers = useRef(new Map<SettingsPage, string>());
  // Where each page below the top was left, for the way back.
  const scrolls = useRef(new Map<SettingsPage, number>());
  const content = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLElement>(null);
  const after = useRef<
    | { readonly kind: 'title' }
    | { readonly kind: 'opener'; readonly id: string | undefined }
    | undefined
  >(undefined);
  const shown = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!open || !request || request.serial === shown.current) return;
    shown.current = request.serial;
    openers.current.clear();
    scrolls.current.clear();
    setStack(settingsPageStack(request.page));
    setMotion('none');
  }, [open, request]);
  // Put away, it opens at its first page the next time.
  useEffect(() => {
    if (open) return;
    shown.current = undefined;
  }, [open]);
  const go = (next: readonly SettingsPage[]): void => {
    const current = latest.current;
    const way = settingsNavigation(current, next);
    const scroller = scrollerOf(content.current);
    const top = current.at(-1);
    if (way === 'push' && top && scroller) {
      scrolls.current.set(top, scroller.scrollTop);
    }
    after.current =
      way === 'pop'
        ? {
            kind: 'opener',
            id: top ? openers.current.get(top) : undefined,
          }
        : { kind: 'title' };
    setMotion(way === 'replace' ? 'none' : way);
    setStack(next);
  };
  const navigate = (page: SettingsPage, opener: string): void => {
    openers.current.set(page, opener);
    go([...latest.current, page]);
  };
  const back = (): boolean => {
    if (latest.current.length <= 1) return false;
    go(latest.current.slice(0, -1));
    return true;
  };
  const top = stack.at(-1) ?? 'home';
  useLayoutEffect(() => {
    const scroller = scrollerOf(content.current);
    if (scroller) scroller.scrollTop = scrolls.current.get(top) ?? 0;
    scrolls.current.delete(top);
    const focus = after.current;
    after.current = undefined;
    if (!focus) return;
    const target =
      focus.kind === 'title'
        ? title.current
        : focus.id
          ? document.getElementById(focus.id)
          : null;
    (target ?? title.current)?.focus({ preventScroll: true });
  }, [top, stack.length]);
  return { stack, top, motion, navigate, back, content, title };
};

/**
 * Settings in the log's column (ADR-030 §6): an aside like the docked log,
 * sliding in with the column, not a window over the table. It takes the
 * focus as it opens and gives it back as it closes; Esc in it goes back a
 * page, and on the first page closes it.
 */
const SettingsDock = ({
  slide,
  title,
  titleRef,
  leading,
  onEscape,
  onClose,
  children,
}: {
  readonly slide: DockSlide | undefined;
  readonly title: string;
  readonly titleRef: RefObject<HTMLElement | null>;
  readonly leading: ReactNode;
  readonly onEscape: () => boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) => {
  const { t } = useLingui();
  const ref = useRef<HTMLElement>(null);
  useDockSlide(ref, slide);
  useLayoutEffect(() => {
    const panel = ref.current;
    const active =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // Opened from a menu, the focus goes back to the button that opens it,
    // the menu itself being gone by then; else to what had it.
    const menu = active?.closest<HTMLElement>('[role="menu"]');
    const opener = menu?.getAttribute('aria-labelledby');
    const before =
      (opener ? document.getElementById(opener) : null) ??
      (menu ? null : active);
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (panel && !panel.contains(active)) {
        panel.focus({ preventScroll: true });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      const active = document.activeElement;
      const lost =
        active === null || active === document.body || panel?.contains(active);
      if (lost && before?.isConnected && !panel?.contains(before)) {
        before.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <aside
      ref={ref}
      id="settings"
      className="ptcgsim-activity-dock ptcgsim-settings-dock"
      aria-labelledby="settingsDockTitle"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          event.key !== 'Escape' ||
          event.defaultPrevented ||
          isInputMethodKey(event.nativeEvent)
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (!onEscape()) onClose();
      }}
      {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'panel' }}
    >
      <header className="ptcgsim-sheet__header">
        {leading}
        <div className="ptcgsim-sheet__heading">
          <h2
            ref={titleRef as RefObject<HTMLHeadingElement | null>}
            id="settingsDockTitle"
            className="ptcgsim-sheet__title"
            tabIndex={-1}
          >
            {title}
          </h2>
        </div>
        <Tooltip content={t`Close settings`} side="bottom">
          <button
            type="button"
            className="ptcgsim-sheet__close"
            aria-label={t`Close settings`}
            onClick={onClose}
          >
            <XIcon aria-hidden="true" />
          </button>
        </Tooltip>
      </header>
      <div className="ptcgsim-settings-dock__body">{children}</div>
    </aside>
  );
};

/**
 * Settings (ADR-045): the app bar's last button, holding everything the
 * bar does not -- the room's invites, saves and replays, how the table and
 * cards look and move, the language, help and the way out -- as pages of
 * grouped rows, after Magic Garden's system menu. Every choice applies
 * live and is kept on this device. In the log's column where there is
 * room, so the table changes in view and stays in play; over the table on
 * a smaller screen, from the bottom on a phone. The palette finds each
 * setting by the same name, and each page ("Settings: Cards").
 */
export const SettingsSheet = ({
  open,
  onOpenChange,
  docked = false,
  slide,
  request,
  menu,
  darkMode,
  onDarkModeChange,
  onEditCoin,
  playerNames,
  background,
  boardFlip,
}: SettingsSheetProps) => {
  const touchOnly = useMediaQuery(TOUCH_ONLY_QUERY);
  const pages = useSettingsPages(open, request);
  useCommandSource(() =>
    settingsSheetCommands({
      open: (page) => {
        openSettingsSheet(page);
      },
      darkMode,
      onDarkModeChange,
      background,
    })
  );
  // One window at a time: Settings gives way to what it opens.
  const leave = (): void => onOpenChange(false);
  const context: PageContext = {
    navigate: pages.navigate,
    leave,
    touchOnly,
    editCoin: onEditCoin ?? (() => void editBrowserCoin()),
  };
  const top = pages.top;
  const goBack = useRef(pages.back);
  goBack.current = pages.back;
  const back = useCallback(() => void goBack.current(), []);
  const title = settingsPageName(top);
  const leading =
    pages.stack.length > 1 ? (
      <BackButton onBack={() => void pages.back()} />
    ) : null;
  const body = (
    <div
      ref={pages.content}
      key={top}
      id={SETTINGS_PAGE_IDS[top]}
      className="settings-page"
      data-page={top}
      data-enter={pages.motion}
    >
      {top === 'home' ? (
        <>
          {' '}
          <AccountRow navigate={pages.navigate} />
          {playerNames?.length ? (
            <SettingsBlock>
              <PlayerNameControls players={playerNames} />
            </SettingsBlock>
          ) : null}
          <HomePage context={context} menu={menu} boardFlip={boardFlip} />
        </>
      ) : top === 'signIn' ? (
        <SignInPage back={back} />
      ) : top === 'account' ? (
        <AccountPage navigate={pages.navigate} back={back} />
      ) : top === 'accountAvatar' ? (
        <Suspense fallback={null}>
          <AccountAvatarPage />
        </Suspense>
      ) : top === 'signInMethods' ? (
        <SignInMethodsPage />
      ) : top === 'signOut' ? (
        <SignOutPage back={back} />
      ) : top === 'deleteAccount' ? (
        <DeleteAccountPage back={back} />
      ) : top === 'saves' ? (
        <SavesPage menu={menu} context={context} />
      ) : top === 'accountReplays' ? (
        <AccountReplaysPage leave={leave} back={back} />
      ) : top === 'table' ? (
        <TablePage
          background={background}
          darkMode={darkMode}
          onDarkModeChange={onDarkModeChange}
        />
      ) : top === 'cards' ? (
        <CardsPage context={context} />
      ) : top === 'cardImages' ? (
        <CardImagesPage />
      ) : top === 'motion' ? (
        <MotionPage context={context} />
      ) : top === 'language' ? (
        <LanguagePage />
      ) : top === 'reportBug' ? (
        <ReportBugPage menu={menu} />
      ) : (
        <AboutPage context={context} />
      )}
    </div>
  );
  if (docked) {
    return open ? (
      <SettingsDock
        slide={slide}
        title={title}
        titleRef={pages.title}
        leading={leading}
        onEscape={pages.back}
        onClose={leave}
      >
        {body}
      </SettingsDock>
    ) : null;
  }
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span
          ref={pages.title as RefObject<HTMLSpanElement | null>}
          tabIndex={-1}
          className="settings-sheet__title"
        >
          {title}
        </span>
      }
      headerLeading={leading}
      onEscape={pages.back}
      placement="side"
      size="sm"
      id="settings"
      className="ptcgsim-settings-sheet"
    >
      {body}
    </Sheet>
  );
};
