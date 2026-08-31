import { describe, expect, it } from 'vitest';
import { MAX_CLIENT_FRAME_CODE_UNITS, PROTOCOL_VERSION } from './constants.js';
import { parseClientFrame } from './ingress.js';

describe('client protocol ingress', () => {
  it('accepts a bounded typed command and strips unknown keys', () => {
    const result = parseClientFrame(
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 1,
        commandId: 'command',
        lastSeenRevision: 0,
        ignored: 'not delivered',
        command: { type: 'DrawCards', count: 1, ignored: true },
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('ignored' in result.value).toBe(false);
    expect('ignored' in result.value.command).toBe(false);
  });

  it('rejects unknown command variants and invalid sequences', () => {
    const unknown = parseClientFrame(
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 1,
        commandId: 'command',
        lastSeenRevision: 0,
        command: { type: 'ExecuteArbitraryFunction', name: 'reset' },
      })
    );
    expect(unknown.ok).toBe(false);

    const invalidSequence = parseClientFrame(
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 0,
        commandId: 'command',
        lastSeenRevision: 0,
        command: { type: 'FlipCoin' },
      })
    );
    expect(invalidSequence.ok).toBe(false);
  });

  it('rejects oversized input before JSON traversal', () => {
    const result = parseClientFrame(
      ' '.repeat(MAX_CLIENT_FRAME_CODE_UNITS + 1)
    );
    expect(result).toEqual({ ok: false, reason: 'frame_too_large' });
  });

  it('never echoes rejected values in issue summaries', () => {
    const secret = 'SECRET-DECK-VALUE';
    const result = parseClientFrame(
      JSON.stringify({ type: 'SendChat', protocolVersion: 99, message: secret })
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
