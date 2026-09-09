import { createHash } from 'node:crypto';

import { asMatchId, asPlayerId, stableSerialize } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  LEGACY_CONVERSION_REPORT_FORMAT,
  LEGACY_CONVERSION_TARGET_SERIALIZATION,
  MAX_LEGACY_CONVERSION_SOURCE_BYTES,
  convertLegacyExportBytes,
} from './index.js';

const encoder = new TextEncoder();

const action = (user: 'self' | 'opp', name: string, parameters: unknown[]) => ({
  user,
  emit: true,
  action: name,
  parameters,
});

const payload = (...actions: unknown[]) => [
  { version: '1.5.1' },
  action('self', 'loadDeckData', [
    [
      [
        '2',
        'Transaction card',
        'Pokémon',
        'https://cards.example/transaction.png',
      ],
    ],
  ]),
  action('opp', 'loadDeckData', ['']),
  ...actions,
];

const target = {
  matchId: asMatchId('legacy-transaction-match'),
  selfSeat: {
    playerId: asPlayerId('legacy-transaction-self'),
    displayName: 'Self',
    cardBackUrl: '/self.png',
  },
  opponentSeat: {
    playerId: asPlayerId('legacy-transaction-opponent'),
    displayName: 'Opponent',
    cardBackUrl: '/opponent.png',
  },
} as const;

const nodeSha256 = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

describe('legacy conversion transaction and report', () => {
  it.each(['1.5', '1.5.1'] as const)(
    'converts supported %s bytes through the public package entrypoint',
    async (version) => {
      const value = payload();
      value[0] = { version };
      const result = await convertLegacyExportBytes(
        encoder.encode(JSON.stringify(value)),
        target
      );

      expect(result.ok).toBe(true);
      expect(result.report.summary).toMatchObject({
        sourceVersion: version,
        sourceActionCount: 2,
        convertedRecordCount: 2,
      });
    }
  );

  it('hashes exact source bytes and canonical target state independently', async () => {
    const value = payload(
      action('self', 'draw', ['opp', 1]),
      action('self', 'discardBoard', ['opp', true])
    );
    const compactBytes = encoder.encode(JSON.stringify(value));
    const prettyBytes = encoder.encode(JSON.stringify(value, null, 2));
    const compact = await convertLegacyExportBytes(compactBytes, target);
    const pretty = await convertLegacyExportBytes(prettyBytes, target);

    expect(compact.ok).toBe(true);
    expect(pretty.ok).toBe(true);
    if (!compact.ok || !pretty.ok) throw new Error('Expected conversion');
    expect(compact.report).toMatchObject({
      format: LEGACY_CONVERSION_REPORT_FORMAT,
      status: 'converted',
      source: {
        byteLength: compactBytes.byteLength,
        encoding: 'UTF-8',
        sha256: nodeSha256(compactBytes),
      },
      target: {
        serialization: LEGACY_CONVERSION_TARGET_SERIALIZATION,
        matchStateSchemaVersion: 3,
      },
      summary: {
        sourceVersion: '1.5.1',
        sourceActionCount: 4,
        convertedRecordCount: 4,
        batchCount: 3,
        eventCount: 3,
        zeroBatchRecordCount: 1,
      },
      warnings: [
        {
          code: 'legacy_transport_metadata_not_persisted',
          count: 4,
        },
        { code: 'presentation_fields_not_persisted', count: 3 },
      ],
      droppedPresentationFields: [
        {
          recordIndex: 3,
          path: '$[3].parameters[0]',
          reason: 'initiator_was_presentation_only',
        },
        {
          recordIndex: 4,
          path: '$[4].parameters[0]',
          reason: 'initiator_was_presentation_only',
        },
        {
          recordIndex: 4,
          path: '$[4].parameters[1]',
          reason: 'message_flag_was_presentation_only',
        },
      ],
      issues: [],
    });
    const canonicalTargetBytes = encoder.encode(stableSerialize(compact.state));
    expect(compact.report.target).toEqual({
      byteLength: canonicalTargetBytes.byteLength,
      serialization: LEGACY_CONVERSION_TARGET_SERIALIZATION,
      matchStateSchemaVersion: 3,
      sha256: nodeSha256(canonicalTargetBytes),
    });
    expect(compact.report.target.sha256).toBe(
      'sha256:28e8812060b4419c998f0d3f314db6c381d345abccf70a50e1985c55d2f2f654'
    );
    expect(pretty.report.source.sha256).toBe(nodeSha256(prettyBytes));
    expect(pretty.report.source.sha256).not.toBe(compact.report.source.sha256);
    expect(pretty.report.target.sha256).toBe(compact.report.target.sha256);
    expect(stableSerialize(pretty.state)).toBe(stableSerialize(compact.state));
    expect(JSON.parse(JSON.stringify(compact.report))).toEqual(compact.report);
  });

  it('copies caller-owned bytes and target seats before asynchronous work', async () => {
    const source = encoder.encode(JSON.stringify(payload()));
    const expectedSourceHash = nodeSha256(source);
    const mutableTarget = {
      matchId: target.matchId,
      selfSeat: { ...target.selfSeat },
      opponentSeat: { ...target.opponentSeat },
    };
    const conversion = convertLegacyExportBytes(source, mutableTarget);
    source.fill(0);
    mutableTarget.matchId = asMatchId('mutated-match');
    mutableTarget.selfSeat.displayName = 'Mutated self';
    mutableTarget.selfSeat.cardBackUrl = '/mutated-self.png';
    mutableTarget.opponentSeat.displayName = 'Mutated opponent';
    const result = await conversion;

    expect(result.ok).toBe(true);
    expect(result.report.source.sha256).toBe(expectedSourceHash);
    if (!result.ok) throw new Error('Expected conversion');
    expect(result.state.matchId).toBe(target.matchId);
    expect(result.state.players[target.selfSeat.playerId]).toMatchObject({
      id: target.selfSeat.playerId,
      displayName: target.selfSeat.displayName,
      cardBackUrl: target.selfSeat.cardBackUrl,
    });
    expect(result.state.players[target.opponentSeat.playerId]).toMatchObject({
      id: target.opponentSeat.playerId,
      displayName: target.opponentSeat.displayName,
      cardBackUrl: target.opponentSeat.cardBackUrl,
    });
  });

  it('hashes bounded invalid UTF-8 and JSON while preserving safe diagnostics', async () => {
    const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0xfd]);
    const utf8Result = await convertLegacyExportBytes(invalidUtf8, target);
    expect(utf8Result).toEqual({
      ok: false,
      report: {
        format: LEGACY_CONVERSION_REPORT_FORMAT,
        status: 'rejected',
        source: {
          byteLength: invalidUtf8.byteLength,
          encoding: 'UTF-8',
          sha256: nodeSha256(invalidUtf8),
        },
        target: null,
        summary: {
          sourceVersion: null,
          sourceActionCount: null,
          convertedRecordCount: 0,
          batchCount: 0,
          eventCount: 0,
          zeroBatchRecordCount: 0,
        },
        warnings: [],
        droppedPresentationFields: [],
        issues: [
          {
            stage: 'source',
            code: 'source.invalid_utf8',
            recordIndex: null,
            path: '$',
            message: 'Legacy export bytes must contain valid UTF-8',
          },
        ],
      },
    });

    const invalidJson = encoder.encode('abc');
    const jsonResult = await convertLegacyExportBytes(invalidJson, target);
    expect(jsonResult.report.source.sha256).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(jsonResult.report.issues).toEqual([
      {
        stage: 'parse',
        code: 'parse.invalid_json',
        recordIndex: null,
        path: '$',
        message: 'Legacy export is not valid JSON',
      },
    ]);
    expect('state' in jsonResult).toBe(false);
  });

  it('rejects oversized bytes before hashing or decoding', async () => {
    const bytes = new Uint8Array(MAX_LEGACY_CONVERSION_SOURCE_BYTES + 1);
    const result = await convertLegacyExportBytes(bytes, target);

    expect(result).toMatchObject({
      ok: false,
      report: {
        status: 'rejected',
        source: {
          byteLength: MAX_LEGACY_CONVERSION_SOURCE_BYTES + 1,
          encoding: 'UTF-8',
          sha256: null,
        },
        target: null,
        issues: [
          {
            stage: 'source',
            code: 'source.payload_too_large',
            recordIndex: null,
            path: '$',
          },
        ],
      },
    });
    expect('state' in result).toBe(false);
  });

  it('reports exact semantic failure records without returning partial state', async () => {
    const bytes = encoder.encode(
      JSON.stringify(
        payload(
          action('self', 'changeCardBack', [
            'https://cards.example/custom-back.png',
          ])
        )
      )
    );
    const first = await convertLegacyExportBytes(bytes, target);
    const retry = await convertLegacyExportBytes(bytes, target);

    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      ok: false,
      report: {
        status: 'rejected',
        source: { sha256: nodeSha256(bytes) },
        target: null,
        summary: {
          sourceVersion: '1.5.1',
          sourceActionCount: 3,
          convertedRecordCount: 0,
        },
        warnings: [],
        issues: [
          {
            stage: 'convert',
            code: 'convert.unsupported_action',
            recordIndex: 3,
            path: '$[3].action',
            message: 'Legacy action family has not been semantically converted',
          },
        ],
      },
    });
    expect('state' in first).toBe(false);
    expect('records' in first).toBe(false);
  });

  it('names the exact malformed envelope record before candidate construction', async () => {
    const malformed = payload();
    malformed.push({
      user: 'self',
      emit: false,
      action: 'draw',
      parameters: ['self', 1],
    });
    const result = await convertLegacyExportBytes(
      encoder.encode(JSON.stringify(malformed)),
      target
    );

    expect(result).toMatchObject({
      ok: false,
      report: {
        target: null,
        issues: [
          {
            stage: 'parse',
            code: 'parse.invalid_action_record',
            recordIndex: 3,
            path: '$[3]',
          },
        ],
      },
    });
    expect('state' in result).toBe(false);
  });
});
