import type { Page } from '@playwright/test';

import {
  captureMarkerRotation,
  type CapturedMarker,
  type MarkerKind,
  type MarkerPhase,
  type MarkerSide,
  type RuntimeMarkerCard,
} from './legacy-runtime-marker.js';
import { captureLegacyRuntimeLayout } from './legacy-runtime-layout.js';
import { loadLegacyRuntime } from './legacy-runtime.js';

export type CapturedRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type LegacyFixtureSide = MarkerSide;
export type LegacyBenchMarkerKind = 'damage' | 'ability';

export interface LegacyBenchMarkerRotationCard extends RuntimeMarkerCard {
  readonly physicalBounds: CapturedRect;
  readonly effectiveRotationDegrees: number;
}

export interface LegacyBenchMarkerRotationMarker extends Omit<
  CapturedMarker,
  'bounds' | 'kind'
> {
  readonly kind: LegacyBenchMarkerKind;
  readonly frameLocalBounds: CapturedRect;
  readonly physicalBounds: CapturedRect;
  readonly effectiveRotationDegrees: number;
}

export interface LegacyBenchMarkerRotationPhase {
  readonly name: 'marked-q0' | 'q1' | 'q2' | 'q3' | 'q0-return';
  readonly card: LegacyBenchMarkerRotationCard;
  readonly wrapper: {
    readonly id: string;
    readonly frameLocalBounds: CapturedRect;
    readonly physicalBounds: CapturedRect;
    readonly clientWidth: number;
    readonly clientHeight: number;
    readonly authoredWidthPx: number | null;
    readonly inlineMarginRight: string;
    readonly inlineMarginLeft: string;
    readonly computedMarginRightPx: number;
    readonly computedMarginLeftPx: number;
    readonly childImageCount: number;
  };
  readonly markers: readonly LegacyBenchMarkerRotationMarker[];
  readonly specialConditionMarkerCount: number;
  readonly markerOverlapHitOrder: readonly string[] | null;
  readonly cardOnlyHitOrder: readonly string[];
}

export interface LegacyBenchMarkerRotationCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly initialCard: LegacyBenchMarkerRotationCard;
  readonly initialWrapperMargins: {
    readonly inlineRight: string;
    readonly inlineLeft: string;
    readonly computedRightPx: number;
    readonly computedLeftPx: number;
  };
  readonly phases: readonly LegacyBenchMarkerRotationPhase[];
  readonly cleanup: {
    readonly markerCount: number;
    readonly specialConditionMarkerCount: number;
    readonly cardPointersAreNull: boolean;
    readonly wrapperCountAfterTwoFrames: number;
    readonly cardCountAfterTwoFrames: number;
    readonly benchZIndexAfterCleanup: number;
  };
}

export interface LegacyRuntimeBenchMarkerFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<
      LegacyFixtureSide,
      {
        readonly a: number;
        readonly b: number;
        readonly c: number;
        readonly d: number;
        readonly rotationDegrees: number;
      }
    >
  >;
  readonly cases: readonly LegacyBenchMarkerRotationCase[];
  readonly sourceFulfillment: {
    readonly servedPaths: readonly string[];
    readonly blockedExternalOrigins: readonly string[];
    readonly missingSameOriginPaths: readonly string[];
  };
}

const phaseNames = ['marked-q0', 'q1', 'q2', 'q3', 'q0-return'] as const;

/** Runs the sole-bench marker/rotation fixture through the actual v1 modules. */
export const captureLegacyRuntimeBenchMarkerFixture = async (
  page: Page,
  options: { readonly retainStablePaint?: boolean } = {}
): Promise<LegacyRuntimeBenchMarkerFixture> => {
  const loaded = await loadLegacyRuntime(page);
  const layout = await captureLegacyRuntimeLayout(page);
  const frames = layout.frames;
  const frameTransforms = Object.fromEntries(
    Object.entries(layout.frameTransforms).map(([side, transform]) => [
      side,
      {
        ...transform,
        rotationDegrees:
          ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) % 360,
      },
    ])
  ) as LegacyRuntimeBenchMarkerFixture['frameTransforms'];
  const physicalBounds = (
    side: LegacyFixtureSide,
    bounds: CapturedRect
  ): CapturedRect => {
    const frame = frames[side];
    return side === 'local'
      ? { ...bounds, x: frame.x + bounds.x, y: frame.y + bounds.y }
      : {
          ...bounds,
          x: frame.x + frame.width - bounds.x - bounds.width,
          y: frame.y + frame.height - bounds.y - bounds.height,
        };
  };
  const idsFor = (side: LegacyFixtureSide) => ({
    cardId: `${side}-bench-marker-card`,
    stackId: `${side}-bench-marker-stack`,
    markerIdsByKind: {
      damage: `${side}-bench-damage-marker`,
      specialCondition: `${side}-bench-specialCondition-marker`,
      ability: `${side}-bench-ability-marker`,
    } satisfies Record<MarkerKind, string>,
  });
  const cases: LegacyBenchMarkerRotationCase[] = [];

  for (const side of ['local', 'opponent'] as const) {
    const capture = await captureMarkerRotation(page, {
      side,
      slot: 'bench',
      damageInitial: '120',
      damageUpdated: '130',
      specialConditionInputs: [],
      phaseNames,
      ...idsFor(side),
    });
    const convertCard = (
      card: RuntimeMarkerCard
    ): LegacyBenchMarkerRotationCard => ({
      ...card,
      physicalBounds: physicalBounds(side, card.frameLocalBounds),
      effectiveRotationDegrees:
        (card.localRotationDegrees + frameTransforms[side].rotationDegrees) %
        360,
    });
    const convertMarker = (
      marker: CapturedMarker
    ): LegacyBenchMarkerRotationMarker => {
      const { bounds, kind, ...details } = marker;
      return {
        ...details,
        kind: kind as LegacyBenchMarkerKind,
        frameLocalBounds: bounds,
        physicalBounds: physicalBounds(side, bounds),
        effectiveRotationDegrees:
          (marker.localRotationDegrees +
            frameTransforms[side].rotationDegrees) %
          360,
      };
    };
    const convertPhase = (
      phase: MarkerPhase
    ): LegacyBenchMarkerRotationPhase => ({
      name: phase.name as LegacyBenchMarkerRotationPhase['name'],
      card: convertCard(phase.cardDetails),
      wrapper: {
        ...phase.wrapperDetails,
        physicalBounds: physicalBounds(
          side,
          phase.wrapperDetails.frameLocalBounds
        ),
      },
      markers: phase.markers.map(convertMarker),
      specialConditionMarkerCount: phase.specialConditionMarkerCount,
      markerOverlapHitOrder: phase.markerOverlapHitOrder,
      cardOnlyHitOrder: phase.cardOnlyHitOrder,
    });
    cases.push({
      id: `${side}-bench-marker-rotation`,
      side,
      initialCard: convertCard(capture.initialCard.details),
      initialWrapperMargins: {
        inlineRight: capture.initialCard.initialWrapperMargins[0],
        inlineLeft: capture.initialCard.initialWrapperMargins[1],
        computedRightPx: capture.initialCard.initialWrapperMargins[2],
        computedLeftPx: capture.initialCard.initialWrapperMargins[3],
      },
      phases: capture.phases.map(convertPhase),
      cleanup: {
        markerCount: capture.cleanup.markerCount,
        specialConditionMarkerCount: 0,
        cardPointersAreNull: capture.cleanup.cardPointersAreNull,
        wrapperCountAfterTwoFrames: capture.cleanup.wrapperCount,
        cardCountAfterTwoFrames: capture.cleanup.cardCount,
        benchZIndexAfterCleanup: capture.cleanup.zoneZIndex,
      },
    });
  }

  if (options.retainStablePaint) {
    for (const side of ['local', 'opponent'] as const) {
      await captureMarkerRotation(page, {
        side,
        slot: 'bench',
        damageInitial: '120',
        damageUpdated: '130',
        specialConditionInputs: [],
        phaseNames: ['marked-q0'],
        ...idsFor(side),
        preserveOtherSide: side === 'opponent',
        retainMarkedPaint: true,
      });
    }
  }

  return {
    frames,
    frameTransforms,
    cases,
    sourceFulfillment: {
      servedPaths: loaded.servedPaths,
      blockedExternalOrigins: loaded.blockedOrigins,
      missingSameOriginPaths: loaded.missingPaths,
    },
  };
};
