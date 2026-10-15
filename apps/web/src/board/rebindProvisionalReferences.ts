import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

/**
 * The IDs predictWireCommand gives what a predicted command creates, until
 * the room publishes it: a Pokémon played into a new stack, a stack taken
 * apart into a window, a look at a deck.
 */
const PREDICTED_STACK = 'predicted-stack:';
const PREDICTED_WORK_AREA = 'predicted-work-area:';
const PREDICTED_INSPECTION = 'predicted-inspection:';

const roomIdFor = (id: string, view: MatchViewState): string => {
  if (id.startsWith(PREDICTED_STACK)) {
    // The stack holding the card it was predicted from.
    const cardId = id.slice(PREDICTED_STACK.length);
    return (
      Object.values(view.stacks).find((stack) =>
        stack.evolutionCards.some((card) => card.id === cardId)
      )?.id ?? id
    );
  }
  if (id.startsWith(PREDICTED_WORK_AREA)) {
    const stackId = id.slice(PREDICTED_WORK_AREA.length);
    return (
      Object.values(view.workAreas).find(
        (areas) => areas.attachmentResolution?.sourceStackId === stackId
      )?.attachmentResolution?.id ?? id
    );
  }
  if (id.startsWith(PREDICTED_INSPECTION)) {
    const ownerId = id.slice(PREDICTED_INSPECTION.length);
    return view.workAreas[ownerId]?.inspection?.id ?? id;
  }
  return id;
};

/**
 * A command built on a prediction (Energy attached to a Pokémon played a
 * moment before) names what it targets by its predicted ID. Just before it
 * is sent, the room has published the real one; this swaps them. Anything
 * not found is left for the room to refuse as stale.
 */
export const rebindProvisionalReferences = (
  command: WireGameCommand,
  view: MatchViewState
): WireGameCommand => {
  let changed = false;
  const rebind = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const id = roomIdFor(value, view);
      if (id !== value) changed = true;
      return id;
    }
    if (Array.isArray(value)) return value.map(rebind);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, rebind(child)])
      );
    }
    return value;
  };
  const rebound = rebind(command) as WireGameCommand;
  return changed ? rebound : command;
};
