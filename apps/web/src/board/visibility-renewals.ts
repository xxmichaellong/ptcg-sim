import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

/**
 * The cards a command changes the visibility of where they lie, so that
 * the room renews their aliases there: a reveal or hide (of a card or a
 * zone), a turn of face, a private look begun or ended, alone or among a
 * group's steps. The selection follows only these to a new alias
 * (`followRenamedCards`), whichever control sent them.
 */
export const visibilityChangedCardIds = (
  command: WireGameCommand,
  view: MatchViewState | undefined
): ViewCardId[] => {
  const steps = command.type === 'ApplyCardSteps' ? command.steps : [command];
  return steps.flatMap((step): ViewCardId[] => {
    switch (step.type) {
      case 'SetPublicReveal':
      case 'SetCardFace':
      case 'BeginCardInspection':
        return [step.cardId as ViewCardId];
      case 'SetZonePublicReveal':
      case 'BeginZoneInspection':
        return step.expectedCardIds.map((cardId) => cardId as ViewCardId);
      case 'EndPrivateInspection':
        return [
          ...(view?.privateInspections.find(
            (inspection) => inspection.id === step.inspectionId
          )?.cardIds ?? []),
        ];
      default:
        return [];
    }
  });
};
