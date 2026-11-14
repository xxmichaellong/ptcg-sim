import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import type { Rect } from '@ptcgsim/renderer-contract';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { isInputMethodKey } from '../../ui/input-method.js';
import { ControlButton, placeBeside } from './MarkerControls.js';
import { useOutsideDismiss } from './overlay-menu.js';
import { useOverlayExit } from './overlayMotion.js';
import './MarkerControls.css';

/** A step: one damage counter, as the single Pokémon's controls step. */
export const GROUP_DAMAGE_STEP = 10;

/**
 * Damage for every Pokémon in a group at once (ADR-042 §3, "Damage…"): the
 * marker controls' stepper, each press one move for the whole group --
 * 10 more on each, 10 less on each (none goes below 0), or all of it off.
 * Each Pokémon keeps its own count; the stepper shows how many it marks.
 * It stays open for the next press, until Done, Escape or a press
 * elsewhere.
 */
export const GroupDamageControls = ({
  pokemon,
  anchor,
  board,
  onStep,
  onClear,
  onDismiss,
}: {
  /** How many Pokémon in play the group holds. */
  readonly pokemon: number;
  /** What it opened from, in the table's own coordinates. */
  readonly anchor: Rect;
  readonly board: { readonly width: number; readonly height: number };
  readonly onStep: (delta: number) => void;
  readonly onClear: () => void;
  readonly onDismiss: () => void;
}) => {
  const { t } = useLingui();
  const panel = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{
    readonly width: number;
    readonly height: number;
  } | null>(null);
  useOverlayExit(panel, 'menu');
  useOutsideDismiss(panel, onDismiss);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const measured = element.getBoundingClientRect();
    setSize((current) =>
      current?.width === measured.width && current.height === measured.height
        ? current
        : { width: measured.width, height: measured.height }
    );
  }, [pokemon]);
  // It takes the focus as it opens (from a menu or the bar), and Escape
  // puts it away.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button')?.focus({
      preventScroll: true,
    });
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || isInputMethodKey(event)) return;
      event.stopPropagation();
      onDismiss();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onDismiss]);
  const { left, top, side } = placeBeside(
    anchor,
    anchor,
    size ?? { width: 0, height: 0 },
    board
  );
  const label = t({
    message: `Damage on each of ${plural(pokemon, {
      one: '# Pokémon',
      other: '# Pokémon',
    })}`,
    comment: 'The damage stepper for several selected Pokémon at once.',
  });
  return (
    <div
      ref={panel}
      className="ptcgsim-marker-controls"
      data-group-damage-controls="true"
      role="group"
      aria-label={label}
      data-side={side}
      style={{ left, top, visibility: size ? 'visible' : 'hidden' }}
    >
      <span className="ptcgsim-marker-controls__caption" aria-hidden="true">
        {t({
          message: `×${pokemon}`,
          comment: 'How many Pokémon the damage stepper marks, e.g. "×3".',
        })}
      </span>
      <ControlButton
        label={t`10 less damage on each`}
        onPress={() => onStep(-GROUP_DAMAGE_STEP)}
      >
        <MinusIcon weight="bold" aria-hidden="true" />
      </ControlButton>
      <ControlButton
        label={t`10 more damage on each`}
        onPress={() => onStep(GROUP_DAMAGE_STEP)}
      >
        <PlusIcon weight="bold" aria-hidden="true" />
      </ControlButton>
      <span className="ptcgsim-marker-controls__divider" aria-hidden="true" />
      <ControlButton
        label={t`Remove all damage from each`}
        className="is-remove"
        onPress={onClear}
      >
        <TrashIcon weight="bold" aria-hidden="true" />
      </ControlButton>
      <ControlButton
        label={t({ message: 'Done', context: 'finished' })}
        onPress={onDismiss}
      >
        <CheckIcon weight="bold" aria-hidden="true" />
      </ControlButton>
    </div>
  );
};
