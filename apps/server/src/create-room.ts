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
  createReplayHistory,
  emptyProjectionIdentityState,
  type AdmissionCrypto,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import type { RoomCreationResponse } from '@ptcgsim/protocol';

export interface RoomCreationCrypto extends AdmissionCrypto {
  readonly nextPlayerId: () => string;
  readonly nextSeatCapability: () => string;
  readonly nextSpectatorCapability: () => string;
}

export interface InitialRoomStore {
  readonly initialize: (
    snapshot: RoomAuthoritySnapshot,
    lifecycle: {
      readonly createdAt: number;
      readonly unclaimedExpiresAt: number;
    }
  ) => Promise<void>;
}

export const DEFAULT_UNCLAIMED_ROOM_LIFETIME_MS = 5 * 60_000;

export interface NewRoomInput {
  readonly matchId: string;
  readonly playerOneCardBackUrl: string;
  readonly playerTwoCardBackUrl: string;
  readonly spectatorsAllowed: boolean;
}

export type NewRoomCredentials = RoomCreationResponse['credentials'];

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

const boundedCapability = (value: string): boolean =>
  value.length >= 32 && value.length <= 512;

const nextDistinctCredentials = (
  cryptoSource: RoomCreationCrypto,
  spectatorsAllowed: boolean
): NewRoomCredentials => {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const playerOneSeatCapability = cryptoSource.nextSeatCapability();
    const playerTwoSeatCapability = cryptoSource.nextSeatCapability();
    const spectatorCapability = spectatorsAllowed
      ? cryptoSource.nextSpectatorCapability()
      : undefined;
    const values = [
      playerOneSeatCapability,
      playerTwoSeatCapability,
      ...(spectatorCapability ? [spectatorCapability] : []),
    ];
    if (
      values.every(boundedCapability) &&
      new Set(values).size === values.length
    ) {
      return {
        playerOneSeatCapability,
        playerTwoSeatCapability,
        ...(spectatorCapability ? { spectatorCapability } : {}),
      };
    }
  }
  throw new Error(
    'Capability source failed to produce distinct bounded credentials'
  );
};

export const initializeNewRoom = async (
  input: NewRoomInput,
  store: InitialRoomStore,
  cryptoSource: RoomCreationCrypto,
  createdAt: number,
  unclaimedRoomLifetimeMs = DEFAULT_UNCLAIMED_ROOM_LIFETIME_MS
): Promise<{
  readonly snapshot: RoomAuthoritySnapshot;
  readonly credentials: NewRoomCredentials;
}> => {
  if (input.matchId.length < 1 || input.matchId.length > 128) {
    throw new Error('Match ID must be a bounded non-empty string');
  }
  if (
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    !Number.isSafeInteger(unclaimedRoomLifetimeMs) ||
    unclaimedRoomLifetimeMs < 30_000 ||
    unclaimedRoomLifetimeMs > 24 * 60 * 60_000 ||
    !Number.isSafeInteger(createdAt + unclaimedRoomLifetimeMs)
  ) {
    throw new Error('Initial room lifecycle policy is invalid');
  }
  const [playerOneId, playerTwoId] = nextDistinctPlayerIds(cryptoSource);
  const credentials = nextDistinctCredentials(
    cryptoSource,
    input.spectatorsAllowed
  );
  const {
    playerOneSeatCapability,
    playerTwoSeatCapability,
    spectatorCapability,
  } = credentials;
  const [playerOneDigest, playerTwoDigest, spectatorDigest] = await Promise.all(
    [
      cryptoSource.digestCapability(playerOneSeatCapability),
      cryptoSource.digestCapability(playerTwoSeatCapability),
      spectatorCapability
        ? cryptoSource.digestCapability(spectatorCapability)
        : Promise.resolve(undefined),
    ]
  );
  const credentialDigests = [
    playerOneDigest,
    playerTwoDigest,
    ...(spectatorDigest ? [spectatorDigest] : []),
  ];
  if (new Set(credentialDigests).size !== credentialDigests.length) {
    throw new Error('Capability digest source produced duplicate credentials');
  }
  const state = createEmptyMatch(asMatchId(input.matchId), [
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
  ]);
  const snapshot: RoomAuthoritySnapshot = {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'multiplayer',
    state,
    soloUndoHistory: {
      baseState: null,
      baseStateHash: null,
      entries: [],
    },
    replayHistory: createReplayHistory(state),
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
  await store.initialize(snapshot, {
    createdAt,
    unclaimedExpiresAt: createdAt + unclaimedRoomLifetimeMs,
  });
  return {
    snapshot,
    credentials,
  };
};
