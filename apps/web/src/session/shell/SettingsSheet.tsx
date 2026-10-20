import { useSyncExternalStore } from 'react';

import { TableViewControls } from '../../board/view/TableViewControls.js';
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
  </Sheet>
);
