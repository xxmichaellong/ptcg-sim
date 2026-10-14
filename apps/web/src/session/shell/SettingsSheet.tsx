import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/csr/DiscordLogo';
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { KeyboardIcon } from '@phosphor-icons/react/dist/csr/Keyboard';
import { PlayCircleIcon } from '@phosphor-icons/react/dist/csr/PlayCircle';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { useSyncExternalStore } from 'react';

import { TableViewControls } from '../../board/view/TableViewControls.js';
import { chordKeycaps, detectKeyboardPlatform } from '../../hotkeys/chords.js';
import { useKeymap } from '../../hotkeys/hotkey-preferences.js';
import { openShortcutsDialog } from '../../hotkeys/shortcuts-dialog-state.js';
import {
  motionSettings,
  type AnimationSpeed,
  type ReduceMotionChoice,
} from '../../motion/motion-settings.js';
import {
  LinkRow,
  SegmentedControl,
  SettingsSection,
  SwitchRow,
  type SegmentedChoice,
} from '../../ui/FormControls.js';
import { Sheet } from '../../ui/Sheet.js';
import { DISCORD_URL, openHelpPage, RELEASE_NAME } from './help-pages.js';

const REDUCE_MOTION_CHOICES: readonly SegmentedChoice<ReduceMotionChoice>[] = [
  { value: 'system', id: 'reduceMotionSystem', label: 'System' },
  { value: 'reduce', id: 'reduceMotionOn', label: 'On' },
  { value: 'full', id: 'reduceMotionOff', label: 'Off' },
];

const ANIMATION_SPEED_CHOICES: readonly SegmentedChoice<AnimationSpeed>[] = [
  { value: 'relaxed', id: 'animationSpeedRelaxed', label: 'Relaxed' },
  { value: 'normal', id: 'animationSpeedNormal', label: 'Normal' },
  { value: 'fast', id: 'animationSpeedFast', label: 'Fast' },
  { value: 'instant', id: 'animationSpeedInstant', label: 'Instant' },
];

const MotionControls = () => {
  const store = motionSettings();
  const motion = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <>
      <SegmentedControl
        name="reduceMotion"
        legend="Reduce motion"
        choices={REDUCE_MOTION_CHOICES}
        value={motion.reduceMotion}
        onChange={(reduceMotion) => store.update({ reduceMotion })}
      />
      <SegmentedControl
        name="animationSpeed"
        legend="Animation speed"
        choices={ANIMATION_SPEED_CHOICES}
        value={motion.animationSpeed}
        onChange={(animationSpeed) => store.update({ animationSpeed })}
      >
        <span className="ptcgsim-form-hint">
          Instant keeps every action immediate, with no movement.
        </span>
      </SegmentedControl>
    </>
  );
};

const KeyboardRow = () => {
  const keymap = useKeymap();
  const changed = Object.keys(keymap.overrides).length;
  const opener = keymap.chord('table.shortcuts');
  return (
    <>
      <LinkRow
        id="keyboardShortcutsButton"
        icon={<KeyboardIcon aria-hidden="true" weight="duotone" />}
        title="Keyboard shortcuts"
        description={
          changed > 0
            ? `${String(changed)} changed · view or change your keys`
            : 'View or change your keys'
        }
        trailing={<CaretRightIcon aria-hidden="true" />}
        onClick={() => openShortcutsDialog()}
      />
      {opener ? (
        <p id="keybindReminder" className="ptcgsim-form-hint">
          Press{' '}
          {chordKeycaps(opener, detectKeyboardPlatform()).map((cap) => (
            <kbd className="ds-kbd" key={cap}>
              {cap}
            </kbd>
          ))}{' '}
          anywhere to see keyboard shortcuts
        </p>
      ) : null}
    </>
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
}: SettingsSheetProps) => (
  <Sheet
    open={open}
    onOpenChange={onOpenChange}
    title="Settings"
    description="Kept on this device."
    placement="side"
    size="sm"
    id="settings"
    className="ptcgsim-settings-sheet"
  >
    <SettingsSection title="Table" id="settingsTable">
      <TableViewControls solo={solo} />
    </SettingsSection>
    <SettingsSection title="Appearance">
      <SwitchRow
        id="darkModeCheckbox"
        label="Dark mode"
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
          Change background
        </button>
        {onUseDefaultBackground ? (
          <button
            id="defaultBackgroundButton"
            type="button"
            className="ds-button ds-button--ghost"
            onClick={onUseDefaultBackground}
          >
            Use default
          </button>
        ) : null}
      </div>
    </SettingsSection>
    <SettingsSection title="Motion" id="motionSettings">
      <MotionControls />
    </SettingsSection>
    <SettingsSection title="Controls">
      <KeyboardRow />
    </SettingsSection>
    <SettingsSection title="About">
      <LinkRow
        icon={<SparkleIcon aria-hidden="true" weight="fill" />}
        title={RELEASE_NAME}
        onClick={() => openHelpPage('changelog')}
      />
      <LinkRow
        icon={<PlayCircleIcon aria-hidden="true" weight="bold" />}
        title="Tutorial"
        onClick={() => openHelpPage('tutorial')}
      />
      <LinkRow
        icon={<HeartIcon aria-hidden="true" weight="fill" />}
        title="Sponsors & Donations"
        onClick={() => openHelpPage('donations')}
      />
      <a
        className="ptcgsim-link-row"
        href={DISCORD_URL}
        target="_blank"
        rel="noreferrer"
      >
        <span className="ptcgsim-link-row__icon">
          <DiscordLogoIcon aria-hidden="true" weight="fill" />
        </span>
        <span className="ptcgsim-link-row__text">
          <strong>Join our Discord</strong>
        </span>
        <span className="ptcgsim-link-row__trailing">
          <ArrowSquareOutIcon aria-hidden="true" />
        </span>
      </a>
      <a
        id="twitterDescription"
        className="ptcgsim-link-row"
        href="https://twitter.com/xxmichaellong"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="ptcgsim-link-row__text">
          <strong>Ideas for a better table?</strong>
          <span>Get in touch: @xxmichaellong</span>
        </span>
        <span className="ptcgsim-link-row__trailing">
          <ArrowSquareOutIcon aria-hidden="true" />
        </span>
      </a>
    </SettingsSection>
  </Sheet>
);
