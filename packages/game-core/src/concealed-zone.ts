import type { CardZone } from './model.js';

/**
 * Whether a zone hides the identity of the cards inside it.
 *
 * Decision and application both depend on this answer and must agree: command
 * handling stamps concealment onto emitted events, and event application
 * re-derives it while validating those events.
 */
export const isConcealedZone = (zone: CardZone): boolean =>
  zone.kind === 'deck' || zone.kind === 'hand' || zone.kind === 'prizes';
