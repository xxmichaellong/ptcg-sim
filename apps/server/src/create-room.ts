import {
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  type PlayerId,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  assertAuthoritySnapshotInvariants,
  createRoomAdmissionState,
  emptyProjectionIdentityState,
  type AdmissionCrypto,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

export interface RoomCreationCrypto extends AdmissionCrypto {
  readonly nextPlayerId: () => string;
  readonly nextSeatCapability: () => string;
  readonly nextSpectatorCapability: () => string;
}

export interface InitialRoomStore {
  readonly initialize: (snapshot: RoomAuthoritySnapshot) => Promise<void>;
}

export interface NewRoomInput {
  readonly matchId: string;
  readonly playerOneCardBackUrl: string;
  readonly playerTwoCardBackUrl: string;
  readonly spectatorsAllowed: boolean;
}

export interface NewRoomCredentials {
  readonly playerOneSeatCapability: string;
  readonly playerTwoSeatCapability: string;
  readonly spectatorCapability?: string;
}

const nextDistinctPlayerIds = (
  cryptoSource: RoomCreationCrypto
): readonly [PlayerId, PlayerId] => {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const first = cryptoSource.nextPlayerId();
    const second = cryptoSource.nextPlayerId();
    if (
      first !== second &&
      first.length >= 16 &&
      first.length <= 128 &&
      second.length >= 16 &&
      second.length <= 128
    ) {
      return [asPlayerId(first), asPlayerId(second)];
    }
  }
  throw new Error('Player ID source failed to produce distinct bounded IDs');
};

export const initializeNewRoom = async (
  input: NewRoomInput,
  store: InitialRoomStore,
  cryptoSource: RoomCreationCrypto
): Promise<{
  readonly snapshot: RoomAuthoritySnapshot;
  readonly credentials: NewRoomCredentials;
}> => {
  if (input.matchId.length < 1 || input.matchId.length > 128) {
    throw new Error('Match ID must be a bounded non-empty string');
  }
  const [playerOneId, playerTwoId] = nextDistinctPlayerIds(cryptoSource);
  const playerOneSeatCapability = cryptoSource.nextSeatCapability();
  const playerTwoSeatCapability = cryptoSource.nextSeatCapability();
  const spectatorCapability = input.spectatorsAllowed
    ? cryptoSource.nextSpectatorCapability()
    : undefined;
  const [playerOneDigest, playerTwoDigest, spectatorDigest] = await Promise.all(
    [
      cryptoSource.digestCapability(playerOneSeatCapability),
      cryptoSource.digestCapability(playerTwoSeatCapability),
      spectatorCapability
        ? cryptoSource.digestCapability(spectatorCapability)
        : Promise.resolve(undefined),
    ]
  );
  const snapshot: RoomAuthoritySnapshot = {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    state: createEmptyMatch(asMatchId(input.matchId), [
      {
        playerId: playerOneId,
        displayName: 'Player 1',
        cardBackUrl: input.playerOneCardBackUrl,
      },
      {
        playerId: playerTwoId,
        displayName: 'Player 2',
        cardBackUrl: input.playerTwoCardBackUrl,
      },
    ]),
    identities: emptyProjectionIdentityState(),
    sessions: {},
    admission: createRoomAdmissionState({
      playerIds: [playerOneId, playerTwoId],
      seatCapabilityDigests: {
        [playerOneId]: playerOneDigest,
        [playerTwoId]: playerTwoDigest,
      },
      ...(spectatorDigest
        ? { spectatorCapabilityDigest: spectatorDigest }
        : {}),
    }),
  };
  assertAuthoritySnapshotInvariants(snapshot);
  await store.initialize(snapshot);
  return {
    snapshot,
    credentials: {
      playerOneSeatCapability,
      playerTwoSeatCapability,
      ...(spectatorCapability ? { spectatorCapability } : {}),
    },
  };
};
