import {
  PROTOCOL_VERSION,
  type PresentationEvent,
  type ServerMessage,
} from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import { readableBy } from './presentation-level.js';

const damage: PresentationEvent = {
  type: 'DamageSet',
  revision: 2,
  playerId: 'p1',
  source: 'active',
  cardName: 'Pikachu',
  damage: 30,
};
const mulligan: PresentationEvent = {
  type: 'MulliganDeclared',
  revision: 2,
  playerId: 'p1',
};
const publication = (
  presentationEvents: PresentationEvent[]
): ServerMessage =>
  ({
    type: 'StatePublication',
    protocolVersion: PROTOCOL_VERSION,
    executedClientSequence: 1,
    snapshot: {},
    presentationEvents,
  }) as unknown as ServerMessage;

describe('a frame as each client reads it', () => {
  it('leaves out for a build from before levels the events it would refuse, and the field once none is left', () => {
    expect(readableBy(publication([damage, mulligan]), 0)).toMatchObject({
      presentationEvents: [mulligan],
    });
    const none = readableBy(publication([damage]), 0);
    expect(none).not.toHaveProperty('presentationEvents');
    expect(none).toMatchObject({ type: 'StatePublication' });
    const replay = {
      type: 'ReplayFrame',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay',
      index: 0,
      snapshot: {},
      presentationEvents: [damage, mulligan],
    } as unknown as ServerMessage;
    expect(readableBy(replay, 0)).toMatchObject({
      presentationEvents: [mulligan],
    });
  });

  it('sends a client that reads them the frame as it is', () => {
    const frame = publication([damage, mulligan]);
    expect(readableBy(frame, 1)).toBe(frame);
    const pong = {
      type: 'Pong',
      protocolVersion: PROTOCOL_VERSION,
      id: 'ping',
    } as unknown as ServerMessage;
    expect(readableBy(pong, 0)).toBe(pong);
  });
});
