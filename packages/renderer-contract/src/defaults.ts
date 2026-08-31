import type {
  BoardPreferences,
  BoardPresentation,
  BoardViewport,
} from './model.js';

export const DEFAULT_BOARD_VIEWPORT: BoardViewport = {
  width: 1208,
  height: 900,
  devicePixelRatio: 1,
};

export const DEFAULT_BOARD_PRESENTATION: BoardPresentation = {
  selectedCardId: null,
  hoveredCardId: null,
  drag: null,
  openedZoneId: null,
};

export const DEFAULT_BOARD_PREFERENCES: BoardPreferences = {
  reducedMotion: false,
  highContrast: false,
  darkMode: false,
};
