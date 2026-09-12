import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json';
import groupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json';
import oracle from '../legacy-fixtures/renderer/compound-lower-group-rotation-v1.json';

describe('source-pinned legacy compound lower group-initiator oracle', () => {
  it('invalidates direct ingress/rotation claims and inherited compound baselines', () => {
    expect(oracle.recordingMethod).toContain('application module is stubbed');
    expect(oracle.recordingMethod).toContain('not executed');
    expect(oracle.recordingMethod).toContain('narrowly transcribed');
    for (const manifest of [oracle, groupOracle, breakOracle]) {
      expect(manifest.schemaVersion).toBe(1);
      const sourcePaths = manifest.provenance.map((entry) => entry.path);
      expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
      const claimedPaths = new Set(
        manifest.provenanceClaims.flatMap((claim) => claim.sources)
      );
      expect([...claimedPaths].sort()).toEqual([...sourcePaths].sort());
      for (const entry of manifest.provenance) {
        const source = readFileSync(resolve(process.cwd(), entry.path));
        const hashInput =
          entry.encoding === 'utf8'
            ? source.toString('utf8').replaceAll('\r\n', '\n')
            : source;
        expect(
          createHash('sha256').update(hashInput).digest('hex'),
          entry.path
        ).toBe(entry.sha256);
      }
      for (const entry of manifest.dependencies) {
        const source = readFileSync(resolve(process.cwd(), entry.path), 'utf8');
        expect(
          createHash('sha256')
            .update(source.replaceAll('\r\n', '\n'))
            .digest('hex'),
          entry.path
        ).toBe(entry.sha256);
      }
    }
  });

  it('pins sixteen independent middle/base, ordinary/BREAK, side/slot histories', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      scenarioOrder: [
        'ordinaryGroupFromMiddle',
        'ordinaryGroupFromBase',
        'breakGroupFromMiddle',
        'breakGroupFromBase',
      ],
    });
    expect(oracle.input.cases).toHaveLength(16);
    expect(new Set(oracle.input.cases).size).toBe(16);
    for (const side of ['local', 'opponent']) {
      for (const slot of ['active', 'bench']) {
        for (const suffix of [
          'group-from-middle',
          'group-from-base',
          'break-group-from-middle',
          'break-group-from-base',
        ]) {
          expect(oracle.input.cases).toContain(
            `${side}-${slot}-compound-${suffix}`
          );
        }
      }
    }
    expect(oracle.expected.frames).toEqual(groupOracle.expected.frames);
    expect(oracle.expected.frames).toEqual(breakOracle.expected.frames);
    expect(oracle.expected.frameTransforms).toEqual(
      groupOracle.expected.frameTransforms
    );
    expect(oracle.expected.frameTransforms).toEqual(
      breakOracle.expected.frameTransforms
    );
  });

  it('pins logical indices independently from reversed lower-card DOM order', () => {
    expect(oracle.expected.topology).toMatchObject({
      logicalRoles: ['top', 'middle', 'base'],
      domRoles: ['top', 'base', 'middle'],
      zByRole: { top: 0, middle: -1, base: -2 },
    });
    for (const scenario of [
      'ordinaryGroupFromMiddle',
      'breakGroupFromMiddle',
    ] as const) {
      expect(oracle.expected.scenario[scenario]).toMatchObject({
        selectedRole: 'middle',
        selectedIndex: 1,
        selectedDomOrdinal: 2,
        selectionHitRegion: 'middleAndBaseOverlap',
      });
    }
    for (const scenario of [
      'ordinaryGroupFromBase',
      'breakGroupFromBase',
    ] as const) {
      expect(oracle.expected.scenario[scenario]).toMatchObject({
        selectedRole: 'base',
        selectedIndex: 2,
        selectedDomOrdinal: 1,
        selectionHitRegion: 'baseOnly',
      });
    }
    for (const scenario of oracle.input.scenarioOrder) {
      const selected = oracle.expected.scenario[scenario];
      const selectedCalls = oracle.expected.operationTraceByScenario[
        scenario
      ].filter((call) => call.startsWith(`rotate:${selected.selectedRole}:`));
      expect(selectedCalls).toHaveLength(4);
      expect(
        selectedCalls.every((call) =>
          call.includes(`index=${selected.selectedIndex}:single=false`)
        )
      ).toBe(true);
    }
  });

  it('keeps card turns coherent while pinning BREAK initiator-dependent margins', () => {
    expect(oracle.input.phaseSequences.ordinary).toEqual(
      groupOracle.input.phaseSequence
    );
    expect(oracle.input.phaseSequences.break).toEqual(
      breakOracle.input.phaseSequence
    );
    expect(oracle.expected.inlineMarginsByCompositionAndSlot).toMatchObject({
      'break:active': [
        ['', ''],
        ['', ''],
        ['', ''],
        ['1%', '0%'],
        ['1%', '0%'],
        ['1%', '0%'],
        ['1%', '0%'],
        ['1%', '0%'],
      ],
      'break:bench': [
        ['', ''],
        ['3%', '2%'],
        ['3%', '2%'],
        ['1%', '0%'],
        ['1%', '0%'],
        ['3%', '2%'],
        ['1%', '0%'],
        ['1%', '0%'],
      ],
    });
    expect(
      oracle.expected.inlineMarginsByCompositionAndSlot['break:active'][2]
    ).not.toEqual(breakOracle.expected.inlineMargins.active['break-group-q1']);
    expect(
      oracle.expected.inlineMarginsByCompositionAndSlot['break:bench'][2]
    ).not.toEqual(breakOracle.expected.inlineMargins.bench['break-group-q1']);
    expect(
      oracle.expected.stackXByCompositionAndSlot['break:active'][2] -
        breakOracle.expected.phaseEvidenceBySlot.active[2][1][0]
    ).toBe(1.921875);
    expect(oracle.expected.refresh).toMatchObject({
      synchronousWrapperCount: 2,
      stableWrapperCount: 1,
      wrapperIdentityChanged: true,
      cardNodeIdentityPreserved: true,
      observerPairsCreated: 4,
      transcribedSourceDisconnectCalls: 0,
      harnessDisconnectCallsPerObserverKind: 4,
    });
    expect(oracle.expected.topology).toEqual(breakOracle.expected.topology);
    expect(oracle.expected.topology).toEqual(groupOracle.expected.topology);

    const lowerBench =
      oracle.expected.inlineMarginsByCompositionAndSlot['break:bench'];
    const topBench = breakOracle.expected.inlineMargins.bench;
    const phaseComparisons = [
      ['pristine-q0', 0, true],
      ['break-on-q0', 1, true],
      ['break-group-q1', 2, false],
      ['break-group-q1-refreshed', 3, true],
      ['break-group-q2', 4, false],
      ['break-group-q3', 5, false],
      ['break-group-q0-return', 6, false],
      ['break-off-q0', 7, true],
    ] as const;
    for (const [phaseName, phaseIndex, equal] of phaseComparisons) {
      if (equal) {
        expect(lowerBench[phaseIndex], phaseName).toEqual(topBench[phaseName]);
      } else {
        expect(lowerBench[phaseIndex], phaseName).not.toEqual(
          topBench[phaseName]
        );
      }
    }
  });

  it('keeps lower-card single rotation and mixed initiator histories outside this gate', () => {
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('single=true or Alt-R'),
        expect.stringContaining('mixed top/lower'),
        expect.stringContaining('refresh other than coherent q1'),
        expect.stringContaining('attachment timing'),
        expect.stringContaining('candidate parity'),
      ])
    );
  });
});
