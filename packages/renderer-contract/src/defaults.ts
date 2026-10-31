import type {
  BoardPreferences,
  BoardPresentation,
  BoardViewport,
} from './model.js';
import { NO_SELECTION } from './presentation-selection.js';

export const DEFAULT_BOARD_VIEWPORT: BoardViewport = {
  width: 1208,
  height: 900,
  devicePixelRatio: 1,
};

export const DEFAULT_BOARD_PRESENTATION: BoardPresentation = {
  selection: NO_SELECTION,
  selectionMode: false,
  hoveredCardId: null,
  targetableCardIds: [],
  drag: null,
  openedZoneId: null,
  settling: [],
};

export const DEFAULT_BOARD_PREFERENCES: BoardPreferences = {
  reducedMotion: false,
  highContrast: false,
  darkMode: false,
  showZoneOutlines: true,
};
