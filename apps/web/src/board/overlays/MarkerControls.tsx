import { useLingui } from '@lingui/react/macro';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import {
  markerHint,
  specialConditionKind,
  type BoardDepthProjection,
  type MarkerSceneNode,
  type SpecialConditionKind,
} from '@ptcgsim/renderer-contract';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { ViewCardId } from '@ptcgsim/game-core';

import { Tooltip } from '../../ui/Tooltip.js';
import type { BoardSessionControllerState } from '../BoardSessionController.js';
import { visualCardBounds } from './card-bounds.js';
import './MarkerControls.css';

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
}

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

/** The five Special Conditions, in the rulebook's order, with their chips. */
const CONDITIONS: readonly SpecialConditionKind[] = [
  'asleep',
  'burned',
  'confused',
  'paralyzed',
  'poisoned',
];

/**
 * What a chosen condition is written as: v1's letters, as the keys' cycle
 * and the typed editor write it.
 */
const CONDITION_CODES: Readonly<Record<SpecialConditionKind, string>> = {
  asleep: 'A',
  burned: 'B',
  confused: 'C',
  paralyzed: 'Pa',
  poisoned: 'P',
};

const conditionArt = (kind: SpecialConditionKind): string =>
  `/v2/assets/table/condition-${kind}.png`;

/** The marker whose controls are open, while it still lies on its card. */
export const markerControlsMarker = (
  state: BoardSessionControllerState
): MarkerSceneNode | null => {
  const controls = state.overlays.marker;
  if (!controls || !state.scene) return null;
  return (
    state.scene.markers.find(
      (marker) =>
        marker.parentCardId === controls.cardId && marker.kind === controls.kind
    ) ?? null
  );
};

const ControlButton = ({
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
  const [size, setSize] = useState<{
    readonly width: number;
    readonly height: number;
  } | null>(null);
  const markerId = marker?.id ?? null;
  const kind = marker?.kind ?? null;
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
  useEffect(() => {
    if (!markerId || !takesFocus) return;
    let opener: HTMLElement | null = null;
    let element: HTMLElement | null = null;
    const frame = requestAnimationFrame(() => {
      element = panel.current;
      if (!element) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && !element.contains(focused))
        opener = focused;
      (
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
  }, [markerId, takesFocus]);
  // Escape, or a press anywhere but here, puts them away. A press on the
  // marker itself is the table's to answer: it toggles them.
  useEffect(() => {
    if (!markerId) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      actions.dismiss('marker');
    };
    const press = (event: PointerEvent) => {
      if (event.target instanceof Node && panel.current?.contains(event.target))
        return;
      const token = document.querySelector(
        `[data-marker-hint-id="${CSS.escape(markerId)}"]`
      );
      const rect = token?.getBoundingClientRect();
      if (
        rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      )
        return;
      actions.dismiss('marker');
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', press, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', press, true);
    };
  }, [markerId, actions]);
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
    const damage = Number.parseInt(marker.value, 10) || 0;
    const setDamage = (value: number) =>
      actions.submitDamageInput(
        cardId,
        value <= 0 ? '' : String(Math.min(DAMAGE_MAXIMUM, value))
      );
    controls = (
      <>
        <ControlButton
          label={t`10 less damage`}
          onPress={() => setDamage(damage - DAMAGE_STEP)}
        >
          <MinusIcon weight="bold" aria-hidden="true" />
        </ControlButton>
        <output
          className="ptcgsim-marker-controls__value"
          aria-label={markerHint(marker)}
        >
          {marker.value}
        </output>
        <ControlButton
          label={t`10 more damage`}
          onPress={() => setDamage(damage + DAMAGE_STEP)}
        >
          <PlusIcon weight="bold" aria-hidden="true" />
        </ControlButton>
        <span className="ptcgsim-marker-controls__divider" aria-hidden="true" />
        <ControlButton
          label={t`Remove all damage`}
          className="is-remove"
          onPress={() => setDamage(0)}
        >
          <TrashIcon weight="bold" aria-hidden="true" />
        </ControlButton>
      </>
    );
  } else if (marker.kind === 'specialCondition') {
    const current = specialConditionKind(marker.value);
    controls = (
      <>
        {CONDITIONS.map((condition) => {
          const name = markerHint({
            kind: 'specialCondition',
            value: condition,
          });
          return (
            <ControlButton
              key={condition}
              label={name}
              className="is-condition"
              pressed={current === condition}
              onPress={() =>
                actions.submitSpecialConditionInput(
                  cardId,
                  CONDITION_CODES[condition]
                )
              }
            >
              <img src={conditionArt(condition)} alt="" draggable={false} />
            </ControlButton>
          );
        })}
        <span className="ptcgsim-marker-controls__divider" aria-hidden="true" />
        <ControlButton
          label={t`Remove the Special Condition`}
          className="is-remove"
          onPress={() => actions.submitSpecialConditionInput(cardId, '')}
        >
          <TrashIcon weight="bold" aria-hidden="true" />
        </ControlButton>
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
          {t({
            message: 'Mark as unused',
            comment: 'Takes the "Ability used" marker off a Pokémon.',
          })}
        </button>
      </>
    );
  }

  return (
    <div
      ref={panel}
      className="ptcgsim-marker-controls"
      data-marker-controls={marker.kind}
      data-marker-controls-for={marker.id}
      role="group"
      aria-label={markerHint(marker)}
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
