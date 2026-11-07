import { useLingui } from '@lingui/react/macro';
import { AnchorIcon } from '@phosphor-icons/react/dist/csr/Anchor';
import { BoxingGloveIcon } from '@phosphor-icons/react/dist/csr/BoxingGlove';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { ProhibitIcon } from '@phosphor-icons/react/dist/csr/Prohibit';
import { ShieldIcon } from '@phosphor-icons/react/dist/csr/Shield';
import { SwordIcon } from '@phosphor-icons/react/dist/csr/Sword';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import type { Icon } from '@phosphor-icons/react';
import {
  layoutLegacyActiveQ0Markers,
  layoutReminderMarkers,
  markerHint,
  reminderName,
  type BoardDepthProjection,
  type MarkerSceneNode,
  type SpecialConditionKind,
} from '@ptcgsim/renderer-contract';
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  ROTATION_CONDITIONS,
  SPECIAL_CONDITIONS,
  STACK_REMINDERS,
  specialConditionKinds,
  toggleSpecialCondition,
  type StackReminder,
  type ViewCardId,
} from '@ptcgsim/game-core';

import { TOUCH_ONLY_QUERY, useMediaQuery } from '../../ui/breakpoints.js';
import { Tooltip } from '../../ui/Tooltip.js';
import type { BoardSessionControllerState } from '../BoardSessionController.js';
import { isInputMethodKey } from '../../ui/input-method.js';
import { parseLegacyDamageInput } from '../resolveLegacyBoardOverlayAction.js';
import { visualCardBounds } from './card-bounds.js';
import { useOverlayExit } from './overlayMotion.js';
import './MarkerControls.css';
import { abilityMarkerLabel } from '../ability-marker-label.js';

/** What the controls do: the overlays' own actions (LegacyBoardOverlays). */
export interface MarkerControlsActions {
  readonly dismiss: (scope: 'marker') => void;
  readonly submitDamageInput: (cardId: ViewCardId, value: string) => void;
  readonly submitSpecialConditionInput: (
    cardId: ViewCardId,
    value: string
  ) => void;
  readonly invokeContextAction: (
    action: 'toggleAbility',
    cardId: ViewCardId
  ) => void;
  /** Puts a reminder on the Pokémon, or takes it off when it is on. */
  readonly submitReminder: (
    cardId: ViewCardId,
    reminder: StackReminder
  ) => void;
}

/** Each reminder's icon in its controls, as its chip draws it (MarkerNode). */
export const REMINDER_ICONS: Readonly<Record<StackReminder, Icon>> = {
  cantAttack: SwordIcon,
  cantRetreat: AnchorIcon,
  takesLess: ShieldIcon,
  hitsHarder: BoxingGloveIcon,
  noAbilities: ProhibitIcon,
};

/** The most damage a Pokémon can carry (the room's limit). */
const DAMAGE_MAXIMUM = 9_990;
const DAMAGE_STEP = 10;
/** Room between the controls and the card they belong to. */
const GAP_PX = 10;
/** The controls keep this far inside the table's edges. */
const EDGE_PX = 8;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the controls go: beside the card, level with the marker, so they
 * cover neither -- to its right, else its left; where neither side has the
 * room (a narrow table), above the card, else below it. Always inside the
 * table.
 */
export const placeBeside = (
  card: Box,
  marker: Box,
  size: { readonly width: number; readonly height: number },
  board: { readonly width: number; readonly height: number }
): {
  readonly left: number;
  readonly top: number;
  readonly side: 'right' | 'left' | 'above' | 'below';
} => {
  const clamp = (value: number, room: number, length: number) =>
    Math.min(
      Math.max(value, EDGE_PX),
      Math.max(EDGE_PX, room - EDGE_PX - length)
    );
  const level = clamp(
    marker.y + marker.height / 2 - size.height / 2,
    board.height,
    size.height
  );
  const right = card.x + card.width + GAP_PX;
  if (right + size.width <= board.width - EDGE_PX)
    return { left: right, top: level, side: 'right' };
  const left = card.x - GAP_PX - size.width;
  if (left >= EDGE_PX) return { left, top: level, side: 'left' };
  const centred = clamp(
    card.x + card.width / 2 - size.width / 2,
    board.width,
    size.width
  );
  const above = card.y - GAP_PX - size.height;
  return above >= EDGE_PX
    ? { left: centred, top: above, side: 'above' }
    : {
        left: centred,
        top: clamp(card.y + card.height + GAP_PX, board.height, size.height),
        side: 'below',
      };
};

/**
 * The five Special Conditions as the controls offer them (ADR-043 §14): the
 * markers, Poisoned and Burned, each on or off; then the three shown by
 * turning the card, Asleep, Paralyzed and Confused, one at a time.
 */
export const CONDITION_GROUPS: readonly (readonly SpecialConditionKind[])[] = [
  SPECIAL_CONDITIONS.filter((kind) => !ROTATION_CONDITIONS.includes(kind)),
  ROTATION_CONDITIONS,
];

/** A condition's chip art, as the table draws it. */
export const conditionArt = (kind: SpecialConditionKind): string =>
  `/v2/assets/table/condition-${kind}.png`;

/**
 * The marker whose controls are open, while it lies on its card; for a
 * Pokémon's damage with no counter yet (the menu's Damage opens them), a
 * stand-in exactly where the scene will paint its first counter: v1
 * measures every counter from the card's painted (rotated) box.
 */
export const markerControlsMarker = (
  state: BoardSessionControllerState
): MarkerSceneNode | null => {
  const controls = state.overlays.marker;
  const scene = state.scene;
  if (!controls || !scene) return null;
  const lying = scene.markers.find(
    (marker) =>
      marker.parentCardId === controls.cardId && marker.kind === controls.kind
  );
  if (lying) return lying;
  if (
    (controls.kind !== 'damage' &&
      controls.kind !== 'reminder' &&
      controls.kind !== 'specialCondition') ||
    !state.view
  )
    return null;
  const stack = Object.values(state.view.stacks).find(
    (candidate) => candidate.evolutionCards.at(-1)?.id === controls.cardId
  );
  const card = scene.cards.find(
    (candidate) => candidate.id === controls.cardId
  );
  if (!stack || !card || card.side === 'shared') return null;
  const painted =
    card.rotationQuarterTurns % 2 === 0
      ? card.bounds
      : {
          x: card.bounds.x + card.bounds.width / 2 - card.bounds.height / 2,
          y: card.bounds.y + card.bounds.height / 2 - card.bounds.width / 2,
          width: card.bounds.height,
          height: card.bounds.width,
        };
  if (controls.kind === 'reminder') {
    // No reminder on it yet: where the first chip will go.
    const [first] = layoutReminderMarkers(painted, card.side, 1);
    return {
      id: `${card.id}:reminder-controls`,
      parentCardId: card.id,
      side: card.side,
      kind: 'reminder',
      presentation:
        stack.slot === 'active' ? 'legacyActiveQ0' : 'legacyBenchQ0',
      value: '',
      bounds: first!,
      zIndex: card.zIndex + 100,
      label: '',
    };
  }
  if (controls.kind === 'specialCondition') {
    // Every condition just taken off: where the first chip goes, so the
    // controls stay for the next (on the Active only).
    if (stack.slot !== 'active') return null;
    const item = layoutLegacyActiveQ0Markers(
      painted,
      card.side
    ).specialCondition;
    return {
      id: `${card.id}:condition-controls`,
      parentCardId: card.id,
      side: card.side,
      kind: 'specialCondition',
      presentation: 'legacyActiveQ0',
      value: '',
      bounds: item.bounds,
      zIndex: card.zIndex + item.sourceZIndex,
      label: '',
    };
  }
  const item = layoutLegacyActiveQ0Markers(painted, card.side).damage;
  return {
    id: `${card.id}:damage-controls`,
    parentCardId: card.id,
    side: card.side,
    kind: 'damage',
    presentation: stack.slot === 'active' ? 'legacyActiveQ0' : 'legacyBenchQ0',
    value: '0',
    bounds: item.bounds,
    zIndex: card.zIndex + item.sourceZIndex,
    label: markerHint({ kind: 'damage', value: '0' }),
  };
};

/** One of the controls' round buttons, named by its tooltip. */
export const ControlButton = ({
  label,
  className,
  pressed,
  onPress,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly pressed?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) => (
  <Tooltip content={label}>
    <button
      type="button"
      className={`ptcgsim-marker-controls__button${className ? ` ${className}` : ''}`}
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      onClick={onPress}
    >
      {children}
    </button>
  </Tooltip>
);

/**
 * A Pokémon's damage: typed into its number (Enter sets it and puts the
 * controls away, as v1's editor did; leaving the number sets it too), or
 * stepped by 10 with the buttons or the arrow keys.
 */
const DamageControls = ({
  marker,
  takesFocus,
  actions,
  commitRef,
}: {
  readonly marker: MarkerSceneNode;
  readonly takesFocus: boolean;
  readonly actions: MarkerControlsActions;
  /** Sets what has been typed, if anything: called before they go away. */
  readonly commitRef: { current: (() => void) | null };
}) => {
  const { t } = useLingui();
  // On a phone the field taking the focus would bring up the keyboard for
  // a player who only wants + or −: a button takes it there.
  const touchOnly = useMediaQuery(TOUCH_ONLY_QUERY);
  const cardId = marker.parentCardId;
  const damage = Number.parseInt(marker.value, 10) || 0;
  const shown = damage > 0 ? String(damage) : '';
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const setDamage = (value: number) => {
    setDraft(null);
    setInvalid(false);
    actions.submitDamageInput(
      cardId,
      value <= 0 ? '' : String(Math.min(DAMAGE_MAXIMUM, value))
    );
  };
  /** What is typed, as damage: undefined while it is no number. */
  const typed = (): number | undefined => {
    if (draft === null) return damage;
    const parsed = parseLegacyDamageInput(draft);
    return parsed === undefined ? undefined : (parsed ?? 0);
  };
  const commit = (): boolean => {
    if (draft === null) return true;
    const value = typed();
    if (value === undefined) {
      setInvalid(true);
      return false;
    }
    if (value === damage) {
      setDraft(null);
      return true;
    }
    setDamage(value);
    return true;
  };
  useEffect(() => {
    // What was typed is set, or forgotten if it is no number.
    commitRef.current = () => {
      if (!commit()) {
        setDraft(null);
        setInvalid(false);
      }
    };
    return () => {
      commitRef.current = null;
    };
  });
  const step = (by: number) => {
    // Stepping from what is typed, when it is a number.
    setDamage((typed() ?? damage) + by);
  };
  return (
    <>
      <ControlButton
        label={t`10 less damage`}
        onPress={() => step(-DAMAGE_STEP)}
      >
        <MinusIcon weight="bold" aria-hidden="true" />
      </ControlButton>
      <input
        ref={field}
        className="ptcgsim-marker-controls__value"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={16}
        placeholder="0"
        aria-label={t`Damage counter`}
        aria-invalid={invalid}
        {...(takesFocus && !touchOnly ? { 'data-takes-focus': '' } : {})}
        value={draft ?? shown}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          // Typing is not a table shortcut.
          if (event.key !== 'Escape') event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            if (commit()) actions.dismiss('marker');
            else field.current?.select();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            step(event.key === 'ArrowUp' ? DAMAGE_STEP : -DAMAGE_STEP);
          }
        }}
      />
      <ControlButton
        label={t`10 more damage`}
        onPress={() => step(DAMAGE_STEP)}
      >
        <PlusIcon weight="bold" aria-hidden="true" />
      </ControlButton>
      <span className="ptcgsim-marker-controls__divider" aria-hidden="true" />
      <ControlButton
        label={t`Remove all damage`}
        className="is-remove"
        onPress={() => {
          setDamage(0);
          actions.dismiss('marker');
        }}
      >
        <TrashIcon weight="bold" aria-hidden="true" />
      </ControlButton>
      {invalid ? (
        <span className="ptcgsim-marker-controls__hint" role="alert">
          {t`0 to 9990`}
        </span>
      ) : null}
    </>
  );
};

/**
 * A marker's controls, opened by pressing it on the table: a damage counter
 * steps by 10 either way or comes off, a condition chip changes to another
 * condition or comes off, and an Ability's tick comes off. They sit beside
 * the card (placeBeside) and stay open for the next press, until a press
 * elsewhere, Escape, or the marker going.
 */
export const MarkerControls = ({
  state,
  depth,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly depth?: BoardDepthProjection;
  readonly actions: MarkerControlsActions;
}) => {
  const { t } = useLingui();
  const marker = markerControlsMarker(state);
  const panel = useRef<HTMLDivElement>(null);
  // Closed, it fades back into the card's side (overlayMotion.ts).
  useOverlayExit(panel, 'menu');
  const [size, setSize] = useState<{
    readonly width: number;
    readonly height: number;
  } | null>(null);
  const markerId = marker?.id ?? null;
  const kind = marker?.kind ?? null;
  // The tokens a press on which is the table's to answer (it toggles the
  // controls), not a press outside: the marker's, and for a Pokémon's
  // reminders every one of its chips.
  const ownTokens = (
    marker?.kind === 'reminder' || marker?.kind === 'specialCondition'
      ? (state.scene?.markers ?? [])
          .filter(
            (other) =>
              other.kind === marker.kind &&
              other.parentCardId === marker.parentCardId
          )
          .map((other) => other.id)
      : markerId
        ? [markerId]
        : []
  ).join('\n');
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const measured = element.getBoundingClientRect();
    setSize((current) =>
      current?.width === measured.width && current.height === measured.height
        ? current
        : { width: measured.width, height: measured.height }
    );
  }, [markerId, kind, marker?.value]);
  // Opened from a card's menu (perhaps from the keyboard), they take the
  // focus -- the current choice, else the first -- once the menu has given
  // it back to the card, and return it there when they close.
  const takesFocus = state.overlays.marker?.takesFocus === true;
  // The same controls while the first counter goes on (its stand-in gives
  // way to it): the focus stays where it is.
  const opened = state.overlays.marker
    ? `${state.overlays.marker.cardId}:${state.overlays.marker.kind}`
    : null;
  const shown = markerId !== null;
  useEffect(() => {
    if (!opened || !shown || !takesFocus) return;
    let opener: HTMLElement | null = null;
    let element: HTMLElement | null = null;
    const frame = requestAnimationFrame(() => {
      element = panel.current;
      if (!element) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && !element.contains(focused))
        opener = focused;
      (
        element.querySelector<HTMLElement>('[data-takes-focus]') ??
        element.querySelector<HTMLElement>('button[aria-pressed="true"]') ??
        element.querySelector<HTMLElement>('button')
      )?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      const focused = document.activeElement;
      if (
        opener?.isConnected &&
        (focused === null ||
          focused === document.body ||
          element?.contains(focused) === true)
      )
        opener.focus({ preventScroll: true });
    };
  }, [opened, shown, takesFocus]);
  // Escape, or a press anywhere but here, puts them away; a press sets
  // what was typed first, as leaving v1's editor did. A press on the marker
  // itself is the table's to answer: it toggles them.
  const commitTyped = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!markerId) return;
    const key = (event: KeyboardEvent) => {
      // An input method's Esc (typing in the palette over them) drops its
      // candidate, and leaves them open.
      if (event.key !== 'Escape' || isInputMethodKey(event)) return;
      event.stopPropagation();
      actions.dismiss('marker');
    };
    const press = (event: PointerEvent) => {
      if (event.target instanceof Node && panel.current?.contains(event.target))
        return;
      const onToken = ownTokens.split('\n').some((id) => {
        const rect = document
          .querySelector(`[data-marker-hint-id="${CSS.escape(id)}"]`)
          ?.getBoundingClientRect();
        return (
          rect !== undefined &&
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        );
      });
      if (onToken) return;
      commitTyped.current?.();
      actions.dismiss('marker');
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', press, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', press, true);
    };
  }, [markerId, ownTokens, actions]);
  if (!marker || !state.scene) return null;
  const card = state.scene.cards.find(
    (candidate) => candidate.id === marker.parentCardId
  );
  if (!card) return null;
  const { left, top, side } = placeBeside(
    visualCardBounds(card, depth),
    depth ? depth.marker(marker).bounds : marker.bounds,
    size ?? { width: 0, height: 0 },
    state.scene.viewport
  );
  const cardId = marker.parentCardId;

  let controls: ReactNode;
  if (marker.kind === 'damage') {
    controls = (
      <DamageControls
        key={marker.parentCardId}
        marker={marker}
        takesFocus={takesFocus}
        actions={actions}
        commitRef={commitTyped}
      />
    );
  } else if (marker.kind === 'specialCondition') {
    // Each condition on or off, Poisoned and Burned beside one of the
    // turning three (a new one replacing the last).
    const stack = Object.values(state.view?.stacks ?? {}).find(
      (candidate) => candidate.evolutionCards.at(-1)?.id === cardId
    );
    const held = stack ? stack.specialCondition : marker.value || null;
    const on = specialConditionKinds(held);
    controls = (
      <>
        {CONDITION_GROUPS.map((group, index) => (
          <Fragment key={index}>
            {index > 0 ? (
              <span
                className="ptcgsim-marker-controls__divider"
                aria-hidden="true"
              />
            ) : null}
            {group.map((condition) => {
              const pressed = on.includes(condition);
              return (
                <ControlButton
                  key={condition}
                  label={markerHint({
                    kind: 'specialCondition',
                    value: condition,
                  })}
                  className="is-condition"
                  pressed={pressed}
                  onPress={() =>
                    actions.submitSpecialConditionInput(
                      cardId,
                      toggleSpecialCondition(held, condition, !pressed) ?? ''
                    )
                  }
                >
                  <img src={conditionArt(condition)} alt="" draggable={false} />
                </ControlButton>
              );
            })}
          </Fragment>
        ))}
        <span className="ptcgsim-marker-controls__divider" aria-hidden="true" />
        <ControlButton
          label={
            on.length > 1
              ? t({
                  message: 'Remove all conditions',
                  comment:
                    "Button in a Pokémon's condition controls: takes every Special Condition off it.",
                })
              : t`Remove condition`
          }
          className="is-remove"
          onPress={() => actions.submitSpecialConditionInput(cardId, '')}
        >
          <TrashIcon weight="bold" aria-hidden="true" />
        </ControlButton>
      </>
    );
  } else if (marker.kind === 'reminder') {
    // Every reminder, pressed while it is on: a press puts it on or takes
    // it off.
    const on =
      Object.values(state.view?.stacks ?? {}).find(
        (stack) => stack.evolutionCards.at(-1)?.id === cardId
      )?.reminders ?? [];
    controls = (
      <>
        {STACK_REMINDERS.map((reminder) => {
          const ReminderIcon = REMINDER_ICONS[reminder];
          return (
            <ControlButton
              key={reminder}
              label={reminderName(reminder)}
              className="is-reminder"
              pressed={on.includes(reminder)}
              onPress={() => actions.submitReminder(cardId, reminder)}
            >
              <ReminderIcon weight="bold" aria-hidden="true" />
            </ControlButton>
          );
        })}
      </>
    );
  } else {
    controls = (
      <>
        <span className="ptcgsim-marker-controls__caption">
          {markerHint(marker)}
        </span>
        <button
          type="button"
          className="ptcgsim-marker-controls__button is-text"
          onClick={() => actions.invokeContextAction('toggleAbility', cardId)}
        >
          {abilityMarkerLabel(
            'markUnused',
            Object.values(state.view?.stacks ?? {}).some((stack) =>
              stack.evolutionCards.some((card) => card.id === cardId)
            )
          )}
        </button>
      </>
    );
  }

  return (
    <div
      ref={panel}
      // Leaving the controls (Tab past the buttons, a press elsewhere) sets
      // what was typed; moving between them leaves it to the button pressed.
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          panel.current?.contains(event.relatedTarget)
        )
          return;
        commitTyped.current?.();
      }}
      className="ptcgsim-marker-controls"
      data-marker-controls={marker.kind}
      data-marker-controls-for={marker.id}
      data-marker-controls-card={marker.parentCardId}
      role="group"
      aria-label={
        marker.kind === 'reminder'
          ? t({
              message: 'Reminders',
              comment:
                "The controls for the reminders on a Pokémon (can't attack, takes less damage…).",
            })
          : markerHint(marker)
      }
      data-side={side}
      style={{
        left,
        top,
        visibility: size ? 'visible' : 'hidden',
      }}
    >
      {controls}
    </div>
  );
};
