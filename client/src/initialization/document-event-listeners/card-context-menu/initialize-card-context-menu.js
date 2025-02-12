import { initializeActiveAndBenchButtons } from './active-bench-buttons.js';
import { initializeBoardButtons } from './board-buttons.js';
import { initializeDeckButtons } from './deck-buttons.js';
import { initializeHandButtons } from './hand-buttons.js';
import { initializeGeneralButtons } from './general-buttons.js';
import { initializePrizesButtons } from './prizes-buttons.js';

export const initializeCardContextMenu = () => {
  initializeActiveAndBenchButtons();
  initializeBoardButtons();
  initializeDeckButtons();
  initializeHandButtons();
  initializeGeneralButtons();
  initializePrizesButtons();
};
