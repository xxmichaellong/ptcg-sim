import { assertMatchInvariants } from '@ptcgsim/game-core';

import { viewerIdentityKey } from './identity-registry.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  type RoomAuthoritySnapshot,
} from './model.js';

export class AuthoritySnapshotInvariantError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Authority snapshot invariant violation:\n${problems.join('\n')}`);
    this.name = 'AuthoritySnapshotInvariantError';
    this.problems = problems;
  }
}

export const collectAuthoritySnapshotProblems = (
  snapshot: RoomAuthoritySnapshot
): readonly string[] => {
  const problems: string[] = [];
  if (snapshot.schemaVersion !== AUTHORITY_SNAPSHOT_SCHEMA_VERSION) {
    problems.push(`unsupported authority schema ${snapshot.schemaVersion}`);
  }

  const activePlayerSessions = new Set<string>();
  for (const [key, session] of Object.entries(snapshot.sessions)) {
    if (key !== session.id) problems.push(`session key ${key} mismatches ID`);
    if (
      !Number.isSafeInteger(session.nextClientSequence) ||
      session.nextClientSequence < 1
    ) {
      problems.push(`session ${session.id} has invalid sequence frontier`);
    }
    if (session.viewer.kind === 'player') {
      if (!snapshot.state.players[session.viewer.playerId]) {
        problems.push(`session ${session.id} references an unknown player`);
      }
      if (session.active) {
        if (activePlayerSessions.has(session.viewer.playerId)) {
          problems.push(
            `player ${session.viewer.playerId} has multiple active sessions`
          );
        }
        activePlayerSessions.add(session.viewer.playerId);
      }
    }
    const commandIds = new Set<string>();
    for (const outcome of session.recentOutcomes) {
      if (commandIds.has(outcome.commandId)) {
        problems.push(`session ${session.id} duplicates a command outcome`);
      }
      commandIds.add(outcome.commandId);
      if (
        !Number.isSafeInteger(outcome.clientSequence) ||
        outcome.clientSequence < 1 ||
        outcome.clientSequence >= session.nextClientSequence
      ) {
        problems.push(`session ${session.id} has an invalid cached sequence`);
      }
      if (outcome.revision > snapshot.state.revision) {
        problems.push(`session ${session.id} caches a future revision`);
      }
    }
  }

  const aliases = [
    ...snapshot.identities.cardAliases,
    ...snapshot.identities.definitionAliases,
  ];
  if (new Set(aliases.map((entry) => entry.alias)).size !== aliases.length) {
    problems.push('projection aliases are not globally unique');
  }
  const validViewerKeys = new Set([
    'spectator',
    ...Object.values(snapshot.state.players).map((player) =>
      viewerIdentityKey({ kind: 'player', playerId: player.id })
    ),
  ]);
  for (const entry of aliases) {
    if (entry.alias.length < 16 || entry.alias.length > 128) {
      problems.push('projection alias has invalid length');
    }
    if (!validViewerKeys.has(entry.viewerKey)) {
      problems.push('projection alias references an unknown viewer');
    }
  }
  for (const entry of snapshot.identities.cardAliases) {
    if (!snapshot.state.cards[entry.cardId]) {
      problems.push(`projection alias references missing card ${entry.cardId}`);
    }
  }
  for (const entry of snapshot.identities.definitionAliases) {
    if (!snapshot.state.definitions[entry.definitionId]) {
      problems.push(
        `projection alias references missing definition ${entry.definitionId}`
      );
    }
  }
  return problems;
};

export const assertAuthoritySnapshotInvariants = (
  snapshot: RoomAuthoritySnapshot
): void => {
  assertMatchInvariants(snapshot.state);
  const problems = collectAuthoritySnapshotProblems(snapshot);
  if (problems.length > 0) throw new AuthoritySnapshotInvariantError(problems);
};
