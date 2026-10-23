import { asZoneId, type MatchId, type PlayerId, type ZoneId } from './ids.js';
import {
  MATCH_STATE_SCHEMA_VERSION,
  type MatchSeatInput,
  type MatchState,
  type PlayerZoneKind,
} from './model.js';

const PLAYER_ZONE_KINDS: readonly PlayerZoneKind[] = [
  'deck',
  'hand',
  'prizes',
  'discard',
  'lostZone',
  'board',
];

export const playerZoneId = (
  playerId: PlayerId,
  kind: PlayerZoneKind
): ZoneId => asZoneId(`zone:${playerId}:${kind}`);

export const stadiumZoneId = (): ZoneId => asZoneId('zone:shared:stadium');

export const createEmptyMatch = (
  matchId: MatchId,
  seats: readonly MatchSeatInput[]
): MatchState => {
  if (seats.length !== 2) {
    throw new Error('PTCG Sim matches require exactly two seats');
  }

  const players: Record<string, MatchState['players'][string]> = {};
  const zones: Record<string, MatchState['zones'][string]> = {};
  const boards: Record<string, MatchState['boards'][string]> = {};
  const workAreas: Record<string, MatchState['workAreas'][string]> = {};

  for (const seat of seats) {
    if (players[seat.playerId]) {
      throw new Error(`Duplicate player ID: ${seat.playerId}`);
    }
    players[seat.playerId] = {
      id: seat.playerId,
      displayName: seat.displayName,
      cardBackUrl: seat.cardBackUrl,
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    };
    for (const kind of PLAYER_ZONE_KINDS) {
      const id = playerZoneId(seat.playerId, kind);
      zones[id] = { id, kind, ownerId: seat.playerId, cardIds: [] };
    }
    boards[seat.playerId] = { activeStackId: null, benchStackIds: [] };
    workAreas[seat.playerId] = {
      inspection: null,
      attachmentResolution: null,
    };
  }

  const stadiumId = stadiumZoneId();
  zones[stadiumId] = {
    id: stadiumId,
    kind: 'stadium',
    ownerId: null,
    cardIds: [],
  };

  return {
    schemaVersion: MATCH_STATE_SCHEMA_VERSION,
    matchId,
    revision: 0,
    lifecycle: 'lobby',
    playerOrder: seats.map((seat) => seat.playerId),
    players,
    definitions: {},
    cards: {},
    deckLists: Object.fromEntries(seats.map((seat) => [seat.playerId, []])),
    zones,
    boards,
    stacks: {},
    workAreas,
    visibility: { publicCardIds: [], inspectionGrants: {} },
    turn: { number: 0, currentPlayerId: null },
    rngVersion: 1,
  };
};
