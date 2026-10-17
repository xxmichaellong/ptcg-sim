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

/**
 * Dispatched on the document to ask every board renderer to retry, now,
 * each card image that failed to load.
 */
export const CARD_IMAGE_RETRY_EVENT = 'ptcgsim:retry-card-images';
