import { Trans, useLingui } from '@lingui/react/macro';
import { CARD_IMAGE_LANGUAGES, isCardImageLanguage } from '@ptcgsim/deck-core';
import { useSyncExternalStore } from 'react';

import { TableArtControls } from '../../board/view/TableArtControls.js';
import { TableViewControls } from '../../board/view/TableViewControls.js';
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
        legend={t`Animation speed`}
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

export interface SettingsSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Solo offers to cover the opponent's hand. */
  readonly solo: boolean;
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

/**
 * Settings (ADR-030), in order of use: what the table shows, how the page
 * looks, how much it moves, the keys, and about. Every choice applies live
 * and is kept on this device. Beside the table where there is room, so the
 * table changes in view; from the bottom on a phone.
 */
export const SettingsSheet = ({
  open,
  onOpenChange,
  solo,
  darkMode,
  onDarkModeChange,
  onChangeBackground,
  onUseDefaultBackground,
  boardFlip,
}: SettingsSheetProps) => {
  const { t } = useLingui();
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
        <TableViewControls solo={solo} />
      </SettingsSection>
      <SettingsSection title={t`Appearance`}>
        <TableArtControls />
        <SwitchRow
          id="darkModeCheckbox"
          label={t`Dark mode`}
          checked={darkMode}
          onChange={onDarkModeChange}
        />
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
      </SettingsSection>
      <SettingsSection title={t`Language`} id="languageSettings">
        <LanguageControl />
        <CardImageLanguageControl />
      </SettingsSection>
      <SettingsSection title={t`Motion`} id="motionSettings">
        <MotionControls />
      </SettingsSection>
    </Sheet>
  );
};
