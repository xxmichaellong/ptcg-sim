import { Trans, useLingui } from '@lingui/react/macro';
import { CARD_IMAGE_LANGUAGES, isCardImageLanguage } from '@ptcgsim/deck-core';
import { useEffect, useSyncExternalStore } from 'react';

import { TableArtControls } from '../../board/view/TableArtControls.js';
import {
  CardViewControls,
  DepthMotionControls,
  ResetTableButton,
  TableDepthControls,
  TableHalvesControls,
  ZoneOutlinesControl,
} from '../../board/view/TableViewControls.js';
import { CARD_BACK_VIEW_PREFERENCES } from '../../card-backs/card-back-preferences.js';
import { settingsSheetCommands } from '../../commands/settings-commands.js';
import { useCommandSource } from '../../commands/registry.js';
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
import {
  motionSettings,
  type AnimationSpeed,
  type ReduceMotionChoice,
} from '../../motion/motion-settings.js';
import {
  SegmentedControl,
  SettingsSection,
  SwitchRow,
  type SegmentedChoice,
} from '../../ui/FormControls.js';
import { Sheet } from '../../ui/Sheet.js';
import { usePreference } from '../../preferences/usePreference.js';
import { preferences } from '../../preferences/preference-store.js';
import { useHotkeyHints } from '../../hotkeys/hotkey-preferences.js';
import { openShortcutsDialog } from '../../hotkeys/shortcuts-dialog-state.js';
import { TOUCH_ONLY_QUERY, useMediaQuery } from '../../ui/breakpoints.js';
import { DISCORD_URL, openHelpPage, RELEASE_NAME } from './help-pages.js';
import './settings-sheet.css';
import {
  openSettingsSheet,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
  type SettingsSectionRequest,
} from './settings-sheet-state.js';

const MotionControls = () => {
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
      <SegmentedControl
        name="reduceMotion"
        legend={t`Reduce motion`}
        choices={reduceMotionChoices}
        value={motion.reduceMotion}
        onChange={(reduceMotion) => store.update({ reduceMotion })}
      />
      <SegmentedControl
        name="animationSpeed"
        legend={t({ message: 'Speed', context: 'animation speed' })}
        choices={animationSpeedChoices}
        value={motion.animationSpeed}
        onChange={(animationSpeed) => store.update({ animationSpeed })}
      />
    </>
  );
};

/**
 * The page's language: the browser's, until one is chosen. Each language
 * is named in itself, so someone who cannot read the current one can still
 * find theirs.
 */
const LanguageControl = () => {
  const { t } = useLingui();
  const { language } = usePreference(LANGUAGE_PREFERENCES);
  const browser =
    LOCALES.find(({ locale }) => locale === browserLocale())?.name ?? '';
  return (
    <div className="ptcgsim-form-group">
      <select
        id="languageSelect"
        aria-label={t`Language`}
        className="ds-select"
        lang={language === 'auto' ? undefined : language}
        value={language}
        onChange={(event) => {
          const value = event.currentTarget.value;
          const choice: LanguageChoice = isLocale(value) ? value : 'auto';
          preferences().set(LANGUAGE_PREFERENCES, { language: choice });
        }}
      >
        <option value="auto">{t`Browser language (${browser})`}</option>
        {LOCALES.map(({ locale, name }) => (
          <option key={locale} value={locale} lang={locale}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
};

/**
 * The language card images are shown in, for this player only: the page's
 * own while cards are printed in it, else English, or one chosen. Each is
 * named in itself, as the page languages are.
 */
const CardImageLanguageControl = () => {
  const { t } = useLingui();
  const { cardImages } = usePreference(CARD_IMAGE_PREFERENCES);
  const { language } = usePreference(LANGUAGE_PREFERENCES);
  const following =
    CARD_IMAGE_LANGUAGE_NAMES[
      cardImageLanguageFor(
        'app',
        language === 'auto' ? browserLocale() : language
      )
    ];
  return (
    <div className="ptcgsim-form-group">
      <label className="ptcgsim-form-label" htmlFor="cardImageLanguageSelect">
        <Trans>Card images</Trans>
      </label>
      <select
        id="cardImageLanguageSelect"
        className="ds-select"
        lang={cardImages === 'app' ? undefined : cardImages}
        value={cardImages}
        onChange={(event) => {
          const value = event.currentTarget.value;
          const choice: CardImageChoice = isCardImageLanguage(value)
            ? value
            : 'app';
          preferences().set(CARD_IMAGE_PREFERENCES, { cardImages: choice });
        }}
      >
        <option value="app">{t`Page language (${following})`}</option>
        {CARD_IMAGE_LANGUAGES.map((entry) => (
          <option key={entry} value={entry} lang={entry}>
            {CARD_IMAGE_LANGUAGE_NAMES[entry]}
          </option>
        ))}
      </select>
      <span className="ptcgsim-form-hint">
        <Trans>
          Only you see this. Cards without that printing keep the deck&apos;s
          scan.
        </Trans>
      </span>
    </div>
  );
};

/**
 * Whether other players' uploaded and designed card backs show as they
 * chose them, or as the standard back (ADR-041). Presets always show.
 */
const OpponentCardBacksControl = () => {
  const { t } = useLingui();
  const { opponentCustomBacks } = usePreference(CARD_BACK_VIEW_PREFERENCES);
  return (
    <SwitchRow
      id="opponentCardBacksCheckbox"
      label={t`Opponents' custom backs`}
      checked={opponentCustomBacks}
      onChange={(enabled) =>
        preferences().set(CARD_BACK_VIEW_PREFERENCES, {
          opponentCustomBacks: enabled,
        })
      }
    />
  );
};

/**
 * The keys: their list, where each can be moved, in its own dialog. Not
 * on a touch screen, which has none.
 */
const KeysControl = ({ onEdit }: { readonly onEdit: () => void }) => {
  const key = useHotkeyHints()('table.shortcuts');
  return (
    <div className="ptcgsim-settings-row">
      <span className="ptcgsim-settings-row__label">
        <Trans>Keyboard shortcuts</Trans>
      </span>
      {key ? <kbd className="ptcgsim-settings-row__key">{key}</kbd> : null}
      <button
        id="editShortcutsButton"
        type="button"
        className="ds-button ds-button--secondary"
        onClick={onEdit}
      >
        <Trans context="change the keyboard shortcuts">Edit…</Trans>
      </button>
    </div>
  );
};

export interface SettingsSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Where to scroll it to as it opens ("Settings: Cards"). */
  readonly section?: SettingsSectionRequest;
  readonly darkMode: boolean;
  readonly onDarkModeChange: (enabled: boolean) => void;
  readonly onChangeBackground: () => void;
  /** Offered while a chosen background shows. */
  readonly onUseDefaultBackground?: () => void;
  /**
   * In a room: whether this player lets the board be turned to the other
   * side's view (both must), changeable any time during the game.
   */
  readonly boardFlip?: {
    readonly allowed: boolean;
    readonly onChange: (allowed: boolean) => void;
  };
}

/** The release, the community and the sponsors, at Settings' foot. */
const SettingsFooter = ({ onLeave }: { readonly onLeave: () => void }) => {
  const { t } = useLingui();
  const link = (id: string, label: string, open: () => void) => (
    <button
      id={id}
      type="button"
      className="ptcgsim-settings-footer__link"
      onClick={open}
    >
      {label}
    </button>
  );
  return (
    <footer className="ptcgsim-settings-footer">
      {link('changelogButton', RELEASE_NAME, () => {
        onLeave();
        openHelpPage('changelog');
      })}
      <span aria-hidden="true">·</span>
      {link('discordButton', t`Discord`, () => {
        window.open(DISCORD_URL, '_blank', 'noopener,noreferrer');
      })}
      <span aria-hidden="true">·</span>
      {link('donationsButton', t`Sponsors`, () => {
        onLeave();
        openHelpPage('donations');
      })}
    </footer>
  );
};

/**
 * Settings (ADR-030), one sheet in sections: the room (in one), the table,
 * the cards, motion, the keys (where there are keys) and the language,
 * with the release and the community at its foot. Every choice applies
 * live and is kept on this device. Beside the table where there is room,
 * so the table changes in view; from the bottom on a phone. The palette
 * finds each row by the same name, and each section ("Settings: Cards").
 */
export const SettingsSheet = ({
  open,
  onOpenChange,
  section,
  darkMode,
  onDarkModeChange,
  onChangeBackground,
  onUseDefaultBackground,
  boardFlip,
}: SettingsSheetProps) => {
  const { t } = useLingui();
  const touchOnly = useMediaQuery(TOUCH_ONLY_QUERY);
  const hint = useHotkeyHints();
  useEffect(() => {
    if (!open || !section) return;
    // Once the sheet is drawn.
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(SETTINGS_SECTION_IDS[section.section])
        ?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, section]);
  const sections = SETTINGS_SECTIONS.filter(
    (id) => (id !== 'room' || boardFlip) && (id !== 'keys' || !touchOnly)
  );
  useCommandSource(() =>
    settingsSheetCommands({
      sections,
      open: (at) => {
        openSettingsSheet(at);
      },
      hint: hint('table.settings'),
      darkMode,
      onDarkModeChange,
    })
  );
  // One window at a time: Settings gives way to what it opens.
  const leave = (): void => onOpenChange(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t`Settings`}
      placement="side"
      size="sm"
      id="settings"
      className="ptcgsim-settings-sheet"
    >
      {boardFlip ? (
        <SettingsSection title={t`Room`} id="settingsRoom">
          <SwitchRow
            id="coachingModeCheckbox"
            label={t`Allow board flip`}
            hint={t`Both players must allow it.`}
            checked={boardFlip.allowed}
            onChange={boardFlip.onChange}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection title={t`Table`} id="settingsTable">
        <TableArtControls />
        <div className="ptcgsim-settings-actions">
          <button
            id="changeBackgroundButton"
            type="button"
            className="ds-button ds-button--secondary"
            onClick={onChangeBackground}
          >
            <Trans>Change background</Trans>
          </button>
          {onUseDefaultBackground ? (
            <button
              id="defaultBackgroundButton"
              type="button"
              className="ds-button ds-button--ghost"
              onClick={onUseDefaultBackground}
            >
              <Trans>Use default</Trans>
            </button>
          ) : null}
        </div>
        <SwitchRow
          id="darkModeCheckbox"
          label={t`Dark mode`}
          checked={darkMode}
          onChange={onDarkModeChange}
        />
        <TableDepthControls />
        <TableHalvesControls />
        <ZoneOutlinesControl />
        <ResetTableButton />
      </SettingsSection>
      <SettingsSection title={t`Cards`} id="settingsCards">
        <CardViewControls touchOnly={touchOnly} />
        <OpponentCardBacksControl />
        {/* A default back for new decks joins these (the deck screen's
            card-back chooser). */}
      </SettingsSection>
      <SettingsSection title={t`Motion`} id="motionSettings">
        <MotionControls />
        <DepthMotionControls touchOnly={touchOnly} />
      </SettingsSection>
      {touchOnly ? null : (
        <SettingsSection title={t`Keys`} id="settingsKeys">
          <KeysControl
            onEdit={() => {
              leave();
              openShortcutsDialog();
            }}
          />
        </SettingsSection>
      )}
      <SettingsSection title={t`Language`} id="languageSettings">
        <LanguageControl />
        <CardImageLanguageControl />
      </SettingsSection>
      <SettingsFooter onLeave={leave} />
    </Sheet>
  );
};
