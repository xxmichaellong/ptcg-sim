import { initializeP1BottomButtons } from './bottom-buttons.js';
import { initializeChangelog } from './changelog.js';
import { initializeP1ChatButtons } from './chat-buttons.js';
import { initializeDonationsLink } from './donations-link.js';
import { initializeTutorialButton } from './tutorial.js';

export const initializeP1Page = () => {
  initializeP1BottomButtons();
  initializeChangelog();
  initializeP1ChatButtons();
  initializeDonationsLink();
  initializeTutorialButton();
};
