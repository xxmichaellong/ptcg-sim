import type { Page } from '@playwright/test';

import {
  captureAttachmentDeparture,
  captureReflow,
  type DepartureSample,
  type ReflowSide,
} from './legacy-runtime-attachment-reflow.js';
import { captureLegacyRuntimeLayout } from './legacy-runtime-layout.js';
import { loadLegacyRuntime } from './legacy-runtime.js';

export type CapturedRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type LegacyFixtureSide = ReflowSide;
export type LegacyTwoEnergyDepartureBranch = 'inner' | 'outer';

export interface LegacyFrameTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly rotationDegrees: number;
}

export interface LegacyTwoEnergyCompactionFixtureCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: 'base' | 'energy1' | 'energy2';
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly domOrdinal: number;
  readonly logicalOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyTwoEnergyCompactionFixtureStack {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly baseClientWidth: number;
  readonly baseEnergyLayer: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
  readonly hitOrder: Readonly<Record<string, readonly string[]>>;
  readonly hitPointsFrameLocal: {
    readonly allCardOverlap: { readonly x: number; readonly y: number };
    readonly attachmentOverlap: { readonly x: number; readonly y: number };
    readonly outermostAttachment: { readonly x: number; readonly y: number };
    readonly baseOnly: { readonly x: number; readonly y: number };
  };
}

export interface LegacyTwoEnergyCompactionFixturePhase {
  readonly cards: readonly LegacyTwoEnergyCompactionFixtureCard[];
  readonly stack: LegacyTwoEnergyCompactionFixtureStack;
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
}

export interface LegacyTwoEnergyCompactionRemovedCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: 'energy1' | 'energy2';
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly sourcePath: string;
  readonly sinkConnected: boolean;
  readonly parentIsDepartureSink: boolean;
}

export interface LegacyTwoEnergyCompactionFixtureCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly branch: LegacyTwoEnergyDepartureBranch;
  readonly removedCardId: string;
  readonly remainingCardId: string;
  readonly removedCardAfterDeparture: LegacyTwoEnergyCompactionRemovedCard;
  readonly stablePreDeparture: LegacyTwoEnergyCompactionFixturePhase;
  readonly transientPostDeparture: LegacyTwoEnergyCompactionFixturePhase;
  readonly synchronousPostRefresh: LegacyTwoEnergyCompactionFixturePhase;
  readonly stablePostRefresh: LegacyTwoEnergyCompactionFixturePhase;
  readonly cleanup: {
    readonly observedWrapperCount: number;
    readonly observedCardCount: number;
    readonly sinkConnected: boolean;
  };
}

export interface LegacyRuntimeTwoEnergyCompactionFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly cases: readonly LegacyTwoEnergyCompactionFixtureCase[];
  readonly sourceFulfillment: {
    readonly servedPaths: readonly string[];
    readonly blockedExternalOrigins: readonly string[];
    readonly missingSameOriginPaths: readonly string[];
  };
}

const rotationDegrees = (transform: {
  readonly a: number;
  readonly b: number;
}): number =>
  ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) % 360;

/**
 * Captures two-Energy attachment compaction through v1's actual Card,
 * moveCardBundle, moveCard, attachment-layer, discard, and refresh modules.
 */
export const captureLegacyRuntimeTwoEnergyCompactionFixture = async (
  page: Page,
  options: { readonly retainStablePaint?: boolean } = {}
): Promise<LegacyRuntimeTwoEnergyCompactionFixture> => {
  const loaded = await loadLegacyRuntime(page);
  const layout = await captureLegacyRuntimeLayout(page);
  const frames = layout.frames;
  const frameTransforms = Object.fromEntries(
    Object.entries(layout.frameTransforms).map(([side, transform]) => [
      side,
      { ...transform, rotationDegrees: rotationDegrees(transform) },
    ])
  ) as Readonly<Record<LegacyFixtureSide, LegacyFrameTransform>>;
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
  const cases: LegacyTwoEnergyCompactionFixtureCase[] = [];

  for (const side of ['local', 'opponent'] as const) {
    for (const branch of ['inner', 'outer'] as const) {
      const prefix = `${side}-${branch}`;
      const idsByRole = {
        base: `${prefix}-base`,
        energy1: `${prefix}-energy-1`,
        energy2: `${prefix}-energy-2`,
      };
      const idForRole = (role: string): string =>
        idsByRole[role as keyof typeof idsByRole] ?? role;
      const stackId = `${prefix}-two-energy-stack`;
      const runtime = await captureAttachmentDeparture(page, {
        side,
        slot: 'active',
        departure: branch,
        attachmentOrder: ['energy1', 'energy2'],
        cardIdsByRole: idsByRole,
        stackId,
      });
      const convertPhase = (
        phase: DepartureSample
      ): LegacyTwoEnergyCompactionFixturePhase => ({
        cards: phase.cards.map((card) => ({
          id: card.id,
          side,
          role: card.role as 'base' | 'energy1' | 'energy2',
          physicalBounds: physicalBounds(side, card.frameLocalBounds),
          frameLocalBounds: card.frameLocalBounds,
          naturalWidth: card.naturalWidth,
          naturalHeight: card.naturalHeight,
          clientWidth: card.clientWidth,
          clientHeight: card.clientHeight,
          localRotationDegrees: card.localRotationDegrees,
          effectiveRotationDegrees:
            (card.localRotationDegrees +
              frameTransforms[side].rotationDegrees) %
            360,
          zIndex: Number.parseInt(card.zIndex, 10) || 0,
          inlineLeftPx: Number.parseFloat(card.inlineLeft) || 0,
          inlineBottomPx: Number.parseFloat(card.inlineBottom) || 0,
          attached: card.attached,
          target: card.target,
          relativeId:
            card.relativeRole === null ? null : idForRole(card.relativeRole),
          energyLayer: card.energyLayer,
          layer: card.layer,
          domOrdinal: card.domOrdinal,
          logicalOrdinal: phase.stack.logicalOrder.indexOf(card.id),
          sourcePath: card.sourcePath,
        })),
        stack: {
          ...phase.stack,
          side,
          physicalBounds: physicalBounds(side, phase.stack.frameLocalBounds),
        },
        observedWrapperCount: phase.observedWrapperCount,
        supersededWrapperConnected: phase.supersededWrapperConnected,
      });
      const removedRole = branch === 'inner' ? 'energy1' : 'energy2';
      const remainingRole = branch === 'inner' ? 'energy2' : 'energy1';
      const removed = runtime.removedCardAfterDeparture;
      cases.push({
        id: `${prefix}-departure`,
        side,
        branch,
        removedCardId: idsByRole[removedRole],
        remainingCardId: idsByRole[remainingRole],
        removedCardAfterDeparture: {
          id: removed.id,
          side,
          role: removed.role as 'energy1' | 'energy2',
          naturalWidth: removed.naturalWidth,
          naturalHeight: removed.naturalHeight,
          localRotationDegrees: removed.localRotationDegrees,
          effectiveRotationDegrees:
            (removed.localRotationDegrees +
              frameTransforms[side].rotationDegrees) %
            360,
          zIndex: Number.parseInt(removed.zIndex, 10) || 0,
          inlineLeftPx: removed.inlineLeftPx,
          inlineBottomPx: removed.inlineBottomPx,
          attached: removed.attached,
          target: removed.target,
          relativeId:
            removed.relativeRole === null
              ? null
              : idForRole(removed.relativeRole),
          energyLayer: removed.energyLayer,
          layer: removed.layer,
          sourcePath: removed.sourcePath,
          sinkConnected: removed.sinkConnected,
          parentIsDepartureSink: removed.parentIsDepartureSink,
        },
        stablePreDeparture: convertPhase(runtime.stablePreDeparture),
        transientPostDeparture: convertPhase(runtime.transientPostDeparture),
        synchronousPostRefresh: convertPhase(runtime.synchronousPostRefresh),
        stablePostRefresh: convertPhase(runtime.stablePostRefresh),
        cleanup: runtime.cleanup,
      });
    }
  }

  if (options.retainStablePaint) {
    for (const side of ['local', 'opponent'] as const) {
      const prefix = `${side}-inner`;
      await captureReflow(page, {
        side,
        slot: 'active',
        evolutionOrder: ['base'],
        attachmentOrder: ['energy1', 'energy2'],
        cardIdsByRole: {
          base: `${prefix}-base`,
          energy1: `${prefix}-energy-1`,
          energy2: `${prefix}-energy-2`,
        },
        stackId: `${prefix}-two-energy-stack`,
        preserveOtherSide: side === 'opponent',
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
