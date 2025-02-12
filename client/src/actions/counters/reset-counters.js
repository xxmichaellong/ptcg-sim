import {
  oppContainerDocument,
  selfContainerDocument,
} from '../../front-end.js';

export const resetAbilityCounters = () => {
  selfContainerDocument
    .querySelectorAll('.self-tab, .opp-tab')
    .forEach((element) => {
      element.handleRemove(false);
    });
  oppContainerDocument
    .querySelectorAll('.self-tab, .opp-tab')
    .forEach((element) => {
      element.handleRemove(false);
    });
  document.querySelectorAll('.tab').forEach((element) => {
    element.handleRemove(false);
  });
};
