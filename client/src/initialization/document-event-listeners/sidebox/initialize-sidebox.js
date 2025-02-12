import { initializeHeaderButtons } from './header-buttons.js';
import { initializeImport } from './import-deck.js';
import { initializeP1Page } from './p1/initialize-p1-page.js';
import { initializeP2Page } from './p2/initialize-p2-page.js';
import { initializeSettings } from './settings.js';

export const initializeSidebox = () => {
  initializeHeaderButtons();
  initializeP1Page();
  initializeP2Page();
  initializeSettings();
  initializeImport();
};
