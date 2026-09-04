import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

export const LEGACY_SOURCE_ORIGIN = 'http://ptcgsim-legacy.test';

export type CapturedRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type CapturedPoint = { readonly x: number; readonly y: number };

export interface LegacyFixtureCleanup {
  readonly observedWrapperCount: number;
  readonly observedCardCount: number;
  readonly sinkConnected: boolean;
}

export type LegacyRegionKind =
  | 'hand'
  | 'bench'
  | 'active'
  | 'prizes'
  | 'lostZone'
  | 'deck'
  | 'discard'
  | 'board';

export type LegacySide = 'local' | 'opponent';

export interface LegacySourceGeometry {
  readonly playAreaBounds: CapturedRect;
  readonly shellGapBounds: CapturedRect;
  readonly sidebarBounds: CapturedRect;
  readonly tabsBounds: CapturedRect;
  readonly frames: Readonly<Record<LegacySide, CapturedRect>>;
  readonly stadiumBounds: CapturedRect;
  readonly boardControlsBounds: CapturedRect;
  readonly resizeHandles: {
    readonly lower: CapturedRect;
    readonly upper: CapturedRect;
  };
  readonly regions: Readonly<
    Record<LegacySide, Readonly<Record<LegacyRegionKind, CapturedRect>>>
  >;
  readonly opponentFrameTransform: {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
  };
  readonly sourceFulfillment: {
    readonly servedPaths: readonly string[];
    readonly blockedExternalOrigins: readonly string[];
    readonly unexpectedSameOriginPaths: readonly string[];
  };
}

export type LegacyMarkerKind = 'damage' | 'specialCondition' | 'ability';

export interface LegacyMarkerRotationCard {
  readonly id: string;
  readonly frameLocalBounds: CapturedRect;
  readonly untransformedFrameLocalBounds: CapturedRect;
  readonly physicalBounds: CapturedRect;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly inlineTransform: string;
  readonly zIndex: number;
  readonly pokemonBreak: boolean;
  readonly domOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyMarkerRotationMarker {
  readonly id: string;
  readonly kind: LegacyMarkerKind;
  readonly frameLocalBounds: CapturedRect;
  readonly physicalBounds: CapturedRect;
  readonly className: string;
  readonly parentZoneId: string;
  readonly domOrdinal: number;
  readonly textContent: string;
  readonly contentEditable: string;
  readonly pointerEvents: string;
  readonly display: string;
  readonly inlineDisplay: string;
  readonly inlineLeftPx: number | null;
  readonly inlineTopPx: number | null;
  readonly inlineRightPx: number | null;
  readonly inlineBottomPx: number | null;
  readonly inlineWidthPx: number;
  readonly inlineHeightPx: number;
  readonly inlineLineHeightPx: number;
  readonly inlineFontSizePx: number | null;
  readonly zIndex: number;
  readonly backgroundColor: string;
  readonly color: string;
  readonly borderRadius: string;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly hitOrder: readonly string[];
}

export interface LegacyMarkerRotationPhase {
  readonly name: 'marked-q0' | 'q1' | 'q2' | 'q3' | 'q0-return';
  readonly card: LegacyMarkerRotationCard;
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
  readonly markers: readonly LegacyMarkerRotationMarker[];
  readonly cardOnlyHitOrder: readonly string[];
}

export interface LegacyMarkerRotationCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly initialCard: LegacyMarkerRotationCard;
  readonly initialWrapperMargins: {
    readonly inlineRight: string;
    readonly inlineLeft: string;
    readonly computedRightPx: number;
    readonly computedLeftPx: number;
  };
  readonly paletteTrace: readonly {
    readonly input: string;
    readonly textContent: string;
    readonly backgroundColor: string;
    readonly color: string;
  }[];
  readonly phases: readonly LegacyMarkerRotationPhase[];
  readonly callTrace: readonly string[];
  readonly cleanup: {
    readonly markerCount: number;
    readonly cardDamageCounterIsNull: boolean;
    readonly cardSpecialConditionIsNull: boolean;
    readonly cardAbilityCounterIsNull: boolean;
    readonly liveResizeCallsBeforeDispatch: number;
    readonly liveResizeCallsAfterDispatch: number;
    readonly liveMarkerCountAfterDispatch: number;
    readonly resizeCallsBeforeCleanupDispatch: number;
    readonly resizeCallsAfterCleanupDispatch: number;
    readonly wrapperCountAfterTwoFrames: number;
    readonly cardCountAfterTwoFrames: number;
  };
}

export interface LegacySourceMarkerRotationFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly cases: readonly LegacyMarkerRotationCase[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export type LegacyBenchMarkerKind = 'damage' | 'ability';

export type LegacyBenchMarkerRotationCard = LegacyMarkerRotationCard;

export interface LegacyBenchMarkerRotationMarker extends Omit<
  LegacyMarkerRotationMarker,
  'kind'
> {
  readonly kind: LegacyBenchMarkerKind;
}

export interface LegacyBenchMarkerRotationPhase {
  readonly name: 'marked-q0' | 'q1' | 'q2' | 'q3' | 'q0-return';
  readonly card: LegacyBenchMarkerRotationCard;
  readonly wrapper: LegacyMarkerRotationPhase['wrapper'];
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
  readonly callTrace: readonly string[];
  readonly nativeBenchResizeObserver: {
    readonly callbacksAfterInitialSettle: number;
    readonly damageRefreshesAfterInitialSettle: number;
    readonly abilityRefreshesAfterInitialSettle: number;
    readonly callbacksBeforeCleanup: number;
    readonly callbacksAfterCleanup: number;
    readonly damageRefreshesAfterCleanup: number;
    readonly abilityRefreshesAfterCleanup: number;
    readonly sourceObserverStillLiveBeforeHarnessDisconnect: boolean;
    readonly harnessDisconnectCalls: number;
  };
  readonly cleanup: {
    readonly markerCount: number;
    readonly specialConditionMarkerCount: number;
    readonly cardDamageCounterIsNull: boolean;
    readonly cardAbilityCounterIsNull: boolean;
    readonly liveResizeCallsBeforeDispatch: number;
    readonly liveResizeCallsAfterDispatch: number;
    readonly liveMarkerCountAfterDispatch: number;
    readonly resizeCallsBeforeCleanupDispatch: number;
    readonly resizeCallsAfterCleanupDispatch: number;
    readonly wrapperCountAfterTwoFrames: number;
    readonly cardCountAfterTwoFrames: number;
    readonly benchZIndexAfterCleanup: number;
  };
}

export interface LegacySourceBenchMarkerRotationFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly cases: readonly LegacyBenchMarkerRotationCase[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export type LegacyFixtureSide = LegacySide;

export interface LegacyCardFixtureCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role:
    'hand' | 'bench' | 'stackBase' | 'stackPokemonLayer' | 'stackEnergyLayer';
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly parentStackId: string | null;
  readonly domOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyCardFixtureStack {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly baseClientWidth: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly energyContainerClientWidthsBefore: readonly number[];
  readonly energyAuthoredWidthsPx: readonly number[];
  readonly childDomOrder: readonly string[];
  readonly hitOrder: {
    readonly baseOverlap: readonly string[];
    readonly verticalOverlap: readonly string[];
    readonly outermostVertical: readonly string[];
    readonly horizontalOverlap: readonly string[];
    readonly outermostHorizontal: readonly string[];
  };
}

export interface LegacyFrameTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly rotationDegrees: number;
}

export interface LegacySourceCardFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly frameRotationDegrees: Readonly<Record<LegacyFixtureSide, number>>;
  readonly cards: readonly LegacyCardFixtureCard[];
  readonly stacks: readonly LegacyCardFixtureStack[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export interface LegacyEnergyAttachmentFixtureCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: 'base' | 'energy';
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
  readonly sourcePath: string;
}

export interface LegacyEnergyAttachmentFixtureStack {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly baseClientWidth: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly attachmentClientWidthsBefore: readonly number[];
  readonly attachmentAuthoredWidthsPx: readonly number[];
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly transientPostAttach: {
    readonly logicalOrder: readonly string[];
    readonly domOrder: readonly string[];
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
  };
  readonly synchronousPostRefreshContainerCount: number;
  readonly oldContainerConnectedImmediatelyAfterRefresh: boolean;
  readonly stableContainerCount: number;
  readonly oldContainerConnected: boolean;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
  readonly hitOrder: {
    readonly commonOverlap: readonly string[];
    readonly energyOnly: readonly string[];
  };
}

export interface LegacySourceEnergyAttachmentReflowFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly cards: readonly LegacyEnergyAttachmentFixtureCard[];
  readonly stacks: readonly LegacyEnergyAttachmentFixtureStack[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export type LegacyTwoEnergyDepartureBranch = 'inner' | 'outer';

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
  readonly hitOrder: {
    readonly allCardOverlap: readonly string[];
    readonly attachmentOverlap: readonly string[];
    readonly outermostAttachment: readonly string[];
    readonly baseOnly: readonly string[];
  };
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

export interface LegacySourceTwoEnergyCompactionFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly cases: readonly LegacyTwoEnergyCompactionFixtureCase[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export type LegacyMixedAttachmentRole = 'base' | 'energy' | 'trainerTool';
export type LegacyMixedAttachmentOrder =
  'energyThenTrainer' | 'trainerThenEnergy';
export type LegacyMixedAttachmentDeparture = 'energy' | 'trainerTool';

export interface LegacyMixedAttachmentFixtureCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: LegacyMixedAttachmentRole;
  readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly untransformedPhysicalBounds: CapturedRect;
  readonly untransformedFrameLocalBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly computedWidthPx: number;
  readonly computedHeightPx: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly transformMatrix: {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
  };
  readonly transformOrigin: string;
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

export interface LegacyMixedAttachmentFixtureStack {
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
  readonly hitPointsFrameLocal: Readonly<Record<string, CapturedPoint>>;
  readonly hitPointsPhysical: Readonly<Record<string, CapturedPoint>>;
}

export interface LegacyMixedAttachmentFixturePhase {
  readonly cards: readonly LegacyMixedAttachmentFixtureCard[];
  readonly stack: LegacyMixedAttachmentFixtureStack;
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
}

export interface LegacyMixedAttachmentAttachTraceEntry {
  readonly role: 'energy' | 'trainerTool';
  readonly clientWidthBefore: number;
  readonly authoredWidthAfterPx: number;
  readonly inlineLeftPx: number;
  readonly zIndex: number;
}

export interface LegacyMixedAttachmentOrderFixtureCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly order: LegacyMixedAttachmentOrder;
  readonly postFirstAttachment: LegacyMixedAttachmentFixturePhase;
  readonly immediatePostSecondAttachment: LegacyMixedAttachmentFixturePhase;
  readonly synchronousPostRefresh: LegacyMixedAttachmentFixturePhase;
  readonly stablePostRefresh: LegacyMixedAttachmentFixturePhase;
  readonly immediateAttachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly refreshAttachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

export interface LegacyMixedAttachmentRemovedCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: 'energy' | 'trainerTool';
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly sourcePath: string;
  readonly sinkConnected: boolean;
  readonly parentIsDepartureSink: boolean;
}

export interface LegacyMixedAttachmentDepartureFixtureCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly removedRole: LegacyMixedAttachmentDeparture;
  readonly stablePreDeparture: LegacyMixedAttachmentFixturePhase;
  readonly removedCardAfterDeparture: LegacyMixedAttachmentRemovedCard;
  readonly transientPostDeparture: LegacyMixedAttachmentFixturePhase;
  readonly synchronousPostRefresh: LegacyMixedAttachmentFixturePhase;
  readonly stablePostRefresh: LegacyMixedAttachmentFixturePhase;
  readonly cleanup: LegacyFixtureCleanup;
}

export type LegacyMixedStagedRole =
  | 'base'
  | 'energyOne'
  | 'energyTwo'
  | 'trainerToolOne'
  | 'trainerToolTwo'
  | 'deckTopTrainerTool'
  | 'deckRemainderEnergy';

export type LegacyMixedRestoreScenario = 'reverseTwo' | 'interleavedFour';

export interface LegacyMixedSwapResetTraceEntry {
  readonly phase: 'selectedToDeck' | 'deckRotation' | 'priorTopToStaging';
  readonly cardId: string;
}

export interface LegacyMixedStagedCardState {
  readonly id: string;
  readonly role: LegacyMixedStagedRole;
  readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
  readonly parentZone: 'attachedCards' | 'deck';
  readonly logicalOrdinal: number;
  readonly domOrdinal: number;
  readonly localRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly sourcePath: string;
}

export interface LegacyMixedStagedPhase {
  readonly cards: readonly LegacyMixedStagedCardState[];
  readonly logicalOrder: readonly string[];
  readonly domOrder: readonly string[];
  readonly display: string;
}

export interface LegacyMixedDeckPhase {
  readonly cards: readonly LegacyMixedStagedCardState[];
  readonly logicalOrder: readonly string[];
  readonly domOrder: readonly string[];
}

export interface LegacyMixedRestoredCard {
  readonly id: string;
  readonly role: LegacyMixedStagedRole;
  readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly untransformedPhysicalBounds: CapturedRect;
  readonly untransformedFrameLocalBounds: CapturedRect;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly domOrdinal: number;
  readonly logicalOrdinal: number;
}

export interface LegacyMixedRestoredPhase {
  readonly cards: readonly LegacyMixedRestoredCard[];
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
  readonly stagingDisplay: string;
  readonly stack: {
    readonly id: string;
    readonly side: LegacyFixtureSide;
    readonly physicalBounds: CapturedRect;
    readonly frameLocalBounds: CapturedRect;
    readonly baseClientWidth: number;
    readonly baseEnergyLayer: number;
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly inlineMarginRight: string;
    readonly computedMarginRightPx: number;
    readonly childDomOrder: readonly string[];
    readonly logicalOrder: readonly string[];
    readonly hitOrder: Readonly<Record<string, readonly string[]>>;
    readonly hitPointsFrameLocal: Readonly<Record<string, CapturedPoint>>;
    readonly hitPointsPhysical: Readonly<Record<string, CapturedPoint>>;
  };
}

export interface LegacyMixedRestoreFixtureCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly scenario: LegacyMixedRestoreScenario;
  readonly stagedBeforeRestore: LegacyMixedStagedPhase;
  readonly immediatePostRestore: LegacyMixedRestoredPhase;
  readonly settledPostRestore: LegacyMixedRestoredPhase;
  readonly attachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

export interface LegacyMixedStagedSwapFixtureCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly selectedCardId: string;
  readonly priorDeckTopCardId: string;
  readonly stagedBeforeSwap: LegacyMixedStagedPhase;
  readonly deckBeforeSwap: LegacyMixedDeckPhase;
  readonly stagedAfterSelectedDeparture: LegacyMixedStagedPhase;
  readonly deckAfterSelectedDeparture: LegacyMixedDeckPhase;
  readonly deckAfterRotation: LegacyMixedDeckPhase;
  readonly stagedAfterSwap: LegacyMixedStagedPhase;
  readonly deckAfterSwap: LegacyMixedDeckPhase;
  readonly resetTrace: readonly LegacyMixedSwapResetTraceEntry[];
  readonly immediatePostRestore: LegacyMixedRestoredPhase;
  readonly settledPostRestore: LegacyMixedRestoredPhase;
  readonly attachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

export interface LegacySourceMixedAttachmentOrderFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly attachmentCases: readonly LegacyMixedAttachmentOrderFixtureCase[];
  readonly departureCases: readonly LegacyMixedAttachmentDepartureFixtureCase[];
  readonly restoreCases: readonly LegacyMixedRestoreFixtureCase[];
  readonly stagedSwapCases: readonly LegacyMixedStagedSwapFixtureCase[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export type LegacyMixedStackMovementScenario =
  'nativeCanonical' | 'reverseRoundTrip' | 'categoryCycle';

export type LegacyMixedStackMovementRole =
  LegacyMixedAttachmentRole | 'controlBase';

export interface LegacyMixedStackMovementCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: LegacyMixedStackMovementRole;
  readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
  readonly originalCategory: 'Pokémon' | 'Energy' | 'Trainer' | null;
  readonly parentZone: 'active' | 'bench' | 'board';
  readonly parentStackId: string | null;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly untransformedPhysicalBounds: CapturedRect;
  readonly untransformedFrameLocalBounds: CapturedRect;
  readonly clientWidth: number;
  readonly clientHeight: number;
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
  readonly logicalOrdinal: number;
  readonly domOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyMixedStackMovementPhase {
  readonly name: string;
  readonly mixedZone: 'active' | 'bench';
  readonly cards: readonly LegacyMixedStackMovementCard[];
  readonly zoneLogicalOrder: {
    readonly active: readonly string[];
    readonly bench: readonly string[];
    readonly board: readonly string[];
  };
  readonly zoneDirectDomOrder: {
    readonly active: readonly string[];
    readonly bench: readonly string[];
  };
  readonly wrapperCounts: { readonly active: number; readonly bench: number };
  readonly connectedWrapperIds: readonly string[];
  readonly stack: {
    readonly id: string;
    readonly side: LegacyFixtureSide;
    readonly physicalBounds: CapturedRect;
    readonly frameLocalBounds: CapturedRect;
    readonly baseClientWidth: number;
    readonly baseEnergyLayer: number;
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly inlineMarginRight: string;
    readonly computedMarginRightPx: number;
    readonly childDomOrder: readonly string[];
    readonly logicalOrder: readonly string[];
    readonly hitOrder: Readonly<Record<string, readonly string[]>>;
    readonly hitPointsFrameLocal: Readonly<Record<string, CapturedPoint>>;
    readonly hitPointsPhysical: Readonly<Record<string, CapturedPoint>>;
  };
}

export interface LegacyMixedStackMovementTraceEntry {
  readonly functionName:
    | 'changeType'
    | 'moveCardBundle'
    | 'moveCard'
    | 'autoMoveActiveBenchCard'
    | 'relocateAttachedCards'
    | 'attachCard'
    | 'refreshBoard';
  readonly cardId: string | null;
  readonly origin: string | null;
  readonly destination: string | null;
  readonly targetCardId: string | null;
  readonly detail: string;
}

export interface LegacyMixedStackResetTraceEntry {
  readonly cardId: string;
  readonly reason: string;
  readonly parentZoneBefore: string | null;
}

export interface LegacyMixedStackMovementCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly scenario: LegacyMixedStackMovementScenario;
  readonly phases: readonly LegacyMixedStackMovementPhase[];
  readonly callTrace: readonly LegacyMixedStackMovementTraceEntry[];
  readonly resetTrace: readonly LegacyMixedStackResetTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

export interface LegacySourceMixedStackMovementFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly cases: readonly LegacyMixedStackMovementCase[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export interface LegacyTrainerToolAttachmentFixtureCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: 'base' | 'tool';
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly untransformedPhysicalBounds: CapturedRect;
  readonly untransformedFrameLocalBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly computedWidthPx: number;
  readonly computedHeightPx: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly transformMatrix: {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
  };
  readonly transformOrigin: string;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly domOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyTrainerToolAttachmentFixtureStack {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly baseClientWidth: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly attachmentClientWidthsBefore: readonly number[];
  readonly attachmentAuthoredWidthsPx: readonly number[];
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly transientPostAttach: {
    readonly logicalOrder: readonly string[];
    readonly domOrder: readonly string[];
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly inlineMarginRight: string;
    readonly computedMarginRightPx: number;
  };
  readonly synchronousPostRefreshContainerCount: number;
  readonly oldContainerConnectedImmediatelyAfterRefresh: boolean;
  readonly stableContainerCount: number;
  readonly oldContainerConnected: boolean;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
  readonly hitOrder: {
    readonly commonOverlap: readonly string[];
    readonly toolOnly: readonly string[];
    readonly baseOnly: readonly string[];
    readonly authoredLayoutOnly: readonly string[];
  };
  readonly hitPointsFrameLocal: {
    readonly commonOverlap: { readonly x: number; readonly y: number };
    readonly toolOnly: { readonly x: number; readonly y: number };
    readonly baseOnly: { readonly x: number; readonly y: number };
    readonly authoredLayoutOnly: { readonly x: number; readonly y: number };
  };
}

export interface LegacySourceTrainerToolAttachmentReflowFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly cards: readonly LegacyTrainerToolAttachmentFixtureCard[];
  readonly stacks: readonly LegacyTrainerToolAttachmentFixtureStack[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export type LegacyContainedCardKind =
  'deck' | 'discard' | 'lostZone' | 'stadium';

export interface LegacyContainedCardFixtureCard {
  readonly id: string;
  readonly kind: LegacyContainedCardKind;
  readonly side: LegacyFixtureSide | 'shared';
  readonly readableBy: LegacyFixtureSide;
  readonly physicalBounds: CapturedRect;
  readonly containerBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly enclosingRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly objectFit: string;
  readonly maxWidth: string;
  readonly maxHeight: string;
  readonly sourcePath: string;
}

export interface LegacySourceContainedCardFixture {
  readonly cards: readonly LegacyContainedCardFixtureCard[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export type LegacyEvolutionCardRole = 'topEvolution' | 'lowerEvolution';

export interface LegacyEvolutionFixtureStageCard {
  readonly id: string;
  readonly frameLocalBounds: CapturedRect;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly localRotationDegrees: number;
  readonly zIndex: number;
  readonly layer: number;
  readonly energyLayer: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly position: string;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly domOrdinal: number;
  readonly logicalOrdinal: number;
}

export interface LegacyEvolutionFixtureCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: LegacyEvolutionCardRole;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly layer: number;
  readonly energyLayer: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly position: string;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly domOrdinal: number;
  readonly logicalOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyEvolutionFixtureStage {
  readonly logicalOrder: readonly string[];
  readonly domOrder: readonly string[];
  readonly containerFrameLocalBounds: CapturedRect;
  readonly containerClientWidth: number;
  readonly computedWidthPx: number;
  readonly authoredWidthPx: number | null;
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly cards: readonly LegacyEvolutionFixtureStageCard[];
}

export interface LegacyEvolutionFixtureStack {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly topClientWidth: number;
  readonly topLayer: number;
  readonly preEvolution: LegacyEvolutionFixtureStage;
  readonly transientResetClientWidth: number;
  readonly transientResetAuthoredWidthPx: number;
  readonly transientPostEvolution: LegacyEvolutionFixtureStage;
  readonly stablePostRefresh: LegacyEvolutionFixtureStage;
  readonly synchronousPostRefreshContainerCount: number;
  readonly oldContainerConnectedImmediatelyAfterRefresh: boolean;
  readonly stableContainerCount: number;
  readonly oldContainerConnected: boolean;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
  readonly hitOrder: {
    readonly commonOverlap: readonly string[];
    readonly middleAndBaseOverlap: readonly string[];
    readonly outermostBase: readonly string[];
  };
}

export interface LegacySourceEvolutionReflowFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly cards: readonly LegacyEvolutionFixtureCard[];
  readonly stacks: readonly LegacyEvolutionFixtureStack[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export type LegacyCompoundRotationScenario =
  | 'ordinaryGroup'
  | 'breakGroup'
  | 'ordinaryGroupFromMiddle'
  | 'ordinaryGroupFromBase'
  | 'breakGroupFromMiddle'
  | 'breakGroupFromBase'
  | 'ordinaryMiddleSingleAtGroupQ0'
  | 'ordinaryBaseSingleAtGroupQ0'
  | 'breakMiddleSingleAtGroupQ0'
  | 'breakBaseSingleAtGroupQ0'
  | 'ordinaryReturnedFromTopMiddleSingle'
  | 'ordinaryReturnedFromTopBaseSingle'
  | 'ordinaryReturnedFromMiddleMiddleSingle'
  | 'ordinaryReturnedFromMiddleBaseSingle'
  | 'ordinaryReturnedFromBaseMiddleSingle'
  | 'ordinaryReturnedFromBaseBaseSingle'
  | 'breakReturnedFromTopMiddleSingle'
  | 'breakReturnedFromTopBaseSingle'
  | 'breakReturnedFromMiddleMiddleSingle'
  | 'breakReturnedFromMiddleBaseSingle'
  | 'breakReturnedFromBaseMiddleSingle'
  | 'breakReturnedFromBaseBaseSingle'
  | 'ordinaryMiddleThirdSingleAtHistoryQ0'
  | 'ordinaryBaseThirdSingleAtHistoryQ0'
  | 'breakMiddleThirdSingleAtHistoryQ0'
  | 'breakBaseThirdSingleAtHistoryQ0'
  | 'ordinaryMiddleSingleAtGroupQ1'
  | 'ordinaryMiddleSingleAtGroupQ2'
  | 'ordinaryMiddleSingleAtGroupQ3'
  | 'ordinaryBaseSingleAtGroupQ1'
  | 'ordinaryBaseSingleAtGroupQ2'
  | 'ordinaryBaseSingleAtGroupQ3'
  | 'breakMiddleSingleAtGroupQ1'
  | 'breakMiddleSingleAtGroupQ2'
  | 'breakMiddleSingleAtGroupQ3'
  | 'breakBaseSingleAtGroupQ1'
  | 'breakBaseSingleAtGroupQ2'
  | 'breakBaseSingleAtGroupQ3'
  | 'ordinaryMiddleFollowupSingleAfterGroupQ1'
  | 'ordinaryMiddleFollowupSingleAfterGroupQ2'
  | 'ordinaryMiddleFollowupSingleAfterGroupQ3'
  | 'ordinaryBaseFollowupSingleAfterGroupQ1'
  | 'ordinaryBaseFollowupSingleAfterGroupQ2'
  | 'ordinaryBaseFollowupSingleAfterGroupQ3'
  | 'breakMiddleFollowupSingleAfterGroupQ1'
  | 'breakMiddleFollowupSingleAfterGroupQ2'
  | 'breakMiddleFollowupSingleAfterGroupQ3'
  | 'breakBaseFollowupSingleAfterGroupQ1'
  | 'breakBaseFollowupSingleAfterGroupQ2'
  | 'breakBaseFollowupSingleAfterGroupQ3'
  | 'ordinaryTopGroupAfterMiddleSingleAtGroupQ1'
  | 'ordinaryTopGroupAfterMiddleSingleAtGroupQ2'
  | 'ordinaryTopGroupAfterMiddleSingleAtGroupQ3'
  | 'ordinaryTopGroupAfterBaseSingleAtGroupQ1'
  | 'ordinaryTopGroupAfterBaseSingleAtGroupQ2'
  | 'ordinaryTopGroupAfterBaseSingleAtGroupQ3'
  | 'breakTopGroupAfterMiddleSingleAtGroupQ1'
  | 'breakTopGroupAfterMiddleSingleAtGroupQ2'
  | 'breakTopGroupAfterMiddleSingleAtGroupQ3'
  | 'breakTopGroupAfterBaseSingleAtGroupQ1'
  | 'breakTopGroupAfterBaseSingleAtGroupQ2'
  | 'breakTopGroupAfterBaseSingleAtGroupQ3'
  | 'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ1'
  | 'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ2'
  | 'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ3'
  | 'ordinaryBaseGroupAfterBaseSingleAtGroupQ1'
  | 'ordinaryBaseGroupAfterBaseSingleAtGroupQ2'
  | 'ordinaryBaseGroupAfterBaseSingleAtGroupQ3'
  | 'breakMiddleGroupAfterMiddleSingleAtGroupQ1'
  | 'breakMiddleGroupAfterMiddleSingleAtGroupQ2'
  | 'breakMiddleGroupAfterMiddleSingleAtGroupQ3'
  | 'breakBaseGroupAfterBaseSingleAtGroupQ1'
  | 'breakBaseGroupAfterBaseSingleAtGroupQ2'
  | 'breakBaseGroupAfterBaseSingleAtGroupQ3'
  | 'ordinaryBaseGroupAfterMiddleSingleAtGroupQ1'
  | 'ordinaryBaseGroupAfterMiddleSingleAtGroupQ2'
  | 'ordinaryBaseGroupAfterMiddleSingleAtGroupQ3'
  | 'ordinaryMiddleGroupAfterBaseSingleAtGroupQ1'
  | 'ordinaryMiddleGroupAfterBaseSingleAtGroupQ2'
  | 'ordinaryMiddleGroupAfterBaseSingleAtGroupQ3'
  | 'breakBaseGroupAfterMiddleSingleAtGroupQ1'
  | 'breakBaseGroupAfterMiddleSingleAtGroupQ2'
  | 'breakBaseGroupAfterMiddleSingleAtGroupQ3'
  | 'breakMiddleGroupAfterBaseSingleAtGroupQ1'
  | 'breakMiddleGroupAfterBaseSingleAtGroupQ2'
  | 'breakMiddleGroupAfterBaseSingleAtGroupQ3'
  | 'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ1'
  | 'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ2'
  | 'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ3'
  | 'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ1'
  | 'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ2'
  | 'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ3'
  | 'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ1'
  | 'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ2'
  | 'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ3'
  | 'breakBaseSecondGroupAfterBaseSingleAtGroupQ1'
  | 'breakBaseSecondGroupAfterBaseSingleAtGroupQ2'
  | 'breakBaseSecondGroupAfterBaseSingleAtGroupQ3'
  | 'ordinaryRefreshAfterMiddleSingleAtGroupQ1'
  | 'ordinaryRefreshAfterMiddleSingleAtGroupQ2'
  | 'ordinaryRefreshAfterMiddleSingleAtGroupQ3'
  | 'ordinaryRefreshAfterBaseSingleAtGroupQ1'
  | 'ordinaryRefreshAfterBaseSingleAtGroupQ2'
  | 'ordinaryRefreshAfterBaseSingleAtGroupQ3'
  | 'breakRefreshAfterMiddleSingleAtGroupQ1'
  | 'breakRefreshAfterMiddleSingleAtGroupQ2'
  | 'breakRefreshAfterMiddleSingleAtGroupQ3'
  | 'breakRefreshAfterBaseSingleAtGroupQ1'
  | 'breakRefreshAfterBaseSingleAtGroupQ2'
  | 'breakRefreshAfterBaseSingleAtGroupQ3'
  | 'ordinarySingleAtGroupQ1'
  | 'ordinarySingleAtGroupQ2'
  | 'ordinarySingleAtGroupQ3'
  | 'breakSingleAtGroupQ1'
  | 'breakSingleAtGroupQ2'
  | 'breakSingleAtGroupQ3'
  | 'breakRefreshFreshQ0'
  | 'breakRefreshReturnedQ0'
  | 'breakRefreshQ2'
  | 'breakRefreshQ3';

export type LegacyCompoundRotationPhaseName =
  | 'pristine-q0'
  | 'q1'
  | 'q1-refreshed'
  | 'q2'
  | 'q3'
  | 'q0-return'
  | 'break-on-q0'
  | 'break-group-q1'
  | 'break-group-q1-refreshed'
  | 'break-group-q2'
  | 'break-group-q3'
  | 'break-group-q0-return'
  | 'break-off-q0'
  | 'pre-single'
  | 'post-single'
  | 'pre-group-rotation'
  | 'post-group-rotation'
  | 'pre-second-group-rotation'
  | 'post-second-group-rotation'
  | 'pre-refresh'
  | 'synchronous-post-refresh'
  | 'settled-post-refresh';

export interface LegacyCompoundRotationAction {
  readonly selectedCardId: string;
  readonly selectedRole: 'top' | 'middle' | 'base';
  readonly indexBefore: number;
  readonly single: boolean;
}

export interface LegacyCompoundRotationCard {
  readonly id: string;
  readonly role: 'top' | 'middle' | 'base';
  readonly frameLocalBounds: CapturedRect;
  readonly untransformedFrameLocalBounds: CapturedRect;
  readonly physicalBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly inlineTransform: string;
  readonly transformOrigin: string;
  readonly zIndex: number;
  readonly layer: number;
  readonly energyLayer: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly position: string;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly pokemonBreak: boolean;
  readonly imageType: string;
  readonly domOrdinal: number;
  readonly logicalOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyCompoundRotationStack {
  readonly id: string;
  readonly frameLocalBounds: CapturedRect;
  readonly physicalBounds: CapturedRect;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly computedWidthPx: number;
  readonly computedHeightPx: number;
  readonly authoredWidthPx: number | null;
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly transform: string;
  readonly zIndex: number;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
  readonly hitOrder: {
    readonly commonOverlap: readonly string[] | null;
    readonly topOnly: readonly string[] | null;
    readonly middleAndBaseOverlap: readonly string[] | null;
    readonly baseOnly: readonly string[] | null;
    readonly topPaintedOnly: readonly string[] | null;
    readonly topAuthoredOnly: readonly string[] | null;
    readonly middlePaintedOnly: readonly string[] | null;
    readonly middleAuthoredOnly: readonly string[] | null;
    readonly basePaintedOnly: readonly string[] | null;
    readonly baseAuthoredOnly: readonly string[] | null;
  };
  readonly hitPointsFrameLocal: Readonly<
    Record<
      | 'commonOverlap'
      | 'topOnly'
      | 'middleAndBaseOverlap'
      | 'baseOnly'
      | 'topPaintedOnly'
      | 'topAuthoredOnly'
      | 'middlePaintedOnly'
      | 'middleAuthoredOnly'
      | 'basePaintedOnly'
      | 'baseAuthoredOnly',
      CapturedPoint | null
    >
  >;
  readonly hitPointsPhysical: Readonly<
    Record<
      | 'commonOverlap'
      | 'topOnly'
      | 'middleAndBaseOverlap'
      | 'baseOnly'
      | 'topPaintedOnly'
      | 'topAuthoredOnly'
      | 'middlePaintedOnly'
      | 'middleAuthoredOnly'
      | 'basePaintedOnly'
      | 'baseAuthoredOnly',
      CapturedPoint | null
    >
  >;
}

export interface LegacyCompoundRotationPhase {
  readonly name: LegacyCompoundRotationPhaseName;
  readonly action: LegacyCompoundRotationAction | null;
  readonly cards: readonly LegacyCompoundRotationCard[];
  readonly stack: LegacyCompoundRotationStack;
  readonly wrapperCount: number;
}

export interface LegacyCompoundRotationCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly slot: 'active' | 'bench';
  readonly scenario: LegacyCompoundRotationScenario;
  readonly phases: readonly LegacyCompoundRotationPhase[];
  readonly callTrace: readonly string[];
  readonly transitionTrace: readonly string[];
  readonly refresh: {
    readonly synchronousWrapperCount: number;
    readonly oldWrapperConnectedImmediately: boolean;
    readonly stableWrapperCount: number;
    readonly oldWrapperConnectedAfterSettle: boolean;
    readonly wrapperIdentityChanged: boolean;
    readonly cardNodeIdentityPreserved: boolean;
  } | null;
  readonly observers: {
    readonly mutationObserversCreated: number;
    readonly resizeObserversCreated: number;
    readonly resizeCallbacksBeforeCardRemoval: number;
    readonly resizeCallbacksAfterCardRemoval: number;
    readonly transcribedSourceDisconnectCalls: number;
    readonly harnessRetainedSourceShapedObserverHandlesBeforeCleanup: boolean;
    readonly harnessMutationDisconnectCalls: number;
    readonly harnessResizeDisconnectCalls: number;
  };
  readonly cleanup: LegacyFixtureCleanup;
}

export interface LegacySourceCompoundRotationFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly ordinaryGroupCases: readonly LegacyCompoundRotationCase[];
  readonly breakGroupCases: readonly LegacyCompoundRotationCase[];
  readonly lowerGroupInitiatorCases: readonly LegacyCompoundRotationCase[];
  readonly lowerQ0SingleCases: readonly LegacyCompoundRotationCase[];
  readonly lowerReturnedQ0SingleCases: readonly LegacyCompoundRotationCase[];
  readonly lowerHistoryAuthoredQ0SingleCases: readonly LegacyCompoundRotationCase[];
  readonly lowerNonzeroGroupSingleCases: readonly LegacyCompoundRotationCase[];
  readonly lowerNonzeroGroupSingleFollowupCases: readonly LegacyCompoundRotationCase[];
  readonly lowerNonzeroGroupRotationAfterSingleCases: readonly LegacyCompoundRotationCase[];
  readonly lowerNonzeroSameLowerGroupAfterSingleCases: readonly LegacyCompoundRotationCase[];
  readonly lowerNonzeroDifferentLowerGroupAfterSingleCases: readonly LegacyCompoundRotationCase[];
  readonly lowerNonzeroSameLowerSecondGroupAfterSingleCases: readonly LegacyCompoundRotationCase[];
  readonly lowerNonzeroGroupRefreshAfterSingleCases: readonly LegacyCompoundRotationCase[];
  readonly nonzeroGroupSingleCases: readonly LegacyCompoundRotationCase[];
  readonly breakRefreshCases: readonly LegacyCompoundRotationCase[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

const sourceResponses = {
  '/': { path: 'client/index.ejs', contentType: 'text/html' },
  '/self-containers.html': {
    path: 'client/self-containers.html',
    contentType: 'text/html',
  },
  '/opp-containers.html': {
    path: 'client/opp-containers.html',
    contentType: 'text/html',
  },
  '/src/css/index.css': {
    path: 'client/src/css/index.css',
    contentType: 'text/css',
  },
  '/src/css/self-containers.css': {
    path: 'client/src/css/self-containers.css',
    contentType: 'text/css',
  },
  '/src/css/opp-containers.css': {
    path: 'client/src/css/opp-containers.css',
    contentType: 'text/css',
  },
  '/src/assets/favicon.ico': {
    path: 'client/src/assets/favicon.ico',
    contentType: 'image/x-icon',
  },
  '/src/assets/cardback.png': {
    path: 'client/src/assets/cardback.png',
    contentType: 'image/png',
  },
  '/src/assets/blank-logo.png': {
    path: 'client/src/assets/blank-logo.png',
    contentType: 'image/png',
  },
} as const;

const requiredSourcePaths = new Set([
  '/',
  '/self-containers.html',
  '/opp-containers.html',
  '/src/css/index.css',
  '/src/css/self-containers.css',
  '/src/css/opp-containers.css',
  '/src/front-end.js',
]);

const readSourceResponses = async (): Promise<
  ReadonlyMap<string, { readonly contentType: string; readonly body: Buffer }>
> => {
  const responses = new Map<
    string,
    { readonly contentType: string; readonly body: Buffer }
  >();
  for (const [requestPath, source] of Object.entries(sourceResponses)) {
    let body = await readFile(`${repositoryRoot}${source.path}`);
    if (requestPath === '/') {
      const templateToken = '<%= importDataJSON %>';
      const rendered = body.toString('utf8');
      if (
        rendered.indexOf(templateToken) < 0 ||
        rendered.indexOf(templateToken) !== rendered.lastIndexOf(templateToken)
      ) {
        throw new Error('Legacy index must contain one import-data EJS token');
      }
      body = Buffer.from(rendered.replace(templateToken, ''), 'utf8');
    }
    responses.set(requestPath, { contentType: source.contentType, body });
  }
  return responses;
};

const requireRect = async (
  target: { boundingBox(): Promise<CapturedRect | null> },
  label: string
): Promise<CapturedRect> => {
  const bounds = await target.boundingBox();
  if (!bounds)
    throw new Error(`Legacy geometry target is not visible: ${label}`);
  return bounds;
};

const unionRects = (left: CapturedRect, right: CapturedRect): CapturedRect => {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
};

const regionSelectors: Readonly<Record<LegacyRegionKind, string>> = {
  hand: '#hand',
  bench: '#bench',
  active: '#active',
  prizes: '#prizes',
  lostZone: '#lostZoneCover',
  deck: '#deckCover',
  discard: '#discardCover',
  board: '#board',
};

interface LoadedLegacySourceBoard {
  readonly servedPaths: Set<string>;
  readonly blockedExternalOrigins: Set<string>;
  readonly unexpectedSameOriginPaths: Set<string>;
}

const sourceFulfillment = (
  loaded: LoadedLegacySourceBoard
): LegacySourceGeometry['sourceFulfillment'] => ({
  servedPaths: [...loaded.servedPaths].sort(),
  blockedExternalOrigins: [...loaded.blockedExternalOrigins].sort(),
  unexpectedSameOriginPaths: [...loaded.unexpectedSameOriginPaths].sort(),
});

const requireServedPaths = (
  loaded: LoadedLegacySourceBoard,
  paths: ReadonlySet<string>
): void => {
  const missing = [...paths].filter((path) => !loaded.servedPaths.has(path));
  if (missing.length > 0) {
    throw new Error(
      `Legacy source requests were not exercised: ${missing.join(', ')}`
    );
  }
};

const requireNoUnexpectedSameOriginPaths = (
  loaded: LoadedLegacySourceBoard
): void => {
  if (loaded.unexpectedSameOriginPaths.size > 0) {
    throw new Error(
      `Unexpected legacy source requests: ${[...loaded.unexpectedSameOriginPaths].sort().join(', ')}`
    );
  }
};

const loadLegacySourceBoard = async (
  page: Page
): Promise<LoadedLegacySourceBoard> => {
  const responses = await readSourceResponses();
  const servedPaths = new Set<string>();
  const blockedExternalOrigins = new Set<string>();
  const unexpectedSameOriginPaths = new Set<string>();

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== LEGACY_SOURCE_ORIGIN) {
      blockedExternalOrigins.add(url.origin);
      await route.abort('blockedbyclient');
      return;
    }
    const response = responses.get(url.pathname);
    if (response) {
      servedPaths.add(url.pathname);
      await route.fulfill({
        status: 200,
        contentType: response.contentType,
        body: response.body,
      });
      return;
    }
    if (url.pathname === '/src/front-end.js') {
      servedPaths.add(url.pathname);
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'export {};',
      });
      return;
    }
    unexpectedSameOriginPaths.add(url.pathname);
    await route.abort('blockedbyclient');
  });

  await page.goto(`${LEGACY_SOURCE_ORIGIN}/`, { waitUntil: 'load' });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('iframe')].every(
      (frame) =>
        frame.contentDocument?.readyState === 'complete' &&
        frame.contentDocument.getElementById('hand') !== null
    )
  );

  const loaded = {
    servedPaths,
    blockedExternalOrigins,
    unexpectedSameOriginPaths,
  };
  requireNoUnexpectedSameOriginPaths(loaded);
  requireServedPaths(loaded, requiredSourcePaths);
  return loaded;
};

/**
 * Loads the checked-in legacy HTML/CSS in a real browser without executing the
 * networked application module. Every same-origin request is allowlisted and
 * every external request is denied, so this capture cannot contact production.
 */
export const captureLegacySourceGeometry = async (
  page: Page
): Promise<LegacySourceGeometry> => {
  const loaded = await loadLegacySourceBoard(page);

  const localFrame = await requireRect(
    page.locator('#selfContainer'),
    '#selfContainer'
  );
  const opponentFrame = await requireRect(
    page.locator('#oppContainer'),
    '#oppContainer'
  );
  const sidebarBounds = await requireRect(page.locator('#p1Box'), '#p1Box');
  const playAreaBounds = unionRects(localFrame, opponentFrame);
  const shellGapBounds: CapturedRect = {
    x: playAreaBounds.x + playAreaBounds.width,
    y: playAreaBounds.y,
    width: sidebarBounds.x - (playAreaBounds.x + playAreaBounds.width),
    height: playAreaBounds.height,
  };

  const captureRegions = async (
    frameSelector: '#selfContainer' | '#oppContainer'
  ): Promise<Record<LegacyRegionKind, CapturedRect>> => {
    const frame = page.frameLocator(frameSelector);
    const entries = await Promise.all(
      Object.entries(regionSelectors).map(async ([kind, selector]) => [
        kind,
        await requireRect(
          frame.locator(selector),
          `${frameSelector} ${selector}`
        ),
      ])
    );
    return Object.fromEntries(entries) as Record<
      LegacyRegionKind,
      CapturedRect
    >;
  };

  const [localRegions, opponentRegions] = await Promise.all([
    captureRegions('#selfContainer'),
    captureRegions('#oppContainer'),
  ]);
  const opponentFrameTransform = await page
    .locator('#oppContainer')
    .evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d };
    });

  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    playAreaBounds,
    shellGapBounds,
    sidebarBounds,
    tabsBounds: await requireRect(
      page.locator('#topButtonContainer'),
      '#topButtonContainer'
    ),
    frames: { local: localFrame, opponent: opponentFrame },
    stadiumBounds: await requireRect(page.locator('#stadium'), '#stadium'),
    boardControlsBounds: await requireRect(
      page.locator('#boardButtonContainer'),
      '#boardButtonContainer'
    ),
    resizeHandles: {
      lower: await requireRect(page.locator('#selfResizer'), '#selfResizer'),
      upper: await requireRect(page.locator('#oppResizer'), '#oppResizer'),
    },
    regions: { local: localRegions, opponent: opponentRegions },
    opponentFrameTransform,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

const cardFixtureAssetPaths = new Set([
  '/src/assets/cardback.png',
  '/src/assets/blank-logo.png',
]);

const containedCardFixtureAssetPaths = new Set(['/src/assets/cardback.png']);

const fixtureCardIds = (side: LegacyFixtureSide) =>
  [
    `${side}-hand-portrait`,
    `${side}-hand-square`,
    `${side}-bench-portrait`,
    `${side}-bench-square`,
    `${side}-active-base`,
    `${side}-active-pokemon-1`,
    `${side}-active-pokemon-2`,
    `${side}-active-energy-1`,
    `${side}-active-energy-2`,
  ] as const;

const captureFrameTransform = async (
  locator: Locator
): Promise<LegacyFrameTransform> =>
  locator.evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    const matrix =
      transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(transform);
    const rotationDegrees =
      ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360;
    return {
      a: matrix.a,
      b: matrix.b,
      c: matrix.c,
      d: matrix.d,
      rotationDegrees,
    };
  });

const captureContainedCard = async (
  locator: Locator,
  container: Locator,
  input: Pick<LegacyContainedCardFixtureCard, 'kind' | 'side' | 'readableBy'>,
  ancestorRotationDegrees = 0
): Promise<LegacyContainedCardFixtureCard> => {
  const [physicalBounds, containerBounds, containerTransform] =
    await Promise.all([
      requireRect(locator, `${input.side} ${input.kind} contained card`),
      requireRect(container, `${input.side} ${input.kind} container`),
      captureFrameTransform(container),
    ]);
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('Legacy contained-card target must be an image');
    }
    const styles = getComputedStyle(element);
    const transform =
      styles.transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(styles.transform);
    return {
      id: element.dataset.legacyContainedCardId ?? '',
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      localRotationDegrees:
        ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) % 360,
      objectFit: styles.objectFit,
      maxWidth: styles.maxWidth,
      maxHeight: styles.maxHeight,
      sourcePath: new URL(element.currentSrc).pathname,
    };
  });
  return {
    ...input,
    ...details,
    physicalBounds,
    containerBounds,
    enclosingRotationDegrees:
      (ancestorRotationDegrees + containerTransform.rotationDegrees) % 360,
    effectiveRotationDegrees:
      (details.localRotationDegrees +
        ancestorRotationDegrees +
        containerTransform.rotationDegrees) %
      360,
  };
};

const captureFixtureCard = async (
  locator: Locator,
  side: LegacyFixtureSide,
  role: LegacyCardFixtureCard['role'],
  frameRotationDegrees: number
): Promise<LegacyCardFixtureCard> => {
  const physicalBounds = await requireRect(locator, `${side} ${role} card`);
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('Legacy card fixture target must be an image');
    }
    const bounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const matrix = new DOMMatrixReadOnly(styles.transform);
    const parentImages = element.parentElement
      ? [...element.parentElement.querySelectorAll(':scope > img')]
      : [];
    return {
      id: element.dataset.legacyCardId ?? '',
      frameLocalBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      localRotationDegrees: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
      zIndex: Number.parseInt(styles.zIndex, 10) || 0,
      inlineLeftPx: Number.parseFloat(element.style.left) || 0,
      inlineBottomPx: Number.parseFloat(element.style.bottom) || 0,
      parentStackId:
        element.closest<HTMLElement>('[data-legacy-stack-id]')?.dataset
          .legacyStackId ?? null,
      domOrdinal: parentImages.indexOf(element),
      sourcePath: new URL(element.currentSrc).pathname,
    };
  });
  const effectiveRotationDegrees =
    (details.localRotationDegrees + frameRotationDegrees + 360) % 360;
  return {
    ...details,
    side,
    role,
    physicalBounds,
    effectiveRotationDegrees,
  };
};

const captureFixtureStack = async (
  locator: Locator,
  side: LegacyFixtureSide
): Promise<LegacyCardFixtureStack> => {
  const physicalBounds = await requireRect(locator, `${side} active stack`);
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('Legacy stack fixture target must be an element');
    }
    const card = (suffix: string) => {
      const match = element.querySelector<HTMLImageElement>(
        `[data-legacy-card-id$="-${suffix}"]`
      );
      if (!match)
        throw new Error(`Missing legacy stack fixture card ${suffix}`);
      return match;
    };
    const base = card('active-base');
    const pokemonOne = card('active-pokemon-1');
    const pokemonTwo = card('active-pokemon-2');
    const energyOne = card('active-energy-1');
    const energyTwo = card('active-energy-2');
    const baseBounds = base.getBoundingClientRect();
    const pokemonOneBounds = pokemonOne.getBoundingClientRect();
    const pokemonTwoBounds = pokemonTwo.getBoundingClientRect();
    const energyOneBounds = energyOne.getBoundingClientRect();
    const energyTwoBounds = energyTwo.getBoundingClientRect();
    const idsAt = (x: number, y: number) =>
      document
        .elementsFromPoint(x, y)
        .flatMap((candidate) =>
          candidate instanceof HTMLImageElement &&
          candidate.dataset.legacyCardId
            ? [candidate.dataset.legacyCardId]
            : []
        );
    const overlapCenter = (
      rectangles: readonly DOMRect[]
    ): { readonly x: number; readonly y: number } => {
      const left = Math.max(...rectangles.map((bounds) => bounds.left));
      const top = Math.max(...rectangles.map((bounds) => bounds.top));
      const right = Math.min(...rectangles.map((bounds) => bounds.right));
      const bottom = Math.min(...rectangles.map((bounds) => bounds.bottom));
      if (left >= right || top >= bottom) {
        throw new Error('Legacy stack fixture cards do not overlap');
      }
      return { x: (left + right) / 2, y: (top + bottom) / 2 };
    };
    const baseOverlap = overlapCenter([
      baseBounds,
      pokemonOneBounds,
      pokemonTwoBounds,
      energyOneBounds,
      energyTwoBounds,
    ]);
    const verticalOverlap = overlapCenter([pokemonOneBounds, pokemonTwoBounds]);
    const horizontalOverlap = overlapCenter([energyOneBounds, energyTwoBounds]);
    const frameLocalBounds = element.getBoundingClientRect();
    return {
      id: element.dataset.legacyStackId ?? '',
      frameLocalBounds: {
        x: frameLocalBounds.x,
        y: frameLocalBounds.y,
        width: frameLocalBounds.width,
        height: frameLocalBounds.height,
      },
      baseClientWidth: base.clientWidth,
      clientWidth: element.clientWidth,
      authoredWidthPx: Number.parseFloat(element.style.width),
      energyContainerClientWidthsBefore: JSON.parse(
        element.dataset.legacyEnergyClientWidthsBefore ?? '[]'
      ) as number[],
      energyAuthoredWidthsPx: JSON.parse(
        element.dataset.legacyEnergyAuthoredWidths ?? '[]'
      ) as number[],
      childDomOrder: [
        ...element.querySelectorAll<HTMLImageElement>(':scope > img'),
      ].map((image) => image.dataset.legacyCardId ?? ''),
      hitOrder: {
        baseOverlap: idsAt(baseOverlap.x, baseOverlap.y),
        verticalOverlap: idsAt(
          verticalOverlap.x,
          Math.min(baseBounds.top - 1, verticalOverlap.y)
        ),
        outermostVertical: idsAt(
          pokemonTwoBounds.left + pokemonTwoBounds.width / 2,
          (pokemonTwoBounds.top + pokemonOneBounds.top) / 2
        ),
        horizontalOverlap: idsAt(
          Math.max(baseBounds.right + 1, horizontalOverlap.x),
          horizontalOverlap.y
        ),
        outermostHorizontal: idsAt(
          (energyOneBounds.right + energyTwoBounds.right) / 2,
          energyTwoBounds.top + energyTwoBounds.height / 2
        ),
      },
    };
  });
  return { ...details, side, physicalBounds };
};

/**
 * Constructs a fixed, source-pinned card fixture inside the inert legacy
 * documents. The DOM and inline styles are a narrow transcription of Card,
 * resetImage, initializeActiveBenchCard and attachCard output; legacy modules
 * are intentionally not executed because they import application/network state.
 */
export const captureLegacySourceCardFixture = async (
  page: Page
): Promise<LegacySourceCardFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (body, input) => {
          const asset = (name: 'cardback.png' | 'blank-logo.png') =>
            `${location.origin}/src/assets/${name}`;
          const resetImageOutput = (image: HTMLImageElement) => {
            image.style.opacity = '1';
            image.style.position = 'relative';
            image.style.bottom = '0%';
            image.style.zIndex = '0';
            image.style.left = '0px';
            image.style.transform = 'rotate(0deg)';
          };
          const makeImage = (
            id: string,
            source: 'cardback.png' | 'blank-logo.png'
          ) => {
            const image = document.createElement('img');
            image.dataset.legacyCardId = id;
            image.alt = '';
            image.src = asset(source);
            resetImageOutput(image);
            return image;
          };
          const makePlayContainer = (id?: string) => {
            const container = document.createElement('div');
            container.className = 'play-container';
            container.style.zIndex = '0';
            if (id) container.dataset.legacyStackId = id;
            return container;
          };
          const hand = body.querySelector('#hand');
          const bench = body.querySelector('#bench');
          const active = body.querySelector('#active');
          if (!hand || !bench || !active) {
            throw new Error('Legacy card fixture regions are missing');
          }

          const ids = input.cardIds;
          const handPortrait = makeImage(ids[0], 'cardback.png');
          const handSquare = makeImage(ids[1], 'blank-logo.png');
          hand.append(handPortrait, handSquare);

          const benchPortraitContainer = makePlayContainer();
          const benchPortrait = makeImage(ids[2], 'cardback.png');
          benchPortraitContainer.append(benchPortrait);
          const benchSquareContainer = makePlayContainer();
          const benchSquare = makeImage(ids[3], 'blank-logo.png');
          benchSquareContainer.append(benchSquare);
          bench.append(benchPortraitContainer, benchSquareContainer);

          const stack = makePlayContainer(`${input.side}-active-stack`);
          const base = makeImage(ids[4], 'cardback.png');
          const pokemonOne = makeImage(ids[5], 'cardback.png');
          const pokemonTwo = makeImage(ids[6], 'cardback.png');
          const energyOne = makeImage(ids[7], 'cardback.png');
          const energyTwo = makeImage(ids[8], 'cardback.png');
          stack.append(base);
          active.append(stack);
          await Promise.all(
            [
              handPortrait,
              handSquare,
              benchPortrait,
              benchSquare,
              base,
              pokemonOne,
              pokemonTwo,
              energyOne,
              energyTwo,
            ].map((image) => image.decode())
          );

          const syncRotationOutput = (image: HTMLImageElement) => {
            const currentRotation =
              Number.parseInt(
                base.style.transform.replace(/[^0-9-]/gu, ''),
                10
              ) || 0;
            image.style.transform = `rotate(${currentRotation}deg)`;
          };
          const attachPokemon = (image: HTMLImageElement, layer: number) => {
            image.style.position = 'absolute';
            image.style.bottom = `${(layer * base.clientWidth) / 15}px`;
            image.style.zIndex = String(-layer);
            base.after(image);
            syncRotationOutput(image);
          };
          const energyContainerClientWidthsBefore: number[] = [];
          const energyAuthoredWidths: number[] = [];
          const attachEnergy = (image: HTMLImageElement, layer: number) => {
            image.style.position = 'absolute';
            const adjustment = base.clientWidth / 6;
            image.style.left = `${layer * adjustment}px`;
            image.style.zIndex = String(-layer);
            energyContainerClientWidthsBefore.push(stack.clientWidth);
            stack.style.width = `${Number.parseFloat(String(stack.clientWidth)) + adjustment}px`;
            energyAuthoredWidths.push(Number.parseFloat(stack.style.width));
            base.after(image);
            syncRotationOutput(image);
          };
          attachPokemon(pokemonOne, 1);
          attachPokemon(pokemonTwo, 2);
          attachEnergy(energyOne, 1);
          attachEnergy(energyTwo, 2);
          stack.dataset.legacyEnergyClientWidthsBefore = JSON.stringify(
            energyContainerClientWidthsBefore
          );
          stack.dataset.legacyEnergyAuthoredWidths =
            JSON.stringify(energyAuthoredWidths);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        },
        { side, cardIds: fixtureCardIds(side) }
      );
  }

  requireServedPaths(loaded, cardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const frameRotationDegrees = {
    local: frameTransforms.local.rotationDegrees,
    opponent: frameTransforms.opponent.rotationDegrees,
  };
  const cards: LegacyCardFixtureCard[] = [];
  const stacks: LegacyCardFixtureStack[] = [];
  const roleBySuffix: Readonly<Record<string, LegacyCardFixtureCard['role']>> =
    {
      'hand-portrait': 'hand',
      'hand-square': 'hand',
      'bench-portrait': 'bench',
      'bench-square': 'bench',
      'active-base': 'stackBase',
      'active-pokemon-1': 'stackPokemonLayer',
      'active-pokemon-2': 'stackPokemonLayer',
      'active-energy-1': 'stackEnergyLayer',
      'active-energy-2': 'stackEnergyLayer',
    };
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const frame = page.frameLocator(frameSelector);
    for (const id of fixtureCardIds(side)) {
      const suffix = id.slice(`${side}-`.length);
      const role = roleBySuffix[suffix];
      if (!role) throw new Error(`Missing fixture role for ${id}`);
      cards.push(
        await captureFixtureCard(
          frame.locator(`[data-legacy-card-id="${id}"]`),
          side,
          role,
          frameRotationDegrees[side]
        )
      );
    }
    stacks.push(
      await captureFixtureStack(
        frame.locator(`[data-legacy-stack-id="${side}-active-stack"]`),
        side
      )
    );
  }

  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames: {
      local: await requireRect(
        page.locator('#selfContainer'),
        '#selfContainer'
      ),
      opponent: await requireRect(
        page.locator('#oppContainer'),
        '#oppContainer'
      ),
    },
    frameTransforms,
    frameRotationDegrees,
    cards,
    stacks,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

const canonicalAttachmentFixtureCardIds = (side: LegacyFixtureSide) =>
  [`${side}-attachment-base`, `${side}-attachment-energy`] as const;

const captureCanonicalAttachmentCard = async (
  locator: Locator,
  side: LegacyFixtureSide,
  role: LegacyEnergyAttachmentFixtureCard['role'],
  frameRotationDegrees: number
): Promise<LegacyEnergyAttachmentFixtureCard> => {
  const physicalBounds = await requireRect(
    locator,
    `${side} canonical ${role} card`
  );
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('Legacy canonical attachment target must be an image');
    }
    const legacyImage = element as HTMLImageElement & {
      attached?: boolean;
      target?: string;
      relative?: unknown;
      energyLayer?: number;
      layer?: number;
    };
    const bounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const transform =
      styles.transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(styles.transform);
    const parentImages = element.parentElement
      ? [...element.parentElement.querySelectorAll(':scope > img')]
      : [];
    return {
      id: element.dataset.legacyCanonicalAttachmentCardId ?? '',
      frameLocalBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      localRotationDegrees:
        ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) % 360,
      zIndex: Number.parseInt(styles.zIndex, 10) || 0,
      inlineLeftPx: Number.parseFloat(element.style.left) || 0,
      inlineBottomPx: Number.parseFloat(element.style.bottom) || 0,
      attached: legacyImage.attached === true,
      target: legacyImage.target ?? '',
      relativeId:
        legacyImage.relative instanceof HTMLImageElement
          ? (legacyImage.relative.dataset.legacyCanonicalAttachmentCardId ??
            null)
          : null,
      energyLayer: legacyImage.energyLayer ?? 0,
      layer: legacyImage.layer ?? 0,
      domOrdinal: parentImages.indexOf(element),
      sourcePath: new URL(element.currentSrc).pathname,
    };
  });
  return {
    ...details,
    side,
    role,
    physicalBounds,
    effectiveRotationDegrees:
      (details.localRotationDegrees + frameRotationDegrees) % 360,
  };
};

const captureCanonicalAttachmentStack = async (
  locator: Locator,
  side: LegacyFixtureSide
): Promise<LegacyEnergyAttachmentFixtureStack> => {
  const physicalBounds = await requireRect(
    locator,
    `${side} canonical attachment stack`
  );
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('Legacy canonical attachment stack must be an element');
    }
    const card = (role: 'base' | 'energy') => {
      const match = element.querySelector<HTMLImageElement>(
        `[data-legacy-canonical-attachment-card-id$="-${role}"]`
      );
      if (!match) throw new Error(`Missing canonical attachment ${role}`);
      return match;
    };
    const base = card('base');
    const energy = card('energy');
    const baseBounds = base.getBoundingClientRect();
    const energyBounds = energy.getBoundingClientRect();
    const idsAt = (x: number, y: number) =>
      document
        .elementsFromPoint(x, y)
        .flatMap((candidate) => {
          const image = candidate.closest<HTMLImageElement>(
            '[data-legacy-canonical-attachment-card-id]'
          );
          return image?.dataset.legacyCanonicalAttachmentCardId
            ? [image.dataset.legacyCanonicalAttachmentCardId]
            : [];
        })
        .filter((id, index, ids) => ids.indexOf(id) === index);
    const intersection = (rectangles: readonly DOMRect[]) => {
      const left = Math.max(...rectangles.map((bounds) => bounds.left));
      const top = Math.max(...rectangles.map((bounds) => bounds.top));
      const right = Math.min(...rectangles.map((bounds) => bounds.right));
      const bottom = Math.min(...rectangles.map((bounds) => bounds.bottom));
      if (right - left <= 2 || bottom - top <= 2) {
        throw new Error('Canonical attachment overlap lacks a safe interior');
      }
      return { left, top, right, bottom };
    };
    const common = intersection([baseBounds, energyBounds]);
    const energyOnlyLeft = baseBounds.right + 2;
    if (energyBounds.right - energyOnlyLeft <= 2) {
      throw new Error('Energy-only strip lacks a safe interior');
    }
    const frameLocalBounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return {
      id: element.dataset.legacyCanonicalAttachmentStackId ?? '',
      frameLocalBounds: {
        x: frameLocalBounds.x,
        y: frameLocalBounds.y,
        width: frameLocalBounds.width,
        height: frameLocalBounds.height,
      },
      baseClientWidth: base.clientWidth,
      clientWidth: element.clientWidth,
      authoredWidthPx: Number.parseFloat(element.style.width),
      attachmentClientWidthsBefore: JSON.parse(
        element.dataset.legacyAttachmentClientWidthsBefore ?? '[]'
      ) as number[],
      attachmentAuthoredWidthsPx: JSON.parse(
        element.dataset.legacyAttachmentAuthoredWidths ?? '[]'
      ) as number[],
      inlineMarginRight: element.style.marginRight,
      inlineMarginLeft: element.style.marginLeft,
      computedMarginRightPx: Number.parseFloat(styles.marginRight) || 0,
      computedMarginLeftPx: Number.parseFloat(styles.marginLeft) || 0,
      transientPostAttach: JSON.parse(
        element.dataset.legacyTransientAttachmentStage ?? '{}'
      ) as LegacyEnergyAttachmentFixtureStack['transientPostAttach'],
      synchronousPostRefreshContainerCount: Number.parseInt(
        element.dataset.legacySynchronousContainerCount ?? '',
        10
      ),
      oldContainerConnectedImmediatelyAfterRefresh:
        element.dataset.legacyOldContainerConnectedImmediately === 'true',
      stableContainerCount:
        element.parentElement?.querySelectorAll(
          '[data-legacy-canonical-attachment-stack-id]'
        ).length ?? 0,
      oldContainerConnected:
        element.dataset.legacyOldContainerConnected === 'true',
      childDomOrder: [
        ...element.querySelectorAll<HTMLImageElement>(':scope > img'),
      ].map((image) => image.dataset.legacyCanonicalAttachmentCardId ?? ''),
      logicalOrder: JSON.parse(
        element.dataset.legacyAttachmentLogicalOrder ?? '[]'
      ) as string[],
      hitOrder: {
        commonOverlap: idsAt(
          (common.left + common.right) / 2,
          (common.top + common.bottom) / 2
        ),
        energyOnly: idsAt(
          (energyOnlyLeft + energyBounds.right) / 2,
          energyBounds.top + energyBounds.height / 2
        ),
      },
    };
  });
  return { ...details, side, physicalBounds };
};

/**
 * Isolates one v1 Energy attached to an active Pokémon across the immediate
 * attach and stable post-refresh phases. Application modules remain inert; the
 * DOM/state mutations narrowly transcribe the checked-in move/refresh sources.
 */
export const captureLegacySourceEnergyAttachmentReflowFixture = async (
  page: Page
): Promise<LegacySourceEnergyAttachmentReflowFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (body, input) => {
          const makeImage = (id: string) => {
            const image = document.createElement('img') as HTMLImageElement & {
              attached: boolean;
              target: string;
              relative: HTMLImageElement | number;
              energyLayer: number;
              layer: number;
            };
            image.dataset.legacyCanonicalAttachmentCardId = id;
            image.alt = '';
            image.src = `${location.origin}/src/assets/cardback.png`;
            image.style.opacity = '1';
            image.style.position = 'relative';
            image.style.bottom = '0%';
            image.style.zIndex = '0';
            image.style.left = '0px';
            image.style.transform = 'rotate(0deg)';
            image.attached = false;
            image.target = 'off';
            image.relative = 0;
            image.energyLayer = 0;
            image.layer = 0;
            return image;
          };
          const active = body.querySelector('#active');
          if (!(active instanceof HTMLElement)) {
            throw new Error('Legacy canonical active region is missing');
          }
          const stack = document.createElement('div');
          stack.className = 'play-container';
          stack.style.zIndex = '0';
          stack.dataset.legacyCanonicalAttachmentStackId = `${input.side}-canonical-attachment-stack`;
          const [baseId, energyId] = input.cardIds;
          const base = makeImage(baseId);
          const energy = makeImage(energyId);
          stack.append(base);
          active.append(stack);
          await Promise.all([base, energy].map((image) => image.decode()));

          const attachEnergy = (
            image: HTMLImageElement,
            targetStack: HTMLElement,
            clientWidthsBefore: number[],
            authoredWidths: number[]
          ) => {
            const attachedImage = image as typeof base;
            attachedImage.attached = true;
            attachedImage.target = 'on';
            attachedImage.relative = base;
            image.style.position = 'absolute';
            const adjustment = base.clientWidth / 6;
            base.energyLayer += 1;
            image.style.left = `${adjustment}px`;
            image.style.zIndex = String(-base.energyLayer);
            clientWidthsBefore.push(targetStack.clientWidth);
            targetStack.style.width = `${Number.parseFloat(String(targetStack.clientWidth)) + adjustment}px`;
            authoredWidths.push(Number.parseFloat(targetStack.style.width));
            base.after(image);
            image.style.transform = 'rotate(0deg)';
          };
          const transientClientWidthsBefore: number[] = [];
          const transientAuthoredWidths: number[] = [];
          attachEnergy(
            energy,
            stack,
            transientClientWidthsBefore,
            transientAuthoredWidths
          );
          const transientPostAttach = {
            logicalOrder: [baseId, energyId],
            domOrder: [
              ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
            ].map(
              (image) => image.dataset.legacyCanonicalAttachmentCardId ?? ''
            ),
            clientWidth: stack.clientWidth,
            authoredWidthPx: Number.parseFloat(stack.style.width),
          };

          const oldStack = stack;
          const oldStackObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              const removedNode = mutation.removedNodes[0];
              if (
                removedNode?.nodeName === 'IMG' &&
                oldStack.getElementsByTagName('img').length === 0
              ) {
                oldStack.remove();
              }
            }
          });
          oldStackObserver.observe(oldStack, { childList: true });
          const stableStack = document.createElement('div');
          stableStack.className = 'play-container';
          stableStack.style.zIndex = '0';
          stableStack.dataset.legacyCanonicalAttachmentStackId = `${input.side}-canonical-attachment-stack`;
          base.style.opacity = '1';
          base.style.position = 'relative';
          base.style.bottom = '0%';
          base.style.zIndex = '0';
          base.style.left = '0px';
          base.style.transform = 'rotate(0deg)';
          base.attached = false;
          base.target = 'off';
          base.relative = 0;
          base.energyLayer = 0;
          base.layer = 0;
          stableStack.append(base);
          active.append(stableStack);
          energy.style.opacity = '1';
          energy.style.position = 'relative';
          energy.style.bottom = '0%';
          energy.style.zIndex = '0';
          energy.style.left = '0px';
          energy.style.transform = 'rotate(0deg)';
          energy.attached = false;
          energy.target = 'off';
          energy.relative = 0;
          energy.energyLayer = 0;
          energy.layer = 0;
          const stableClientWidthsBefore: number[] = [];
          const stableAuthoredWidths: number[] = [];
          attachEnergy(
            energy,
            stableStack,
            stableClientWidthsBefore,
            stableAuthoredWidths
          );
          stableStack.style.width = `${base.clientWidth + base.clientWidth / 6}px`;
          stableStack.dataset.legacyAttachmentClientWidthsBefore =
            JSON.stringify(stableClientWidthsBefore);
          stableStack.dataset.legacyAttachmentAuthoredWidths =
            JSON.stringify(stableAuthoredWidths);
          stableStack.dataset.legacyTransientAttachmentStage =
            JSON.stringify(transientPostAttach);
          stableStack.dataset.legacyAttachmentLogicalOrder = JSON.stringify([
            baseId,
            energyId,
          ]);
          stableStack.dataset.legacySynchronousContainerCount = String(
            active.querySelectorAll(
              '[data-legacy-canonical-attachment-stack-id]'
            ).length
          );
          stableStack.dataset.legacyOldContainerConnectedImmediately = String(
            oldStack.isConnected
          );
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          oldStackObserver.disconnect();
          stableStack.dataset.legacyOldContainerConnected = String(
            oldStack.isConnected
          );
        },
        { side, cardIds: canonicalAttachmentFixtureCardIds(side) }
      );
  }

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const cards: LegacyEnergyAttachmentFixtureCard[] = [];
  const stacks: LegacyEnergyAttachmentFixtureStack[] = [];
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const frame = page.frameLocator(frameSelector);
    for (const [id, role] of [
      [`${side}-attachment-base`, 'base'],
      [`${side}-attachment-energy`, 'energy'],
    ] as const) {
      cards.push(
        await captureCanonicalAttachmentCard(
          frame.locator(`[data-legacy-canonical-attachment-card-id="${id}"]`),
          side,
          role,
          frameTransforms[side].rotationDegrees
        )
      );
    }
    stacks.push(
      await captureCanonicalAttachmentStack(
        frame.locator(
          `[data-legacy-canonical-attachment-stack-id="${side}-canonical-attachment-stack"]`
        ),
        side
      )
    );
  }
  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames: {
      local: await requireRect(
        page.locator('#selfContainer'),
        '#selfContainer'
      ),
      opponent: await requireRect(
        page.locator('#oppContainer'),
        '#oppContainer'
      ),
    },
    frameTransforms,
    cards,
    stacks,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

type RawTwoEnergyCompactionCard = Omit<
  LegacyTwoEnergyCompactionFixtureCard,
  'side' | 'physicalBounds' | 'effectiveRotationDegrees'
>;

type RawTwoEnergyCompactionStack = Omit<
  LegacyTwoEnergyCompactionFixtureStack,
  'side' | 'physicalBounds'
>;

interface RawTwoEnergyCompactionPhase {
  readonly cards: readonly RawTwoEnergyCompactionCard[];
  readonly stack: RawTwoEnergyCompactionStack;
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
}

interface RawTwoEnergyCompactionCase {
  readonly id: string;
  readonly branch: LegacyTwoEnergyDepartureBranch;
  readonly removedCardId: string;
  readonly remainingCardId: string;
  readonly removedCardAfterDeparture: Omit<
    LegacyTwoEnergyCompactionRemovedCard,
    'side' | 'effectiveRotationDegrees'
  >;
  readonly stablePreDeparture: RawTwoEnergyCompactionPhase;
  readonly transientPostDeparture: RawTwoEnergyCompactionPhase;
  readonly synchronousPostRefresh: RawTwoEnergyCompactionPhase;
  readonly stablePostRefresh: RawTwoEnergyCompactionPhase;
  readonly cleanup: LegacyTwoEnergyCompactionFixtureCase['cleanup'];
}

/**
 * Replays the source-visible portion of one base plus two Energy attachments,
 * then independently removes the inner and outer Energy. Application modules
 * stay inert; the mutation order mirrors moveCard, its layer helpers, and the
 * unconditional refreshBoard reconstruction.
 */
export const captureLegacySourceTwoEnergyCompactionFixture = async (
  page: Page
): Promise<LegacySourceTwoEnergyCompactionFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const frames = {
    local: await requireRect(page.locator('#selfContainer'), '#selfContainer'),
    opponent: await requireRect(page.locator('#oppContainer'), '#oppContainer'),
  };
  const rawCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawTwoEnergyCompactionCase;
  }> = [];

  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const sideCases = await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (body, input): Promise<RawTwoEnergyCompactionCase[]> => {
          type FixtureImage = HTMLImageElement & {
            attached: boolean;
            target: string;
            relative: HTMLImageElement | number;
            energyLayer: number;
            layer: number;
          };

          const active = body.querySelector('#active');
          if (!(active instanceof HTMLElement)) {
            throw new Error('Legacy canonical active region is missing');
          }
          const makeImage = (id: string): FixtureImage => {
            const image = document.createElement('img') as FixtureImage;
            image.dataset.legacyTwoEnergyCardId = id;
            image.alt = '';
            image.src = `${location.origin}/src/assets/cardback.png`;
            image.style.opacity = '1';
            image.style.position = 'relative';
            image.style.bottom = '0%';
            image.style.zIndex = '0';
            image.style.left = '0px';
            image.style.transform = 'rotate(0deg)';
            image.attached = false;
            image.target = 'off';
            image.relative = 0;
            image.energyLayer = 0;
            image.layer = 0;
            return image;
          };
          const resetImage = (image: FixtureImage) => {
            image.style.opacity = '1';
            image.style.position = 'relative';
            image.style.bottom = '0%';
            image.style.zIndex = '0';
            image.energyLayer = 0;
            image.layer = 0;
            image.relative = 0;
            image.style.left = '0px';
            image.attached = false;
            image.target = 'off';
            image.style.transform = 'rotate(0deg)';
          };
          const makeStack = (id: string) => {
            const stack = document.createElement('div');
            stack.className = 'play-container';
            stack.style.zIndex = '0';
            stack.dataset.legacyTwoEnergyStackId = id;
            return stack;
          };
          const attachEnergy = (
            image: FixtureImage,
            base: FixtureImage,
            stack: HTMLElement
          ) => {
            resetImage(image);
            image.attached = true;
            image.target = 'on';
            image.relative = base;
            image.style.position = 'absolute';
            const adjustment = base.clientWidth / 6;
            base.energyLayer += 1;
            const attachmentLayer = base.energyLayer;
            image.style.left = `${attachmentLayer * adjustment}px`;
            image.style.zIndex = String(-attachmentLayer);
            stack.style.width = `${Number.parseFloat(String(stack.clientWidth)) + adjustment}px`;
            base.after(image);
            image.style.transform = 'rotate(0deg)';
          };
          const observeEmptyStack = (stack: HTMLElement) => {
            const observer = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                const removedNode = mutation.removedNodes[0];
                if (
                  removedNode?.nodeName === 'IMG' &&
                  stack.getElementsByTagName('img').length === 0
                ) {
                  stack.remove();
                }
              }
            });
            observer.observe(stack, { childList: true });
            return observer;
          };
          const reconstruct = (
            oldStack: HTMLElement,
            stackId: string,
            logicalCards: FixtureImage[]
          ) => {
            const observer = observeEmptyStack(oldStack);
            const nextStack = makeStack(stackId);
            active.append(nextStack);
            const base = logicalCards[0];
            if (!base) throw new Error('Two-Energy fixture lost its base');
            resetImage(base);
            nextStack.append(base);
            for (const attachment of logicalCards.slice(1)) {
              resetImage(attachment);
              attachment.attached = true;
              attachEnergy(attachment, base, nextStack);
            }
            nextStack.style.width = `${base.clientWidth + (base.energyLayer * base.clientWidth) / 6}px`;
            return { nextStack, observer };
          };
          const updateAttachedCardsPosition = (
            logicalCards: readonly FixtureImage[],
            movingCard: FixtureImage
          ) => {
            for (const card of logicalCards) {
              const cardPosition = card.style.left;
              const movingCardPosition = movingCard.style.left;
              if (
                movingCard.relative instanceof HTMLImageElement &&
                movingCard.relative === card.relative &&
                Number.parseInt(cardPosition) >
                  Number.parseInt(movingCardPosition)
              ) {
                const adjustment = movingCard.relative.clientWidth / 6;
                card.style.left = `${Number.parseInt(cardPosition) - adjustment}px`;
                card.style.zIndex = String(
                  Number.parseInt(card.style.zIndex) + 1
                );
              }
            }
          };
          const decreaseCardLayer = (movingCard: FixtureImage) => {
            if (!(movingCard.relative instanceof HTMLImageElement)) {
              throw new Error('Departing Energy lost its relative base');
            }
            const relativeBase = movingCard.relative as FixtureImage;
            relativeBase.energyLayer -= 1;
            const adjustment = relativeBase.clientWidth / 6;
            const stack = relativeBase.parentElement;
            if (!(stack instanceof HTMLElement)) {
              throw new Error('Departing Energy lost its source stack');
            }
            stack.style.width = `${Number.parseFloat(String(stack.clientWidth)) - adjustment}px`;
          };
          const snapshotRemovedCard = (
            image: FixtureImage,
            sink: HTMLElement
          ): RawTwoEnergyCompactionCase['removedCardAfterDeparture'] => {
            const styles = getComputedStyle(image);
            const matrix = new DOMMatrixReadOnly(styles.transform);
            const id = image.dataset.legacyTwoEnergyCardId ?? '';
            return {
              id,
              role: id.endsWith('-energy-1') ? 'energy1' : 'energy2',
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              localRotationDegrees:
                ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
              zIndex: Number.parseInt(styles.zIndex, 10) || 0,
              inlineLeftPx: Number.parseFloat(image.style.left) || 0,
              inlineBottomPx: Number.parseFloat(image.style.bottom) || 0,
              attached: image.attached,
              target: image.target,
              relativeId:
                image.relative instanceof HTMLImageElement
                  ? (image.relative.dataset.legacyTwoEnergyCardId ?? null)
                  : null,
              energyLayer: image.energyLayer,
              layer: image.layer,
              sourcePath: new URL(image.currentSrc).pathname,
              sinkConnected: sink.isConnected,
              parentIsDepartureSink: image.parentElement === sink,
            };
          };
          const rect = (bounds: DOMRect): CapturedRect => ({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
          const snapshot = (
            stack: HTMLElement,
            logicalCards: readonly FixtureImage[],
            supersededStack: HTMLElement | null
          ): RawTwoEnergyCompactionPhase => {
            const base = logicalCards[0];
            if (!base) throw new Error('Two-Energy snapshot lacks a base');
            const stackCards = logicalCards.filter(
              (image) => image.parentElement === stack
            );
            const cardBounds = new Map(
              stackCards.map((image) => [image, image.getBoundingClientRect()])
            );
            const attachments = stackCards.slice(1);
            if (attachments.length < 1 || attachments.length > 2) {
              throw new Error('Two-Energy phase must retain one or two Energy');
            }
            const idsAt = (x: number, y: number) =>
              document
                .elementsFromPoint(x, y)
                .flatMap((candidate) => {
                  const image = candidate.closest<HTMLImageElement>(
                    '[data-legacy-two-energy-card-id]'
                  );
                  return image?.dataset.legacyTwoEnergyCardId &&
                    stackCards.includes(image as FixtureImage)
                    ? [image.dataset.legacyTwoEnergyCardId]
                    : [];
                })
                .filter((id, index, ids) => ids.indexOf(id) === index);
            const intersection = (images: readonly FixtureImage[]) => {
              const bounds = images.map((image) => cardBounds.get(image));
              if (bounds.some((candidate) => candidate === undefined)) {
                throw new Error('Missing two-Energy card bounds');
              }
              const rectangles = bounds as DOMRect[];
              const left = Math.max(...rectangles.map((value) => value.left));
              const top = Math.max(...rectangles.map((value) => value.top));
              const right = Math.min(...rectangles.map((value) => value.right));
              const bottom = Math.min(
                ...rectangles.map((value) => value.bottom)
              );
              if (right - left <= 2 || bottom - top <= 2) {
                throw new Error('Two-Energy overlap lacks a safe interior');
              }
              return { left, top, right, bottom };
            };
            const center = (bounds: {
              left: number;
              top: number;
              right: number;
              bottom: number;
            }) => ({
              x: (bounds.left + bounds.right) / 2,
              y: (bounds.top + bounds.bottom) / 2,
            });
            const allCardOverlap = center(intersection(stackCards));
            const baseBounds = cardBounds.get(base);
            if (!baseBounds) throw new Error('Missing two-Energy base bounds');
            const attachmentBounds = attachments.map((image) => {
              const bounds = cardBounds.get(image);
              if (!bounds) throw new Error('Missing Energy bounds');
              return bounds;
            });
            const sharedAttachmentRight = Math.min(
              ...attachmentBounds.map((bounds) => bounds.right)
            );
            const attachmentOverlapBounds = {
              left: baseBounds.right + 2,
              right: sharedAttachmentRight - 2,
              top: Math.max(...attachmentBounds.map((bounds) => bounds.top)),
              bottom: Math.min(
                ...attachmentBounds.map((bounds) => bounds.bottom)
              ),
            };
            const outerBounds = attachmentBounds.at(-1);
            if (!outerBounds) throw new Error('Missing outer Energy bounds');
            const priorRight =
              attachmentBounds.length === 1
                ? baseBounds.right
                : attachmentBounds[attachmentBounds.length - 2]?.right;
            if (priorRight === undefined) {
              throw new Error('Missing inner Energy bounds');
            }
            const outermostBounds = {
              left: priorRight + 2,
              right: outerBounds.right - 2,
              top: outerBounds.top,
              bottom: outerBounds.bottom,
            };
            const baseOnlyBounds = {
              left: baseBounds.left + 2,
              right:
                Math.min(...attachmentBounds.map((bounds) => bounds.left)) - 2,
              top: baseBounds.top,
              bottom: baseBounds.bottom,
            };
            for (const [label, bounds] of Object.entries({
              attachmentOverlapBounds,
              outermostBounds,
              baseOnlyBounds,
            })) {
              if (
                bounds.right - bounds.left <= 0 ||
                bounds.bottom - bounds.top <= 0
              ) {
                throw new Error(`${label} lacks a safe interior`);
              }
            }
            const hitPointsFrameLocal = {
              allCardOverlap,
              attachmentOverlap: center(attachmentOverlapBounds),
              outermostAttachment: center(outermostBounds),
              baseOnly: center(baseOnlyBounds),
            };
            const stackBounds = stack.getBoundingClientRect();
            const stackStyles = getComputedStyle(stack);
            return {
              cards: stackCards.map((image) => {
                const bounds = cardBounds.get(image);
                if (!bounds) throw new Error('Missing captured Energy bounds');
                const styles = getComputedStyle(image);
                const matrix = new DOMMatrixReadOnly(styles.transform);
                const id = image.dataset.legacyTwoEnergyCardId ?? '';
                const role = id.endsWith('-base')
                  ? 'base'
                  : id.endsWith('-energy-1')
                    ? 'energy1'
                    : 'energy2';
                return {
                  id,
                  role,
                  frameLocalBounds: rect(bounds),
                  naturalWidth: image.naturalWidth,
                  naturalHeight: image.naturalHeight,
                  clientWidth: image.clientWidth,
                  clientHeight: image.clientHeight,
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: Number.parseFloat(image.style.left) || 0,
                  inlineBottomPx: Number.parseFloat(image.style.bottom) || 0,
                  attached: image.attached,
                  target: image.target,
                  relativeId:
                    image.relative instanceof HTMLImageElement
                      ? (image.relative.dataset.legacyTwoEnergyCardId ?? null)
                      : null,
                  energyLayer: image.energyLayer,
                  layer: image.layer,
                  domOrdinal: [
                    ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
                  ].indexOf(image),
                  logicalOrdinal: logicalCards.indexOf(image),
                  sourcePath: new URL(image.currentSrc).pathname,
                };
              }),
              stack: {
                id: stack.dataset.legacyTwoEnergyStackId ?? '',
                frameLocalBounds: rect(stackBounds),
                baseClientWidth: base.clientWidth,
                baseEnergyLayer: base.energyLayer,
                clientWidth: stack.clientWidth,
                authoredWidthPx: Number.parseFloat(stack.style.width),
                inlineMarginRight: stack.style.marginRight,
                inlineMarginLeft: stack.style.marginLeft,
                computedMarginRightPx:
                  Number.parseFloat(stackStyles.marginRight) || 0,
                computedMarginLeftPx:
                  Number.parseFloat(stackStyles.marginLeft) || 0,
                childDomOrder: [
                  ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
                ].map((image) => image.dataset.legacyTwoEnergyCardId ?? ''),
                logicalOrder: stackCards.map(
                  (image) => image.dataset.legacyTwoEnergyCardId ?? ''
                ),
                hitOrder: {
                  allCardOverlap: idsAt(
                    hitPointsFrameLocal.allCardOverlap.x,
                    hitPointsFrameLocal.allCardOverlap.y
                  ),
                  attachmentOverlap: idsAt(
                    hitPointsFrameLocal.attachmentOverlap.x,
                    hitPointsFrameLocal.attachmentOverlap.y
                  ),
                  outermostAttachment: idsAt(
                    hitPointsFrameLocal.outermostAttachment.x,
                    hitPointsFrameLocal.outermostAttachment.y
                  ),
                  baseOnly: idsAt(
                    hitPointsFrameLocal.baseOnly.x,
                    hitPointsFrameLocal.baseOnly.y
                  ),
                },
                hitPointsFrameLocal,
              },
              observedWrapperCount: active.querySelectorAll(
                '[data-legacy-two-energy-stack-id]'
              ).length,
              supersededWrapperConnected: supersededStack?.isConnected ?? false,
            };
          };

          const results: RawTwoEnergyCompactionCase[] = [];
          for (const branch of ['inner', 'outer'] as const) {
            active.replaceChildren();
            const sink = document.createElement('div');
            sink.dataset.legacyTwoEnergyDepartureSink = branch;
            body.append(sink);
            const prefix = `${input.side}-${branch}`;
            const stackId = `${prefix}-two-energy-stack`;
            const base = makeImage(`${prefix}-base`);
            const energyOne = makeImage(`${prefix}-energy-1`);
            const energyTwo = makeImage(`${prefix}-energy-2`);
            const logicalCards = [base, energyOne, energyTwo];
            const initialStack = makeStack(stackId);
            initialStack.append(base);
            active.append(initialStack);
            await Promise.all(logicalCards.map((image) => image.decode()));
            attachEnergy(energyOne, base, initialStack);
            attachEnergy(energyTwo, base, initialStack);

            const initialRefresh = reconstruct(
              initialStack,
              stackId,
              logicalCards
            );
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
            initialRefresh.observer.disconnect();
            const stablePreDeparture = snapshot(
              initialRefresh.nextStack,
              logicalCards,
              initialStack
            );

            const removalIndex = branch === 'inner' ? 1 : 2;
            const removed = logicalCards[removalIndex];
            if (!removed) throw new Error(`Missing ${branch} departure card`);
            logicalCards.splice(removalIndex, 1);
            updateAttachedCardsPosition(logicalCards, removed);
            decreaseCardLayer(removed);
            resetImage(removed);
            sink.append(removed);
            const removedCardAfterDeparture = snapshotRemovedCard(
              removed,
              sink
            );
            const transientPostDeparture = snapshot(
              initialRefresh.nextStack,
              logicalCards,
              null
            );

            const departureRefresh = reconstruct(
              initialRefresh.nextStack,
              stackId,
              logicalCards
            );
            const synchronousPostRefresh = snapshot(
              departureRefresh.nextStack,
              logicalCards,
              initialRefresh.nextStack
            );
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
            departureRefresh.observer.disconnect();
            const stablePostRefresh = snapshot(
              departureRefresh.nextStack,
              logicalCards,
              initialRefresh.nextStack
            );
            const result = {
              id: `${prefix}-departure`,
              branch,
              removedCardId: removed.dataset.legacyTwoEnergyCardId ?? '',
              remainingCardId:
                logicalCards[1]?.dataset.legacyTwoEnergyCardId ?? '',
              removedCardAfterDeparture,
              stablePreDeparture,
              transientPostDeparture,
              synchronousPostRefresh,
              stablePostRefresh,
            };
            departureRefresh.nextStack.remove();
            sink.remove();
            results.push({
              ...result,
              cleanup: {
                observedWrapperCount: active.querySelectorAll(
                  '[data-legacy-two-energy-stack-id]'
                ).length,
                observedCardCount: body.querySelectorAll(
                  '[data-legacy-two-energy-card-id]'
                ).length,
                sinkConnected: sink.isConnected,
              },
            });
          }
          return results;
        },
        { side }
      );
    rawCases.push(...sideCases.map((value) => ({ side, value })));
  }

  const physicalBounds = (
    side: LegacyFixtureSide,
    bounds: CapturedRect
  ): CapturedRect =>
    side === 'local'
      ? {
          x: frames.local.x + bounds.x,
          y: frames.local.y + bounds.y,
          width: bounds.width,
          height: bounds.height,
        }
      : {
          x:
            frames.opponent.x + frames.opponent.width - bounds.x - bounds.width,
          y:
            frames.opponent.y +
            frames.opponent.height -
            bounds.y -
            bounds.height,
          width: bounds.width,
          height: bounds.height,
        };
  const convertPhase = (
    side: LegacyFixtureSide,
    phase: RawTwoEnergyCompactionPhase
  ): LegacyTwoEnergyCompactionFixturePhase => ({
    ...phase,
    cards: phase.cards.map((card) => ({
      ...card,
      side,
      physicalBounds: physicalBounds(side, card.frameLocalBounds),
      effectiveRotationDegrees:
        (card.localRotationDegrees + frameTransforms[side].rotationDegrees) %
        360,
    })),
    stack: {
      ...phase.stack,
      side,
      physicalBounds: physicalBounds(side, phase.stack.frameLocalBounds),
    },
  });
  const cases = rawCases.map(
    ({ side, value }): LegacyTwoEnergyCompactionFixtureCase => ({
      ...value,
      side,
      removedCardAfterDeparture: {
        ...value.removedCardAfterDeparture,
        side,
        effectiveRotationDegrees:
          (value.removedCardAfterDeparture.localRotationDegrees +
            frameTransforms[side].rotationDegrees) %
          360,
      },
      stablePreDeparture: convertPhase(side, value.stablePreDeparture),
      transientPostDeparture: convertPhase(side, value.transientPostDeparture),
      synchronousPostRefresh: convertPhase(side, value.synchronousPostRefresh),
      stablePostRefresh: convertPhase(side, value.stablePostRefresh),
    })
  );

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames,
    frameTransforms,
    cases,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

type RawMixedAttachmentCard = Omit<
  LegacyMixedAttachmentFixtureCard,
  | 'side'
  | 'physicalBounds'
  | 'untransformedPhysicalBounds'
  | 'effectiveRotationDegrees'
>;

type RawMixedAttachmentStack = Omit<
  LegacyMixedAttachmentFixtureStack,
  'side' | 'physicalBounds' | 'hitPointsPhysical'
>;

interface RawMixedAttachmentPhase {
  readonly cards: readonly RawMixedAttachmentCard[];
  readonly stack: RawMixedAttachmentStack;
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
}

interface RawMixedAttachmentOrderCase {
  readonly id: string;
  readonly order: LegacyMixedAttachmentOrder;
  readonly postFirstAttachment: RawMixedAttachmentPhase;
  readonly immediatePostSecondAttachment: RawMixedAttachmentPhase;
  readonly synchronousPostRefresh: RawMixedAttachmentPhase;
  readonly stablePostRefresh: RawMixedAttachmentPhase;
  readonly immediateAttachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly refreshAttachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

interface RawMixedAttachmentDepartureCase {
  readonly id: string;
  readonly removedRole: LegacyMixedAttachmentDeparture;
  readonly stablePreDeparture: RawMixedAttachmentPhase;
  readonly removedCardAfterDeparture: Omit<
    LegacyMixedAttachmentRemovedCard,
    'side' | 'effectiveRotationDegrees'
  >;
  readonly transientPostDeparture: RawMixedAttachmentPhase;
  readonly synchronousPostRefresh: RawMixedAttachmentPhase;
  readonly stablePostRefresh: RawMixedAttachmentPhase;
  readonly cleanup: LegacyFixtureCleanup;
}

type RawMixedRestoredCard = Omit<
  LegacyMixedRestoredCard,
  'physicalBounds' | 'untransformedPhysicalBounds' | 'effectiveRotationDegrees'
>;

interface RawMixedRestoredPhase {
  readonly cards: readonly RawMixedRestoredCard[];
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
  readonly stagingDisplay: string;
  readonly stack: Omit<
    LegacyMixedRestoredPhase['stack'],
    'side' | 'physicalBounds' | 'hitPointsPhysical'
  >;
}

interface RawMixedRestoreCase {
  readonly id: string;
  readonly scenario: LegacyMixedRestoreScenario;
  readonly stagedBeforeRestore: LegacyMixedStagedPhase;
  readonly immediatePostRestore: RawMixedRestoredPhase;
  readonly settledPostRestore: RawMixedRestoredPhase;
  readonly attachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

interface RawMixedStagedSwapCase {
  readonly id: string;
  readonly selectedCardId: string;
  readonly priorDeckTopCardId: string;
  readonly stagedBeforeSwap: LegacyMixedStagedPhase;
  readonly deckBeforeSwap: LegacyMixedDeckPhase;
  readonly stagedAfterSelectedDeparture: LegacyMixedStagedPhase;
  readonly deckAfterSelectedDeparture: LegacyMixedDeckPhase;
  readonly deckAfterRotation: LegacyMixedDeckPhase;
  readonly stagedAfterSwap: LegacyMixedStagedPhase;
  readonly deckAfterSwap: LegacyMixedDeckPhase;
  readonly resetTrace: readonly LegacyMixedSwapResetTraceEntry[];
  readonly immediatePostRestore: RawMixedRestoredPhase;
  readonly settledPostRestore: RawMixedRestoredPhase;
  readonly attachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

/**
 * Characterizes v1's mixed ordinary-Energy/current-category-Trainer attachment
 * order without executing the application module. In particular, this keeps
 * attachCard's recursive Energy-triggered Tool move, parseInt compaction,
 * syncRotation margin/quarter-turn, unconditional refresh reconstruction, and
 * the real empty-wrapper MutationObserver observable in Chromium.
 */
export const captureLegacySourceMixedAttachmentOrderFixture = async (
  page: Page
): Promise<LegacySourceMixedAttachmentOrderFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const frames = {
    local: await requireRect(page.locator('#selfContainer'), '#selfContainer'),
    opponent: await requireRect(page.locator('#oppContainer'), '#oppContainer'),
  };
  const rawAttachmentCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawMixedAttachmentOrderCase;
  }> = [];
  const rawDepartureCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawMixedAttachmentDepartureCase;
  }> = [];
  const rawRestoreCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawMixedRestoreCase;
  }> = [];
  const rawStagedSwapCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawMixedStagedSwapCase;
  }> = [];

  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const captured = await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (
          body,
          input
        ): Promise<{
          attachmentCases: RawMixedAttachmentOrderCase[];
          departureCases: RawMixedAttachmentDepartureCase[];
          restoreCases: RawMixedRestoreCase[];
          stagedSwapCases: RawMixedStagedSwapCase[];
        }> => {
          type FixtureImage = HTMLImageElement & {
            attached: boolean;
            target: string;
            relative: HTMLImageElement | number;
            energyLayer: number;
            layer: number;
          };
          interface FixtureCardBase {
            readonly role: string;
            readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
            readonly image: FixtureImage;
          }
          interface FixtureCard extends FixtureCardBase {
            readonly role: LegacyMixedAttachmentRole;
          }
          interface StagedFixtureCard extends FixtureCardBase {
            readonly role: LegacyMixedStagedRole;
          }

          const active = body.querySelector('#active');
          if (!(active instanceof HTMLElement)) {
            throw new Error('Legacy mixed fixture active region is missing');
          }
          const attachedCards = body.querySelector('#attachedCards');
          const deckElement = body.querySelector('#deck');
          if (
            !(attachedCards instanceof HTMLElement) ||
            !(deckElement instanceof HTMLElement)
          ) {
            throw new Error('Legacy mixed fixture staging zones are missing');
          }
          const twoAnimationFrames = () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
          const resetImage = (image: FixtureImage) => {
            image.style.opacity = '1';
            image.style.position = 'relative';
            image.style.bottom = '0%';
            image.style.zIndex = '0';
            image.energyLayer = 0;
            image.layer = 0;
            image.relative = 0;
            image.style.left = '0px';
            image.attached = false;
            image.target = 'off';
            image.style.transform = 'rotate(0deg)';
          };
          const makeCard = (
            id: string,
            role: LegacyMixedAttachmentRole,
            currentCategory: FixtureCard['currentCategory'],
            sink: HTMLElement
          ): FixtureCard => {
            const image = document.createElement('img') as FixtureImage;
            image.dataset.legacyMixedAttachmentCardId = id;
            image.alt = '';
            image.src = `${location.origin}/src/assets/cardback.png`;
            resetImage(image);
            sink.append(image);
            return { role, currentCategory, image };
          };
          const makeStack = (id: string) => {
            const stack = document.createElement('div');
            stack.className = 'play-container';
            stack.style.zIndex = '0';
            stack.dataset.legacyMixedAttachmentStackId = id;
            active.append(stack);
            return stack;
          };
          const updateAttachedCardsPosition = (
            logicalCards: readonly FixtureCardBase[],
            movingCard: FixtureCardBase
          ) => {
            for (const card of logicalCards) {
              if (
                card.currentCategory !== 'Pokémon' &&
                movingCard.currentCategory !== 'Pokémon'
              ) {
                const cardPosition = card.image.style.left;
                const movingCardPosition = movingCard.image.style.left;
                if (
                  movingCard.image.relative instanceof HTMLImageElement &&
                  movingCard.image.relative === card.image.relative &&
                  Number.parseInt(cardPosition) >
                    Number.parseInt(movingCardPosition)
                ) {
                  const adjustment = movingCard.image.relative.clientWidth / 6;
                  card.image.style.left = `${Number.parseInt(cardPosition) - adjustment}px`;
                  card.image.style.zIndex = String(
                    Number.parseInt(card.image.style.zIndex) + 1
                  );
                }
              }
            }
          };
          const decreaseCardLayer = (movingCard: FixtureCardBase) => {
            if (!(movingCard.image.relative instanceof HTMLImageElement)) {
              throw new Error('Mixed departure lost its relative base');
            }
            const base = movingCard.image.relative as FixtureImage;
            base.energyLayer -= 1;
            const stack = base.parentElement;
            if (!(stack instanceof HTMLElement)) {
              throw new Error('Mixed departure lost its source wrapper');
            }
            const adjustment = base.clientWidth / 6;
            stack.style.width = `${Number.parseFloat(String(stack.clientWidth)) - adjustment}px`;
          };
          const attachCard = (
            logicalCards: FixtureCardBase[],
            movingCard: FixtureCardBase,
            baseCard: FixtureCardBase,
            stack: HTMLElement,
            trace: LegacyMixedAttachmentAttachTraceEntry[],
            allowEnergyToolMove: boolean
          ) => {
            const nonEvolveAttachment =
              movingCard.image.target === 'on' ||
              !movingCard.image.parentElement?.classList.contains(
                'play-container'
              );
            resetImage(movingCard.image);
            movingCard.image.attached = true;
            movingCard.image.target = 'on';
            movingCard.image.relative = baseCard.image;
            movingCard.image.style.position = 'absolute';
            const adjustment = baseCard.image.clientWidth / 6;
            baseCard.image.energyLayer += 1;
            const layer = baseCard.image.energyLayer;
            movingCard.image.style.left = `${layer * adjustment}px`;
            const clientWidthBefore = stack.clientWidth;
            stack.style.width = `${Number.parseFloat(String(clientWidthBefore)) + adjustment}px`;
            movingCard.image.style.zIndex = String(-layer);
            baseCard.image.after(movingCard.image);
            if (movingCard.currentCategory === 'Trainer') {
              stack.style.marginRight = '2%';
              movingCard.image.style.transform = 'rotate(90deg)';
            } else {
              movingCard.image.style.transform = 'rotate(0deg)';
            }
            trace.push({
              role:
                movingCard.currentCategory === 'Energy'
                  ? 'energy'
                  : 'trainerTool',
              clientWidthBefore,
              authoredWidthAfterPx: Number.parseFloat(stack.style.width),
              inlineLeftPx: Number.parseFloat(movingCard.image.style.left) || 0,
              zIndex: Number.parseInt(movingCard.image.style.zIndex),
            });

            if (
              allowEnergyToolMove &&
              movingCard.currentCategory === 'Energy' &&
              nonEvolveAttachment
            ) {
              for (let index = 0; index < logicalCards.length - 1; index += 1) {
                const card = logicalCards[index];
                if (!card) throw new Error('Mixed logical card disappeared');
                if (
                  card.image.relative === movingCard.image.relative &&
                  card.currentCategory !== 'Pokémon' &&
                  card.currentCategory !== 'Energy'
                ) {
                  const baseIndex = logicalCards.findIndex(
                    (candidate) => candidate.image === movingCard.image.relative
                  );
                  const target = logicalCards[baseIndex];
                  const moved = logicalCards[index];
                  if (!target || !moved) {
                    throw new Error('Mixed Tool move lost target or card');
                  }
                  logicalCards.push(...logicalCards.splice(index, 1));
                  updateAttachedCardsPosition(logicalCards, moved);
                  if (moved.image.target === 'on') decreaseCardLayer(moved);
                  attachCard(logicalCards, moved, target, stack, trace, false);
                  index -= 1;
                }
                if (logicalCards[index] === movingCard) break;
              }
            }
          };
          const observeEmptyStack = (stack: HTMLElement) => {
            const observer = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                const removedNode = mutation.removedNodes[0];
                if (
                  removedNode?.nodeName === 'IMG' &&
                  stack.getElementsByTagName('img').length === 0
                ) {
                  stack.remove();
                }
              }
            });
            observer.observe(stack, { childList: true });
            return observer;
          };
          const reconstruct = (
            logicalCards: FixtureCard[],
            oldStack: HTMLElement,
            stackId: string
          ) => {
            const observer = observeEmptyStack(oldStack);
            const nextStack = makeStack(stackId);
            const base = logicalCards[0];
            if (!base) throw new Error('Mixed refresh lost its base');
            resetImage(base.image);
            nextStack.append(base.image);
            const trace: LegacyMixedAttachmentAttachTraceEntry[] = [];
            for (const card of logicalCards.slice(1)) {
              resetImage(card.image);
              attachCard(logicalCards, card, base, nextStack, trace, false);
            }
            nextStack.style.width = `${base.image.clientWidth + (base.image.energyLayer * base.image.clientWidth) / 6}px`;
            return { nextStack, observer, trace };
          };
          const rect = (bounds: DOMRect): CapturedRect => ({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
          const center = (bounds: {
            left: number;
            top: number;
            right: number;
            bottom: number;
          }): CapturedPoint => ({
            x: (bounds.left + bounds.right) / 2,
            y: (bounds.top + bounds.bottom) / 2,
          });
          const requireInterior = (
            bounds: {
              left: number;
              top: number;
              right: number;
              bottom: number;
            },
            label: string
          ) => {
            if (
              bounds.right - bounds.left <= 0 ||
              bounds.bottom - bounds.top <= 0
            ) {
              throw new Error(`${label} lacks a safe interior`);
            }
            return bounds;
          };
          const snapshot = (
            stack: HTMLElement,
            logicalCards: readonly FixtureCard[],
            supersededStack: HTMLElement | null
          ): RawMixedAttachmentPhase => {
            const stackCards = logicalCards.filter(
              (card) => card.image.parentElement === stack
            );
            const paintedBounds = new Map(
              stackCards.map((card) => [
                card.role,
                card.image.getBoundingClientRect(),
              ])
            );
            const untransformedBounds = new Map<
              LegacyMixedAttachmentRole,
              DOMRect
            >();
            for (const card of stackCards) {
              const transform = card.image.style.transform;
              try {
                card.image.style.transform = 'none';
                untransformedBounds.set(
                  card.role,
                  card.image.getBoundingClientRect()
                );
              } finally {
                card.image.style.transform = transform;
              }
            }
            const baseBounds = paintedBounds.get('base');
            if (!baseBounds) throw new Error('Mixed snapshot lacks its base');
            const idsAt = (point: CapturedPoint) =>
              document
                .elementsFromPoint(point.x, point.y)
                .flatMap((candidate) => {
                  const image = candidate.closest<HTMLImageElement>(
                    '[data-legacy-mixed-attachment-card-id]'
                  );
                  return image?.dataset.legacyMixedAttachmentCardId &&
                    stackCards.some((card) => card.image === image)
                    ? [image.dataset.legacyMixedAttachmentCardId]
                    : [];
                })
                .filter((id, index, ids) => ids.indexOf(id) === index);
            const hitPointsFrameLocal: Record<string, CapturedPoint> = {};
            const energyBounds = paintedBounds.get('energy');
            const toolBounds = paintedBounds.get('trainerTool');
            const toolLayoutBounds = untransformedBounds.get('trainerTool');
            if (energyBounds && toolBounds && toolLayoutBounds) {
              const topBand = {
                top: baseBounds.top + 2,
                bottom: toolBounds.top - 2,
              };
              hitPointsFrameLocal['baseOnly'] = center(
                requireInterior(
                  {
                    left: baseBounds.left + 2,
                    right: Math.min(energyBounds.left, toolBounds.left) - 2,
                    ...topBand,
                  },
                  'Mixed base-only region'
                )
              );
              hitPointsFrameLocal['baseEnergyAboveTool'] = center(
                requireInterior(
                  {
                    left: Math.max(baseBounds.left, energyBounds.left),
                    right: Math.min(baseBounds.right, energyBounds.right),
                    ...topBand,
                  },
                  'Mixed base/Energy authored-Tool-only region'
                )
              );
              hitPointsFrameLocal['energyAboveTool'] = center(
                requireInterior(
                  {
                    left: baseBounds.right + 2,
                    right: energyBounds.right - 2,
                    ...topBand,
                  },
                  'Mixed Energy authored-Tool-only region'
                )
              );
              const commonVertical = {
                top: Math.max(baseBounds.top, energyBounds.top, toolBounds.top),
                bottom: Math.min(
                  baseBounds.bottom,
                  energyBounds.bottom,
                  toolBounds.bottom
                ),
              };
              hitPointsFrameLocal['allCardOverlap'] = center(
                requireInterior(
                  {
                    left: Math.max(
                      baseBounds.left,
                      energyBounds.left,
                      toolBounds.left
                    ),
                    right: Math.min(
                      baseBounds.right,
                      energyBounds.right,
                      toolBounds.right
                    ),
                    ...commonVertical,
                  },
                  'Mixed all-card region'
                )
              );
              hitPointsFrameLocal['energyToolOverlap'] = center(
                requireInterior(
                  {
                    left: baseBounds.right + 2,
                    right: Math.min(energyBounds.right, toolBounds.right) - 2,
                    ...commonVertical,
                  },
                  'Mixed Energy/Tool region'
                )
              );
              hitPointsFrameLocal['toolPaintedOnly'] = center(
                requireInterior(
                  {
                    left:
                      Math.max(
                        baseBounds.right,
                        energyBounds.right,
                        toolLayoutBounds.right
                      ) + 2,
                    right: toolBounds.right - 2,
                    top: toolBounds.top,
                    bottom: toolBounds.bottom,
                  },
                  'Mixed painted-only Tool region'
                )
              );
            } else if (energyBounds) {
              hitPointsFrameLocal['commonOverlap'] = center({
                left: Math.max(baseBounds.left, energyBounds.left),
                right: Math.min(baseBounds.right, energyBounds.right),
                top: Math.max(baseBounds.top, energyBounds.top),
                bottom: Math.min(baseBounds.bottom, energyBounds.bottom),
              });
              hitPointsFrameLocal['energyOnly'] = center(
                requireInterior(
                  {
                    left: baseBounds.right + 2,
                    right: energyBounds.right - 2,
                    top: energyBounds.top,
                    bottom: energyBounds.bottom,
                  },
                  'Mixed fixture Energy-only region'
                )
              );
            } else if (toolBounds && toolLayoutBounds) {
              hitPointsFrameLocal['commonOverlap'] = center({
                left: Math.max(baseBounds.left, toolBounds.left),
                right: Math.min(baseBounds.right, toolBounds.right),
                top: Math.max(baseBounds.top, toolBounds.top),
                bottom: Math.min(baseBounds.bottom, toolBounds.bottom),
              });
              hitPointsFrameLocal['toolOnly'] = center(
                requireInterior(
                  {
                    left:
                      Math.max(baseBounds.right, toolLayoutBounds.right) + 2,
                    right: toolBounds.right - 2,
                    top: toolBounds.top,
                    bottom: toolBounds.bottom,
                  },
                  'Mixed fixture Tool-only region'
                )
              );
              hitPointsFrameLocal['baseOnly'] = center(
                requireInterior(
                  {
                    left: baseBounds.left,
                    right: baseBounds.right,
                    top: baseBounds.top + 2,
                    bottom: toolBounds.top - 2,
                  },
                  'Mixed fixture base-only region'
                )
              );
              hitPointsFrameLocal['authoredLayoutOnly'] = center(
                requireInterior(
                  {
                    left: baseBounds.right + 2,
                    right: toolLayoutBounds.right - 2,
                    top: toolBounds.bottom + 2,
                    bottom: toolLayoutBounds.bottom - 2,
                  },
                  'Mixed fixture authored-layout-only region'
                )
              );
            } else {
              throw new Error('Mixed snapshot has no attachment');
            }

            const stackBounds = stack.getBoundingClientRect();
            const stackStyles = getComputedStyle(stack);
            const base = stackCards.find((card) => card.role === 'base');
            if (!base) throw new Error('Mixed wrapper lacks its base');
            return {
              cards: stackCards.map((card) => {
                const painted = paintedBounds.get(card.role);
                const untransformed = untransformedBounds.get(card.role);
                if (!painted || !untransformed) {
                  throw new Error(`Mixed ${card.role} bounds are missing`);
                }
                const styles = getComputedStyle(card.image);
                const matrix = new DOMMatrixReadOnly(styles.transform);
                return {
                  id: card.image.dataset.legacyMixedAttachmentCardId ?? '',
                  role: card.role,
                  currentCategory: card.currentCategory,
                  frameLocalBounds: rect(painted),
                  untransformedFrameLocalBounds: rect(untransformed),
                  naturalWidth: card.image.naturalWidth,
                  naturalHeight: card.image.naturalHeight,
                  clientWidth: card.image.clientWidth,
                  clientHeight: card.image.clientHeight,
                  offsetWidth: card.image.offsetWidth,
                  offsetHeight: card.image.offsetHeight,
                  computedWidthPx: Number.parseFloat(styles.width),
                  computedHeightPx: Number.parseFloat(styles.height),
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  transformMatrix: {
                    a: matrix.a,
                    b: matrix.b,
                    c: matrix.c,
                    d: matrix.d,
                  },
                  transformOrigin: styles.transformOrigin,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
                  inlineBottomPx:
                    Number.parseFloat(card.image.style.bottom) || 0,
                  attached: card.image.attached,
                  target: card.image.target,
                  relativeId:
                    card.image.relative instanceof HTMLImageElement
                      ? (card.image.relative.dataset
                          .legacyMixedAttachmentCardId ?? null)
                      : null,
                  energyLayer: card.image.energyLayer,
                  layer: card.image.layer,
                  domOrdinal: [
                    ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
                  ].indexOf(card.image),
                  logicalOrdinal: logicalCards.indexOf(card),
                  sourcePath: new URL(card.image.currentSrc).pathname,
                };
              }),
              stack: {
                id: stack.dataset.legacyMixedAttachmentStackId ?? '',
                frameLocalBounds: rect(stackBounds),
                baseClientWidth: base.image.clientWidth,
                baseEnergyLayer: base.image.energyLayer,
                clientWidth: stack.clientWidth,
                authoredWidthPx: Number.parseFloat(stack.style.width),
                inlineMarginRight: stack.style.marginRight,
                inlineMarginLeft: stack.style.marginLeft,
                computedMarginRightPx:
                  Number.parseFloat(stackStyles.marginRight) || 0,
                computedMarginLeftPx:
                  Number.parseFloat(stackStyles.marginLeft) || 0,
                childDomOrder: [
                  ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
                ].map(
                  (image) => image.dataset.legacyMixedAttachmentCardId ?? ''
                ),
                logicalOrder: stackCards.map(
                  (card) => card.image.dataset.legacyMixedAttachmentCardId ?? ''
                ),
                hitOrder: Object.fromEntries(
                  Object.entries(hitPointsFrameLocal).map(([label, point]) => [
                    label,
                    idsAt(point),
                  ])
                ),
                hitPointsFrameLocal,
              },
              observedWrapperCount: active.querySelectorAll(
                '[data-legacy-mixed-attachment-stack-id]'
              ).length,
              supersededWrapperConnected: supersededStack?.isConnected ?? false,
            };
          };
          const snapshotRemovedCard = (
            card: FixtureCard,
            sink: HTMLElement
          ): RawMixedAttachmentDepartureCase['removedCardAfterDeparture'] => {
            const styles = getComputedStyle(card.image);
            const matrix = new DOMMatrixReadOnly(styles.transform);
            return {
              id: card.image.dataset.legacyMixedAttachmentCardId ?? '',
              role: card.role === 'energy' ? 'energy' : 'trainerTool',
              naturalWidth: card.image.naturalWidth,
              naturalHeight: card.image.naturalHeight,
              localRotationDegrees:
                ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
              zIndex: Number.parseInt(styles.zIndex, 10) || 0,
              inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
              inlineBottomPx: Number.parseFloat(card.image.style.bottom) || 0,
              attached: card.image.attached,
              target: card.image.target,
              relativeId: null,
              energyLayer: card.image.energyLayer,
              layer: card.image.layer,
              sourcePath: new URL(card.image.currentSrc).pathname,
              sinkConnected: sink.isConnected,
              parentIsDepartureSink: card.image.parentElement === sink,
            };
          };
          const cleanup = (sink: HTMLElement): LegacyFixtureCleanup => {
            const result = {
              observedWrapperCount: active.querySelectorAll(
                '[data-legacy-mixed-attachment-stack-id]'
              ).length,
              observedCardCount: body.querySelectorAll(
                '[data-legacy-mixed-attachment-card-id]'
              ).length,
              sinkConnected: sink.isConnected,
            };
            return result;
          };
          const cardId = (prefix: string, role: LegacyMixedAttachmentRole) =>
            `${prefix}-${role === 'trainerTool' ? 'trainer-tool' : role}`;
          const buildCards = async (prefix: string, sink: HTMLElement) => {
            const base = makeCard(
              cardId(prefix, 'base'),
              'base',
              'Pokémon',
              sink
            );
            const energy = makeCard(
              cardId(prefix, 'energy'),
              'energy',
              'Energy',
              sink
            );
            const trainerTool = makeCard(
              cardId(prefix, 'trainerTool'),
              'trainerTool',
              'Trainer',
              sink
            );
            await Promise.all(
              [base, energy, trainerTool].map((card) => card.image.decode())
            );
            return { base, energy, trainerTool };
          };
          const stagedCardId = (prefix: string, role: LegacyMixedStagedRole) =>
            `${prefix}-${role.replace(/([A-Z])/gu, '-$1').toLowerCase()}`;
          const stagedCategory = (
            role: LegacyMixedStagedRole
          ): StagedFixtureCard['currentCategory'] => {
            if (role === 'base') return 'Pokémon';
            return role.includes('energy') || role.includes('Energy')
              ? 'Energy'
              : 'Trainer';
          };
          const buildStagedCards = async (
            prefix: string,
            roles: readonly LegacyMixedStagedRole[]
          ): Promise<StagedFixtureCard[]> => {
            const cards = roles.map((role) => {
              const image = document.createElement('img') as FixtureImage;
              image.dataset.legacyMixedStagedCardId = stagedCardId(
                prefix,
                role
              );
              image.alt = '';
              image.src = `${location.origin}/src/assets/cardback.png`;
              resetImage(image);
              attachedCards.append(image);
              return {
                role,
                currentCategory: stagedCategory(role),
                image,
              } satisfies StagedFixtureCard;
            });
            await Promise.all(cards.map((card) => card.image.decode()));
            attachedCards.style.display = 'block';
            return cards;
          };
          const stagedSnapshot = (
            logicalCards: readonly StagedFixtureCard[]
          ): LegacyMixedStagedPhase => {
            const directImages = [
              ...attachedCards.querySelectorAll<HTMLImageElement>(
                ':scope > [data-legacy-mixed-staged-card-id]'
              ),
            ];
            return {
              cards: logicalCards.map((card, logicalOrdinal) => {
                const styles = getComputedStyle(card.image);
                const matrix = new DOMMatrixReadOnly(styles.transform);
                const parentZone =
                  card.image.parentElement === attachedCards
                    ? 'attachedCards'
                    : card.image.parentElement === deckElement
                      ? 'deck'
                      : null;
                if (!parentZone) {
                  throw new Error(`Staged ${card.role} has an invalid parent`);
                }
                return {
                  id: card.image.dataset.legacyMixedStagedCardId ?? '',
                  role: card.role,
                  currentCategory: card.currentCategory,
                  parentZone,
                  logicalOrdinal,
                  domOrdinal:
                    parentZone === 'attachedCards'
                      ? directImages.indexOf(card.image)
                      : [
                          ...deckElement.querySelectorAll<HTMLImageElement>(
                            ':scope > [data-legacy-mixed-staged-card-id]'
                          ),
                        ].indexOf(card.image),
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
                  inlineBottomPx:
                    Number.parseFloat(card.image.style.bottom) || 0,
                  attached: card.image.attached,
                  target: card.image.target,
                  relativeId: null,
                  energyLayer: card.image.energyLayer,
                  layer: card.image.layer,
                  sourcePath: new URL(card.image.currentSrc).pathname,
                };
              }),
              logicalOrder: logicalCards.map(
                (card) => card.image.dataset.legacyMixedStagedCardId ?? ''
              ),
              domOrder: directImages.map(
                (image) => image.dataset.legacyMixedStagedCardId ?? ''
              ),
              display: getComputedStyle(attachedCards).display,
            };
          };
          const deckSnapshot = (
            logicalCards: readonly StagedFixtureCard[]
          ): LegacyMixedDeckPhase => {
            const directImages = [
              ...deckElement.querySelectorAll<HTMLImageElement>(
                ':scope > [data-legacy-mixed-staged-card-id]'
              ),
            ];
            return {
              cards: logicalCards.map((card, logicalOrdinal) => {
                if (card.image.parentElement !== deckElement) {
                  throw new Error(`Deck ${card.role} has an invalid parent`);
                }
                const styles = getComputedStyle(card.image);
                const matrix = new DOMMatrixReadOnly(styles.transform);
                return {
                  id: card.image.dataset.legacyMixedStagedCardId ?? '',
                  role: card.role,
                  currentCategory: card.currentCategory,
                  parentZone: 'deck',
                  logicalOrdinal,
                  domOrdinal: directImages.indexOf(card.image),
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
                  inlineBottomPx:
                    Number.parseFloat(card.image.style.bottom) || 0,
                  attached: card.image.attached,
                  target: card.image.target,
                  relativeId: null,
                  energyLayer: card.image.energyLayer,
                  layer: card.image.layer,
                  sourcePath: new URL(card.image.currentSrc).pathname,
                };
              }),
              logicalOrder: logicalCards.map(
                (card) => card.image.dataset.legacyMixedStagedCardId ?? ''
              ),
              domOrder: directImages.map(
                (image) => image.dataset.legacyMixedStagedCardId ?? ''
              ),
            };
          };
          const snapshotRestored = (
            stack: HTMLElement,
            logicalCards: readonly StagedFixtureCard[]
          ): RawMixedRestoredPhase => {
            const stackCards = logicalCards.filter(
              (card) => card.image.parentElement === stack
            );
            const paintedBounds = new Map(
              stackCards.map((card) => [
                card,
                card.image.getBoundingClientRect(),
              ])
            );
            const untransformedBounds = new Map<StagedFixtureCard, DOMRect>();
            for (const card of stackCards) {
              const transform = card.image.style.transform;
              try {
                card.image.style.transform = 'none';
                untransformedBounds.set(
                  card,
                  card.image.getBoundingClientRect()
                );
              } finally {
                card.image.style.transform = transform;
              }
            }
            const idsAt = (point: CapturedPoint) =>
              document
                .elementsFromPoint(point.x, point.y)
                .flatMap((candidate) => {
                  const image = candidate.closest<HTMLImageElement>(
                    '[data-legacy-mixed-staged-card-id]'
                  );
                  return image?.dataset.legacyMixedStagedCardId &&
                    stackCards.some((card) => card.image === image)
                    ? [image.dataset.legacyMixedStagedCardId]
                    : [];
                })
                .filter((id, index, ids) => ids.indexOf(id) === index);
            const hitPointsFrameLocal: Record<string, CapturedPoint> = {};
            const allBounds = [...paintedBounds.values()];
            if (allBounds.length === 0) {
              throw new Error('Restored mixed stack has no cards');
            }
            const common = requireInterior(
              {
                left: Math.max(...allBounds.map((bounds) => bounds.left)) + 2,
                right: Math.min(...allBounds.map((bounds) => bounds.right)) - 2,
                top: Math.max(...allBounds.map((bounds) => bounds.top)) + 2,
                bottom:
                  Math.min(...allBounds.map((bounds) => bounds.bottom)) - 2,
              },
              'Restored mixed common overlap'
            );
            hitPointsFrameLocal['commonOverlap'] = center(common);
            for (const card of stackCards) {
              const bounds = paintedBounds.get(card);
              if (!bounds) throw new Error(`Restored ${card.role} lost bounds`);
              hitPointsFrameLocal[`center-${card.role}`] = center(bounds);
            }
            const rightmost = stackCards.reduce((selected, card) => {
              const selectedBounds = paintedBounds.get(selected);
              const cardBounds = paintedBounds.get(card);
              if (!selectedBounds || !cardBounds) {
                throw new Error('Restored mixed rightmost bounds are missing');
              }
              return cardBounds.right > selectedBounds.right ? card : selected;
            });
            const rightmostBounds = paintedBounds.get(rightmost);
            if (!rightmostBounds) {
              throw new Error('Restored mixed rightmost card is missing');
            }
            hitPointsFrameLocal['rightmostPaint'] = {
              x: rightmostBounds.right - 2,
              y: (rightmostBounds.top + rightmostBounds.bottom) / 2,
            };
            const stackBounds = stack.getBoundingClientRect();
            const stackStyles = getComputedStyle(stack);
            const observedWrappers = [
              ...active.querySelectorAll<HTMLElement>(
                '[data-legacy-mixed-staged-stack-id]'
              ),
            ];
            const base = stackCards.find((card) => card.role === 'base');
            if (!base) throw new Error('Restored mixed stack lacks its base');
            return {
              cards: stackCards.map((card) => {
                const painted = paintedBounds.get(card);
                const untransformed = untransformedBounds.get(card);
                if (!painted || !untransformed) {
                  throw new Error(`Restored ${card.role} bounds are missing`);
                }
                const styles = getComputedStyle(card.image);
                const matrix = new DOMMatrixReadOnly(styles.transform);
                return {
                  id: card.image.dataset.legacyMixedStagedCardId ?? '',
                  role: card.role,
                  currentCategory: card.currentCategory,
                  frameLocalBounds: rect(painted),
                  untransformedFrameLocalBounds: rect(untransformed),
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
                  attached: card.image.attached,
                  target: card.image.target,
                  relativeId:
                    card.image.relative instanceof HTMLImageElement
                      ? (card.image.relative.dataset.legacyMixedStagedCardId ??
                        null)
                      : null,
                  energyLayer: card.image.energyLayer,
                  layer: card.image.layer,
                  domOrdinal: [
                    ...stack.querySelectorAll<HTMLImageElement>(
                      ':scope > [data-legacy-mixed-staged-card-id]'
                    ),
                  ].indexOf(card.image),
                  logicalOrdinal: logicalCards.indexOf(card),
                };
              }),
              observedWrapperCount: observedWrappers.length,
              supersededWrapperConnected: observedWrappers.some(
                (candidate) => candidate !== stack
              ),
              stagingDisplay: getComputedStyle(attachedCards).display,
              stack: {
                id: stack.dataset.legacyMixedStagedStackId ?? '',
                frameLocalBounds: rect(stackBounds),
                baseClientWidth: base.image.clientWidth,
                baseEnergyLayer: base.image.energyLayer,
                clientWidth: stack.clientWidth,
                authoredWidthPx:
                  Number.parseFloat(stack.style.width) || stack.clientWidth,
                inlineMarginRight: stack.style.marginRight,
                computedMarginRightPx:
                  Number.parseFloat(stackStyles.marginRight) || 0,
                childDomOrder: [
                  ...stack.querySelectorAll<HTMLImageElement>(
                    ':scope > [data-legacy-mixed-staged-card-id]'
                  ),
                ].map((image) => image.dataset.legacyMixedStagedCardId ?? ''),
                logicalOrder: stackCards.map(
                  (card) => card.image.dataset.legacyMixedStagedCardId ?? ''
                ),
                hitOrder: Object.fromEntries(
                  Object.entries(hitPointsFrameLocal).map(([label, point]) => [
                    label,
                    idsAt(point),
                  ])
                ),
                hitPointsFrameLocal,
              },
            };
          };
          const leaveAll = (
            stagedCards: StagedFixtureCard[],
            prefix: string
          ) => {
            const logicalCards: StagedFixtureCard[] = [];
            let target: StagedFixtureCard | undefined;
            let stack: HTMLElement | undefined;
            let observer: MutationObserver | undefined;
            const trace: LegacyMixedAttachmentAttachTraceEntry[] = [];
            for (let index = stagedCards.length - 1; index >= 0; index -= 1) {
              const card = stagedCards[index];
              if (card?.currentCategory === 'Pokémon') {
                target = card;
                stagedCards.splice(index, 1);
                logicalCards.push(card);
                resetImage(card.image);
                stack = document.createElement('div');
                stack.className = 'play-container';
                stack.style.zIndex = '0';
                stack.dataset.legacyMixedStagedStackId = `${prefix}-restored-stack`;
                active.append(stack);
                stack.append(card.image);
                observer = observeEmptyStack(stack);
                break;
              }
            }
            for (let index = stagedCards.length - 1; index >= 0; index -= 1) {
              const card = stagedCards[index];
              if (card?.currentCategory === 'Pokémon') {
                throw new Error(
                  'This bounded mixed leaveAll fixture has multiple Pokémon'
                );
              }
            }
            if (!target || !stack) {
              throw new Error('Mixed leaveAll fixture lacks its base Pokémon');
            }
            const attachmentCount = stagedCards.length;
            for (let index = 0; index < attachmentCount; index += 1) {
              const moving = stagedCards[0];
              if (!moving) throw new Error('Mixed staged card disappeared');
              stagedCards.splice(0, 1);
              logicalCards.push(moving);
              attachCard(logicalCards, moving, target, stack, trace, true);
            }
            attachedCards.style.display = 'none';
            if (!observer) {
              throw new Error(
                'Mixed leaveAll fixture lacks its stack observer'
              );
            }
            return { logicalCards, stack, trace, observer };
          };
          const cleanupStagedFixture = (): LegacyFixtureCleanup => {
            body
              .querySelectorAll<HTMLElement>(
                '[data-legacy-mixed-staged-card-id], [data-legacy-mixed-staged-stack-id]'
              )
              .forEach((element) => element.remove());
            attachedCards.style.display = 'none';
            return {
              observedWrapperCount: active.querySelectorAll(
                '[data-legacy-mixed-staged-stack-id]'
              ).length,
              observedCardCount: body.querySelectorAll(
                '[data-legacy-mixed-staged-card-id]'
              ).length,
              sinkConnected: false,
            };
          };

          const attachmentCases: RawMixedAttachmentOrderCase[] = [];
          for (const order of [
            'energyThenTrainer',
            'trainerThenEnergy',
          ] as const) {
            active.replaceChildren();
            const sink = document.createElement('div');
            sink.dataset.legacyMixedAttachmentSink = order;
            body.append(sink);
            const prefix = `${input.side}-${order === 'energyThenTrainer' ? 'energy-trainer' : 'trainer-energy'}`;
            const cards = await buildCards(prefix, sink);
            const logicalCards: FixtureCard[] = [cards.base];
            const stackId = `${prefix}-mixed-stack`;
            const stack = makeStack(stackId);
            stack.append(cards.base.image);
            const attachTrace: LegacyMixedAttachmentAttachTraceEntry[] = [];
            const orderedAttachments =
              order === 'energyThenTrainer'
                ? [cards.energy, cards.trainerTool]
                : [cards.trainerTool, cards.energy];
            const first = orderedAttachments[0];
            const second = orderedAttachments[1];
            if (!first || !second) {
              throw new Error('Mixed attachment order is incomplete');
            }
            logicalCards.push(first);
            attachCard(
              logicalCards,
              first,
              cards.base,
              stack,
              attachTrace,
              true
            );
            const postFirstAttachment = snapshot(stack, logicalCards, null);
            logicalCards.push(second);
            attachCard(
              logicalCards,
              second,
              cards.base,
              stack,
              attachTrace,
              true
            );
            const immediatePostSecondAttachment = snapshot(
              stack,
              logicalCards,
              null
            );
            const refresh = reconstruct(logicalCards, stack, stackId);
            const synchronousPostRefresh = snapshot(
              refresh.nextStack,
              logicalCards,
              stack
            );
            await twoAnimationFrames();
            refresh.observer.disconnect();
            const stablePostRefresh = snapshot(
              refresh.nextStack,
              logicalCards,
              stack
            );
            refresh.nextStack.remove();
            sink.remove();
            attachmentCases.push({
              id: `${prefix}-attachment-order`,
              order,
              postFirstAttachment,
              immediatePostSecondAttachment,
              synchronousPostRefresh,
              stablePostRefresh,
              immediateAttachTrace: attachTrace,
              refreshAttachTrace: refresh.trace,
              cleanup: cleanup(sink),
            });
          }

          const departureCases: RawMixedAttachmentDepartureCase[] = [];
          for (const removedRole of ['energy', 'trainerTool'] as const) {
            active.replaceChildren();
            const sink = document.createElement('div');
            sink.dataset.legacyMixedAttachmentSink = `remove-${removedRole}`;
            body.append(sink);
            const prefix = `${input.side}-remove-${removedRole === 'trainerTool' ? 'trainer-tool' : 'energy'}`;
            const cards = await buildCards(prefix, sink);
            const logicalCards: FixtureCard[] = [cards.base];
            const stackId = `${prefix}-mixed-stack`;
            const initialStack = makeStack(stackId);
            initialStack.append(cards.base.image);
            const ignoredTrace: LegacyMixedAttachmentAttachTraceEntry[] = [];
            for (const card of [cards.energy, cards.trainerTool]) {
              logicalCards.push(card);
              attachCard(
                logicalCards,
                card,
                cards.base,
                initialStack,
                ignoredTrace,
                true
              );
            }
            const initialRefresh = reconstruct(
              logicalCards,
              initialStack,
              stackId
            );
            await twoAnimationFrames();
            initialRefresh.observer.disconnect();
            const stablePreDeparture = snapshot(
              initialRefresh.nextStack,
              logicalCards,
              initialStack
            );
            const removed =
              removedRole === 'energy' ? cards.energy : cards.trainerTool;
            const removedIndex = logicalCards.indexOf(removed);
            if (removedIndex < 0) {
              throw new Error('Mixed departure card is missing');
            }
            logicalCards.splice(removedIndex, 1);
            updateAttachedCardsPosition(logicalCards, removed);
            decreaseCardLayer(removed);
            resetImage(removed.image);
            sink.append(removed.image);
            const removedCardAfterDeparture = snapshotRemovedCard(
              removed,
              sink
            );
            const transientPostDeparture = snapshot(
              initialRefresh.nextStack,
              logicalCards,
              null
            );
            const refresh = reconstruct(
              logicalCards,
              initialRefresh.nextStack,
              stackId
            );
            const synchronousPostRefresh = snapshot(
              refresh.nextStack,
              logicalCards,
              initialRefresh.nextStack
            );
            await twoAnimationFrames();
            refresh.observer.disconnect();
            const stablePostRefresh = snapshot(
              refresh.nextStack,
              logicalCards,
              initialRefresh.nextStack
            );
            refresh.nextStack.remove();
            sink.remove();
            departureCases.push({
              id: `${prefix}-departure`,
              removedRole,
              stablePreDeparture,
              removedCardAfterDeparture,
              transientPostDeparture,
              synchronousPostRefresh,
              stablePostRefresh,
              cleanup: cleanup(sink),
            });
          }

          const restoreCases: RawMixedRestoreCase[] = [];
          for (const scenario of ['reverseTwo', 'interleavedFour'] as const) {
            active.replaceChildren();
            cleanupStagedFixture();
            const prefix = `${input.side}-restore-${
              scenario === 'reverseTwo' ? 'reverse-two' : 'interleaved-four'
            }`;
            const roles: readonly LegacyMixedStagedRole[] =
              scenario === 'reverseTwo'
                ? ['base', 'trainerToolOne', 'energyOne']
                : [
                    'base',
                    'trainerToolOne',
                    'energyOne',
                    'trainerToolTwo',
                    'energyTwo',
                  ];
            const stagedCards = await buildStagedCards(prefix, roles);
            const stagedBeforeRestore = stagedSnapshot(stagedCards);
            const restored = leaveAll(stagedCards, prefix);
            const immediatePostRestore = snapshotRestored(
              restored.stack,
              restored.logicalCards
            );
            await twoAnimationFrames();
            const settledPostRestore = snapshotRestored(
              restored.stack,
              restored.logicalCards
            );
            restored.observer.disconnect();
            restoreCases.push({
              id: `${prefix}-case`,
              scenario,
              stagedBeforeRestore,
              immediatePostRestore,
              settledPostRestore,
              attachTrace: restored.trace,
              cleanup: cleanupStagedFixture(),
            });
          }

          active.replaceChildren();
          cleanupStagedFixture();
          const swapPrefix = `${input.side}-staged-multi-swap`;
          const stagedCards = await buildStagedCards(swapPrefix, [
            'base',
            'trainerToolOne',
            'energyOne',
            'trainerToolTwo',
            'energyTwo',
          ]);
          const deckCards = await buildStagedCards(swapPrefix, [
            'deckTopTrainerTool',
            'deckRemainderEnergy',
          ]);
          for (const card of deckCards) {
            deckElement.append(card.image);
          }
          const deckCardsLogical = [...deckCards];
          const resetTrace: LegacyMixedSwapResetTraceEntry[] = [];
          const resetSwapCard = (
            card: StagedFixtureCard,
            phase: LegacyMixedSwapResetTraceEntry['phase']
          ) => {
            resetImage(card.image);
            resetTrace.push({
              phase,
              cardId: card.image.dataset.legacyMixedStagedCardId ?? '',
            });
          };
          const stagedBeforeSwap = stagedSnapshot(stagedCards);
          const deckBeforeSwap = deckSnapshot(deckCardsLogical);
          const selected = stagedCards.find(
            (card) => card.role === 'energyOne'
          );
          const priorDeckTop = deckCardsLogical[0];
          if (!selected || !priorDeckTop) {
            throw new Error(
              'Mixed staged swap lacks selected or deck-top card'
            );
          }
          const selectedIndex = stagedCards.indexOf(selected);
          stagedCards.splice(selectedIndex, 1);
          deckCardsLogical.push(selected);
          resetSwapCard(selected, 'selectedToDeck');
          deckElement.append(selected.image);
          const stagedAfterSelectedDeparture = stagedSnapshot(stagedCards);
          const deckAfterSelectedDeparture = deckSnapshot(deckCardsLogical);
          const initialDeckCount = deckCardsLogical.length;
          for (let index = 0; index < initialDeckCount - 1; index += 1) {
            const moving = deckCardsLogical.shift();
            if (!moving) throw new Error('Mixed staged swap deck is empty');
            deckCardsLogical.push(moving);
            resetSwapCard(moving, 'deckRotation');
            deckElement.append(moving.image);
          }
          const deckAfterRotation = deckSnapshot(deckCardsLogical);
          const returned = deckCardsLogical[1];
          if (returned !== priorDeckTop) {
            throw new Error('Mixed staged swap did not retain the prior top');
          }
          deckCardsLogical.splice(1, 1);
          stagedCards.push(returned);
          resetSwapCard(returned, 'priorTopToStaging');
          attachedCards.append(returned.image);
          attachedCards.style.display = 'block';
          const stagedAfterSwap = stagedSnapshot(stagedCards);
          const deckAfterSwap = deckSnapshot(deckCardsLogical);
          const restoredSwap = leaveAll(stagedCards, swapPrefix);
          const immediatePostRestore = snapshotRestored(
            restoredSwap.stack,
            restoredSwap.logicalCards
          );
          await twoAnimationFrames();
          const settledPostRestore = snapshotRestored(
            restoredSwap.stack,
            restoredSwap.logicalCards
          );
          restoredSwap.observer.disconnect();
          const stagedSwapCases: RawMixedStagedSwapCase[] = [
            {
              id: `${swapPrefix}-case`,
              selectedCardId:
                selected.image.dataset.legacyMixedStagedCardId ?? '',
              priorDeckTopCardId:
                priorDeckTop.image.dataset.legacyMixedStagedCardId ?? '',
              stagedBeforeSwap,
              deckBeforeSwap,
              stagedAfterSelectedDeparture,
              deckAfterSelectedDeparture,
              deckAfterRotation,
              stagedAfterSwap,
              deckAfterSwap,
              resetTrace,
              immediatePostRestore,
              settledPostRestore,
              attachTrace: restoredSwap.trace,
              cleanup: cleanupStagedFixture(),
            },
          ];
          return {
            attachmentCases,
            departureCases,
            restoreCases,
            stagedSwapCases,
          };
        },
        { side }
      );
    rawAttachmentCases.push(
      ...captured.attachmentCases.map((value) => ({ side, value }))
    );
    rawDepartureCases.push(
      ...captured.departureCases.map((value) => ({ side, value }))
    );
    rawRestoreCases.push(
      ...captured.restoreCases.map((value) => ({ side, value }))
    );
    rawStagedSwapCases.push(
      ...captured.stagedSwapCases.map((value) => ({ side, value }))
    );
  }

  const physicalRect = (
    side: LegacyFixtureSide,
    bounds: CapturedRect
  ): CapturedRect =>
    side === 'local'
      ? {
          x: frames.local.x + bounds.x,
          y: frames.local.y + bounds.y,
          width: bounds.width,
          height: bounds.height,
        }
      : {
          x:
            frames.opponent.x + frames.opponent.width - bounds.x - bounds.width,
          y:
            frames.opponent.y +
            frames.opponent.height -
            bounds.y -
            bounds.height,
          width: bounds.width,
          height: bounds.height,
        };
  const physicalPoint = (
    side: LegacyFixtureSide,
    point: CapturedPoint
  ): CapturedPoint =>
    side === 'local'
      ? { x: frames.local.x + point.x, y: frames.local.y + point.y }
      : {
          x: frames.opponent.x + frames.opponent.width - point.x,
          y: frames.opponent.y + frames.opponent.height - point.y,
        };
  const convertPhase = (
    side: LegacyFixtureSide,
    phase: RawMixedAttachmentPhase
  ): LegacyMixedAttachmentFixturePhase => ({
    ...phase,
    cards: phase.cards.map((card) => ({
      ...card,
      side,
      physicalBounds: physicalRect(side, card.frameLocalBounds),
      untransformedPhysicalBounds: physicalRect(
        side,
        card.untransformedFrameLocalBounds
      ),
      effectiveRotationDegrees:
        (card.localRotationDegrees + frameTransforms[side].rotationDegrees) %
        360,
    })),
    stack: {
      ...phase.stack,
      side,
      physicalBounds: physicalRect(side, phase.stack.frameLocalBounds),
      hitPointsPhysical: Object.fromEntries(
        Object.entries(phase.stack.hitPointsFrameLocal).map(
          ([label, point]) => [label, physicalPoint(side, point)]
        )
      ),
    },
  });
  const attachmentCases = rawAttachmentCases.map(
    ({ side, value }): LegacyMixedAttachmentOrderFixtureCase => ({
      ...value,
      side,
      postFirstAttachment: convertPhase(side, value.postFirstAttachment),
      immediatePostSecondAttachment: convertPhase(
        side,
        value.immediatePostSecondAttachment
      ),
      synchronousPostRefresh: convertPhase(side, value.synchronousPostRefresh),
      stablePostRefresh: convertPhase(side, value.stablePostRefresh),
    })
  );
  const departureCases = rawDepartureCases.map(
    ({ side, value }): LegacyMixedAttachmentDepartureFixtureCase => ({
      ...value,
      side,
      stablePreDeparture: convertPhase(side, value.stablePreDeparture),
      removedCardAfterDeparture: {
        ...value.removedCardAfterDeparture,
        side,
        effectiveRotationDegrees:
          (value.removedCardAfterDeparture.localRotationDegrees +
            frameTransforms[side].rotationDegrees) %
          360,
      },
      transientPostDeparture: convertPhase(side, value.transientPostDeparture),
      synchronousPostRefresh: convertPhase(side, value.synchronousPostRefresh),
      stablePostRefresh: convertPhase(side, value.stablePostRefresh),
    })
  );
  const convertRestoredPhase = (
    side: LegacyFixtureSide,
    phase: RawMixedRestoredPhase
  ): LegacyMixedRestoredPhase => ({
    ...phase,
    cards: phase.cards.map((card) => ({
      ...card,
      physicalBounds: physicalRect(side, card.frameLocalBounds),
      untransformedPhysicalBounds: physicalRect(
        side,
        card.untransformedFrameLocalBounds
      ),
      effectiveRotationDegrees:
        (card.localRotationDegrees + frameTransforms[side].rotationDegrees) %
        360,
    })),
    stack: {
      ...phase.stack,
      side,
      physicalBounds: physicalRect(side, phase.stack.frameLocalBounds),
      hitPointsPhysical: Object.fromEntries(
        Object.entries(phase.stack.hitPointsFrameLocal).map(
          ([label, point]) => [label, physicalPoint(side, point)]
        )
      ),
    },
  });
  const restoreCases = rawRestoreCases.map(
    ({ side, value }): LegacyMixedRestoreFixtureCase => ({
      ...value,
      side,
      immediatePostRestore: convertRestoredPhase(
        side,
        value.immediatePostRestore
      ),
      settledPostRestore: convertRestoredPhase(side, value.settledPostRestore),
    })
  );
  const stagedSwapCases = rawStagedSwapCases.map(
    ({ side, value }): LegacyMixedStagedSwapFixtureCase => ({
      ...value,
      side,
      immediatePostRestore: convertRestoredPhase(
        side,
        value.immediatePostRestore
      ),
      settledPostRestore: convertRestoredPhase(side, value.settledPostRestore),
    })
  );

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames,
    frameTransforms,
    attachmentCases,
    departureCases,
    restoreCases,
    stagedSwapCases,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

const canonicalTrainerToolFixtureCardIds = (side: LegacyFixtureSide) =>
  [`${side}-tool-base`, `${side}-tool-attachment`] as const;

const captureCanonicalTrainerToolCard = async (
  locator: Locator,
  side: LegacyFixtureSide,
  role: LegacyTrainerToolAttachmentFixtureCard['role'],
  frameRotationDegrees: number,
  frameBounds: CapturedRect
): Promise<LegacyTrainerToolAttachmentFixtureCard> => {
  const physicalBounds = await requireRect(
    locator,
    `${side} canonical Trainer-as-Tool ${role} card`
  );
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error(
        'Legacy canonical Trainer-as-Tool target must be an image'
      );
    }
    const legacyImage = element as HTMLImageElement & {
      attached?: boolean;
      target?: string;
      relative?: unknown;
      energyLayer?: number;
      layer?: number;
    };
    const bounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const transform =
      styles.transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(styles.transform);
    const computedWidthPx = Number.parseFloat(styles.width);
    const computedHeightPx = Number.parseFloat(styles.height);
    const inlineLeftPx = Number.parseFloat(element.style.left) || 0;
    const inlineBottomPx = Number.parseFloat(element.style.bottom) || 0;
    const inlineTransform = element.style.transform;
    let untransformedBounds: DOMRect;
    try {
      element.style.transform = 'none';
      untransformedBounds = element.getBoundingClientRect();
    } finally {
      element.style.transform = inlineTransform;
    }
    const parentImages = element.parentElement
      ? [...element.parentElement.querySelectorAll(':scope > img')]
      : [];
    return {
      id: element.dataset.legacyCanonicalTrainerToolCardId ?? '',
      frameLocalBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      untransformedFrameLocalBounds: {
        x: untransformedBounds.x,
        y: untransformedBounds.y,
        width: untransformedBounds.width,
        height: untransformedBounds.height,
      },
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      offsetWidth: element.offsetWidth,
      offsetHeight: element.offsetHeight,
      computedWidthPx,
      computedHeightPx,
      localRotationDegrees:
        ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) % 360,
      transformMatrix: {
        a: transform.a,
        b: transform.b,
        c: transform.c,
        d: transform.d,
      },
      transformOrigin: styles.transformOrigin,
      zIndex: Number.parseInt(styles.zIndex, 10) || 0,
      inlineLeftPx,
      inlineBottomPx,
      attached: legacyImage.attached === true,
      target: legacyImage.target ?? '',
      relativeId:
        legacyImage.relative instanceof HTMLImageElement
          ? (legacyImage.relative.dataset.legacyCanonicalTrainerToolCardId ??
            null)
          : null,
      energyLayer: legacyImage.energyLayer ?? 0,
      layer: legacyImage.layer ?? 0,
      domOrdinal: parentImages.indexOf(element),
      sourcePath: new URL(element.currentSrc).pathname,
    };
  });
  const untransformedPhysicalBounds =
    side === 'local'
      ? {
          x: frameBounds.x + details.untransformedFrameLocalBounds.x,
          y: frameBounds.y + details.untransformedFrameLocalBounds.y,
          width: details.untransformedFrameLocalBounds.width,
          height: details.untransformedFrameLocalBounds.height,
        }
      : {
          x:
            frameBounds.x +
            frameBounds.width -
            details.untransformedFrameLocalBounds.x -
            details.untransformedFrameLocalBounds.width,
          y:
            frameBounds.y +
            frameBounds.height -
            details.untransformedFrameLocalBounds.y -
            details.untransformedFrameLocalBounds.height,
          width: details.untransformedFrameLocalBounds.width,
          height: details.untransformedFrameLocalBounds.height,
        };
  return {
    ...details,
    side,
    role,
    physicalBounds,
    untransformedPhysicalBounds,
    effectiveRotationDegrees:
      (details.localRotationDegrees + frameRotationDegrees) % 360,
  };
};

const captureCanonicalTrainerToolStack = async (
  locator: Locator,
  side: LegacyFixtureSide
): Promise<LegacyTrainerToolAttachmentFixtureStack> => {
  const physicalBounds = await requireRect(
    locator,
    `${side} canonical Trainer-as-Tool stack`
  );
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error(
        'Legacy canonical Trainer-as-Tool stack must be an element'
      );
    }
    const card = (role: 'base' | 'attachment') => {
      const match = element.querySelector<HTMLImageElement>(
        `[data-legacy-canonical-trainer-tool-card-id$="-${role}"]`
      );
      if (!match) throw new Error(`Missing canonical Trainer-as-Tool ${role}`);
      return match;
    };
    const base = card('base');
    const tool = card('attachment');
    const baseBounds = base.getBoundingClientRect();
    const toolBounds = tool.getBoundingClientRect();
    const inlineToolTransform = tool.style.transform;
    let untransformedToolBounds: DOMRect;
    try {
      tool.style.transform = 'none';
      untransformedToolBounds = tool.getBoundingClientRect();
    } finally {
      tool.style.transform = inlineToolTransform;
    }
    const idsAt = (x: number, y: number) =>
      document
        .elementsFromPoint(x, y)
        .flatMap((candidate) => {
          const image = candidate.closest<HTMLImageElement>(
            '[data-legacy-canonical-trainer-tool-card-id]'
          );
          return image?.dataset.legacyCanonicalTrainerToolCardId
            ? [image.dataset.legacyCanonicalTrainerToolCardId]
            : [];
        })
        .filter((id, index, ids) => ids.indexOf(id) === index);
    const intersection = (rectangles: readonly DOMRect[]) => {
      const left = Math.max(...rectangles.map((bounds) => bounds.left));
      const top = Math.max(...rectangles.map((bounds) => bounds.top));
      const right = Math.min(...rectangles.map((bounds) => bounds.right));
      const bottom = Math.min(...rectangles.map((bounds) => bounds.bottom));
      if (right - left <= 2 || bottom - top <= 2) {
        throw new Error('Trainer-as-Tool overlap lacks a safe interior');
      }
      return { left, top, right, bottom };
    };
    const common = intersection([baseBounds, toolBounds]);
    const toolOnly = {
      left: Math.max(baseBounds.right, untransformedToolBounds.right) + 2,
      right: toolBounds.right - 2,
    };
    if (toolOnly.right - toolOnly.left <= 0) {
      throw new Error('Trainer-as-Tool-only strip lacks a safe interior');
    }
    const baseOnly = {
      top: baseBounds.top + 2,
      bottom: toolBounds.top - 2,
    };
    if (baseOnly.bottom - baseOnly.top <= 0) {
      throw new Error('Trainer-as-Tool base-only strip lacks a safe interior');
    }
    const authoredLayoutOnly = {
      left: baseBounds.right + 2,
      right: untransformedToolBounds.right - 2,
      top: toolBounds.bottom + 2,
      bottom: untransformedToolBounds.bottom - 2,
    };
    if (
      authoredLayoutOnly.right - authoredLayoutOnly.left <= 0 ||
      authoredLayoutOnly.bottom - authoredLayoutOnly.top <= 0
    ) {
      throw new Error(
        'Trainer-as-Tool authored-layout-only region lacks a safe interior'
      );
    }
    const hitPointsFrameLocal = {
      commonOverlap: {
        x: (common.left + common.right) / 2,
        y: (common.top + common.bottom) / 2,
      },
      toolOnly: {
        x: (toolOnly.left + toolOnly.right) / 2,
        y: toolBounds.top + toolBounds.height / 2,
      },
      baseOnly: {
        x: baseBounds.left + baseBounds.width / 2,
        y: (baseOnly.top + baseOnly.bottom) / 2,
      },
      authoredLayoutOnly: {
        x: (authoredLayoutOnly.left + authoredLayoutOnly.right) / 2,
        y: (authoredLayoutOnly.top + authoredLayoutOnly.bottom) / 2,
      },
    };
    const frameLocalBounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return {
      id: element.dataset.legacyCanonicalTrainerToolStackId ?? '',
      frameLocalBounds: {
        x: frameLocalBounds.x,
        y: frameLocalBounds.y,
        width: frameLocalBounds.width,
        height: frameLocalBounds.height,
      },
      baseClientWidth: base.clientWidth,
      clientWidth: element.clientWidth,
      authoredWidthPx: Number.parseFloat(element.style.width),
      attachmentClientWidthsBefore: JSON.parse(
        element.dataset.legacyTrainerToolClientWidthsBefore ?? '[]'
      ) as number[],
      attachmentAuthoredWidthsPx: JSON.parse(
        element.dataset.legacyTrainerToolAuthoredWidths ?? '[]'
      ) as number[],
      inlineMarginRight: element.style.marginRight,
      inlineMarginLeft: element.style.marginLeft,
      computedMarginRightPx: Number.parseFloat(styles.marginRight) || 0,
      computedMarginLeftPx: Number.parseFloat(styles.marginLeft) || 0,
      transientPostAttach: JSON.parse(
        element.dataset.legacyTransientTrainerToolStage ?? '{}'
      ) as LegacyTrainerToolAttachmentFixtureStack['transientPostAttach'],
      synchronousPostRefreshContainerCount: Number.parseInt(
        element.dataset.legacyTrainerToolSynchronousContainerCount ?? '',
        10
      ),
      oldContainerConnectedImmediatelyAfterRefresh:
        element.dataset.legacyTrainerToolOldContainerConnectedImmediately ===
        'true',
      stableContainerCount:
        element.parentElement?.querySelectorAll(
          '[data-legacy-canonical-trainer-tool-stack-id]'
        ).length ?? 0,
      oldContainerConnected:
        element.dataset.legacyTrainerToolOldContainerConnected === 'true',
      childDomOrder: [
        ...element.querySelectorAll<HTMLImageElement>(':scope > img'),
      ].map((image) => image.dataset.legacyCanonicalTrainerToolCardId ?? ''),
      logicalOrder: JSON.parse(
        element.dataset.legacyTrainerToolLogicalOrder ?? '[]'
      ) as string[],
      hitOrder: {
        commonOverlap: idsAt(
          hitPointsFrameLocal.commonOverlap.x,
          hitPointsFrameLocal.commonOverlap.y
        ),
        toolOnly: idsAt(
          hitPointsFrameLocal.toolOnly.x,
          hitPointsFrameLocal.toolOnly.y
        ),
        baseOnly: idsAt(
          hitPointsFrameLocal.baseOnly.x,
          hitPointsFrameLocal.baseOnly.y
        ),
        authoredLayoutOnly: idsAt(
          hitPointsFrameLocal.authoredLayoutOnly.x,
          hitPointsFrameLocal.authoredLayoutOnly.y
        ),
      },
      hitPointsFrameLocal,
    };
  });
  return { ...details, side, physicalBounds };
};

/**
 * Isolates one v1 Trainer attached as a Tool to an active Pokémon across the
 * immediate attach and stable post-refresh phases. Application modules remain
 * inert; the DOM/state mutations narrowly transcribe the checked-in sources.
 */
export const captureLegacySourceTrainerToolAttachmentReflowFixture = async (
  page: Page
): Promise<LegacySourceTrainerToolAttachmentReflowFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (body, input) => {
          const makeImage = (id: string) => {
            const image = document.createElement('img') as HTMLImageElement & {
              attached: boolean;
              target: string;
              relative: HTMLImageElement | number;
              energyLayer: number;
              layer: number;
            };
            image.dataset.legacyCanonicalTrainerToolCardId = id;
            image.alt = '';
            image.src = `${location.origin}/src/assets/cardback.png`;
            image.style.opacity = '1';
            image.style.position = 'relative';
            image.style.bottom = '0%';
            image.style.zIndex = '0';
            image.style.left = '0px';
            image.style.transform = 'rotate(0deg)';
            image.attached = false;
            image.target = 'off';
            image.relative = 0;
            image.energyLayer = 0;
            image.layer = 0;
            return image;
          };
          const active = body.querySelector('#active');
          if (!(active instanceof HTMLElement)) {
            throw new Error('Legacy canonical active region is missing');
          }
          const stack = document.createElement('div');
          stack.className = 'play-container';
          stack.style.zIndex = '0';
          stack.dataset.legacyCanonicalTrainerToolStackId = `${input.side}-canonical-trainer-tool-stack`;
          const [baseId, toolId] = input.cardIds;
          const base = makeImage(baseId);
          const tool = makeImage(toolId);
          stack.append(base);
          active.append(stack);
          await Promise.all([base, tool].map((image) => image.decode()));

          const attachTool = (
            image: HTMLImageElement,
            targetStack: HTMLElement,
            clientWidthsBefore: number[],
            authoredWidths: number[]
          ) => {
            const attachedImage = image as typeof base;
            attachedImage.attached = true;
            attachedImage.target = 'on';
            attachedImage.relative = base;
            image.style.position = 'absolute';
            const adjustment = base.clientWidth / 6;
            base.energyLayer += 1;
            image.style.left = `${adjustment}px`;
            image.style.zIndex = String(-base.energyLayer);
            clientWidthsBefore.push(targetStack.clientWidth);
            targetStack.style.width = `${Number.parseFloat(String(targetStack.clientWidth)) + adjustment}px`;
            authoredWidths.push(Number.parseFloat(targetStack.style.width));
            base.after(image);
            targetStack.style.marginRight = '2%';
            image.style.transform = 'rotate(90deg)';
          };
          const transientClientWidthsBefore: number[] = [];
          const transientAuthoredWidths: number[] = [];
          attachTool(
            tool,
            stack,
            transientClientWidthsBefore,
            transientAuthoredWidths
          );
          const transientStyles = getComputedStyle(stack);
          const transientPostAttach = {
            logicalOrder: [baseId, toolId],
            domOrder: [
              ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
            ].map(
              (image) => image.dataset.legacyCanonicalTrainerToolCardId ?? ''
            ),
            clientWidth: stack.clientWidth,
            authoredWidthPx: Number.parseFloat(stack.style.width),
            inlineMarginRight: stack.style.marginRight,
            computedMarginRightPx:
              Number.parseFloat(transientStyles.marginRight) || 0,
          };

          const oldStack = stack;
          const oldStackObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              const removedNode = mutation.removedNodes[0];
              if (
                removedNode?.nodeName === 'IMG' &&
                oldStack.getElementsByTagName('img').length === 0
              ) {
                oldStack.remove();
              }
            }
          });
          oldStackObserver.observe(oldStack, { childList: true });
          const stableStack = document.createElement('div');
          stableStack.className = 'play-container';
          stableStack.style.zIndex = '0';
          stableStack.dataset.legacyCanonicalTrainerToolStackId = `${input.side}-canonical-trainer-tool-stack`;
          base.style.opacity = '1';
          base.style.position = 'relative';
          base.style.bottom = '0%';
          base.style.zIndex = '0';
          base.style.left = '0px';
          base.style.transform = 'rotate(0deg)';
          base.attached = false;
          base.target = 'off';
          base.relative = 0;
          base.energyLayer = 0;
          base.layer = 0;
          stableStack.append(base);
          active.append(stableStack);
          tool.style.opacity = '1';
          tool.style.position = 'relative';
          tool.style.bottom = '0%';
          tool.style.zIndex = '0';
          tool.style.left = '0px';
          tool.style.transform = 'rotate(0deg)';
          tool.attached = false;
          tool.target = 'off';
          tool.relative = 0;
          tool.energyLayer = 0;
          tool.layer = 0;
          const stableClientWidthsBefore: number[] = [];
          const stableAuthoredWidths: number[] = [];
          attachTool(
            tool,
            stableStack,
            stableClientWidthsBefore,
            stableAuthoredWidths
          );
          stableStack.style.width = `${base.clientWidth + base.clientWidth / 6}px`;
          stableStack.dataset.legacyTrainerToolClientWidthsBefore =
            JSON.stringify(stableClientWidthsBefore);
          stableStack.dataset.legacyTrainerToolAuthoredWidths =
            JSON.stringify(stableAuthoredWidths);
          stableStack.dataset.legacyTransientTrainerToolStage =
            JSON.stringify(transientPostAttach);
          stableStack.dataset.legacyTrainerToolLogicalOrder = JSON.stringify([
            baseId,
            toolId,
          ]);
          stableStack.dataset.legacyTrainerToolSynchronousContainerCount =
            String(
              active.querySelectorAll(
                '[data-legacy-canonical-trainer-tool-stack-id]'
              ).length
            );
          stableStack.dataset.legacyTrainerToolOldContainerConnectedImmediately =
            String(oldStack.isConnected);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          oldStackObserver.disconnect();
          stableStack.dataset.legacyTrainerToolOldContainerConnected = String(
            oldStack.isConnected
          );
        },
        { side, cardIds: canonicalTrainerToolFixtureCardIds(side) }
      );
  }

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const frames = {
    local: await requireRect(page.locator('#selfContainer'), '#selfContainer'),
    opponent: await requireRect(page.locator('#oppContainer'), '#oppContainer'),
  };
  const cards: LegacyTrainerToolAttachmentFixtureCard[] = [];
  const stacks: LegacyTrainerToolAttachmentFixtureStack[] = [];
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const frame = page.frameLocator(frameSelector);
    for (const [id, role] of [
      [`${side}-tool-base`, 'base'],
      [`${side}-tool-attachment`, 'tool'],
    ] as const) {
      cards.push(
        await captureCanonicalTrainerToolCard(
          frame.locator(`[data-legacy-canonical-trainer-tool-card-id="${id}"]`),
          side,
          role,
          frameTransforms[side].rotationDegrees,
          frames[side]
        )
      );
    }
    stacks.push(
      await captureCanonicalTrainerToolStack(
        frame.locator(
          `[data-legacy-canonical-trainer-tool-stack-id="${side}-canonical-trainer-tool-stack"]`
        ),
        side
      )
    );
  }
  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames,
    frameTransforms,
    cards,
    stacks,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

/**
 * Constructs the one cover image emitted by v1 for each contained pile and
 * records both owner-readable stadium orientations. This is a source-pinned
 * DOM transcription: application modules stay inert and no room is contacted.
 */
export const captureLegacySourceContainedCardFixture = async (
  page: Page
): Promise<LegacySourceContainedCardFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(async (body, fixtureSide) => {
        const resetImageOutput = (image: HTMLImageElement) => {
          image.style.opacity = '1';
          image.style.position = 'relative';
          image.style.bottom = '0%';
          image.style.zIndex = '0';
          image.style.left = '0px';
          image.style.transform = 'rotate(0deg)';
        };
        const images: HTMLImageElement[] = [];
        for (const [kind, selector] of [
          ['lostZone', '#lostZoneCover'],
          ['deck', '#deckCover'],
          ['discard', '#discardCover'],
        ] as const) {
          const container = body.querySelector(selector);
          if (!(container instanceof HTMLElement)) {
            throw new Error(`Missing legacy contained-card region ${selector}`);
          }
          const image = document.createElement('img');
          image.dataset.legacyContainedCardId = `${fixtureSide}-${kind}-cover`;
          image.alt = '';
          image.src = `${location.origin}/src/assets/cardback.png`;
          resetImageOutput(image);
          container.replaceChildren(image);
          images.push(image);
        }
        await Promise.all(images.map((image) => image.decode()));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      }, side);
  }

  const stadiumImage = page.locator('#stadium').evaluate(async (container) => {
    if (!(container instanceof HTMLElement)) {
      throw new Error('Missing legacy stadium');
    }
    const image = document.createElement('img');
    image.dataset.legacyContainedCardId = 'shared-stadium';
    image.alt = '';
    image.src = `${location.origin}/src/assets/cardback.png`;
    image.style.opacity = '1';
    image.style.position = 'relative';
    image.style.bottom = '0%';
    image.style.zIndex = '0';
    image.style.left = '0px';
    image.style.transform = 'rotate(0deg)';
    container.replaceChildren(image);
    await image.decode();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });
  await stadiumImage;

  const cards: LegacyContainedCardFixtureCard[] = [];
  const frameRotations = {
    local: (await captureFrameTransform(page.locator('#selfContainer')))
      .rotationDegrees,
    opponent: (await captureFrameTransform(page.locator('#oppContainer')))
      .rotationDegrees,
  };
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const frame = page.frameLocator(frameSelector);
    for (const [kind, selector] of [
      ['lostZone', '#lostZoneCover'],
      ['deck', '#deckCover'],
      ['discard', '#discardCover'],
    ] as const) {
      cards.push(
        await captureContainedCard(
          frame.locator(
            `[data-legacy-contained-card-id="${side}-${kind}-cover"]`
          ),
          frame.locator(selector),
          { kind, side, readableBy: side },
          frameRotations[side]
        )
      );
    }
  }

  const stadium = page.locator('#stadium');
  const stadiumCard = page.locator(
    '[data-legacy-contained-card-id="shared-stadium"]'
  );
  await stadium.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return;
    element.style.transform = 'scaleX(1) scaleY(1)';
  });
  cards.push(
    await captureContainedCard(stadiumCard, stadium, {
      kind: 'stadium',
      side: 'shared',
      readableBy: 'local',
    })
  );
  await stadium.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return;
    element.style.transform = 'scaleX(-1) scaleY(-1)';
  });
  cards.push(
    await captureContainedCard(stadiumCard, stadium, {
      kind: 'stadium',
      side: 'shared',
      readableBy: 'opponent',
    })
  );

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  return { cards, sourceFulfillment: sourceFulfillment(loaded) };
};

const evolutionFixtureAssetPaths = new Set(['/src/assets/cardback.png']);

const evolutionFixtureCardIds = (
  side: LegacyFixtureSide,
  slot: 'active' | 'bench'
) =>
  [
    `${side}-${slot}-evolution-base`,
    `${side}-${slot}-evolution-middle`,
    `${side}-${slot}-evolution-top`,
  ] as const;

const captureEvolutionFixtureCard = async (
  locator: Locator,
  side: LegacyFixtureSide,
  role: LegacyEvolutionCardRole,
  frameRotationDegrees: number
): Promise<LegacyEvolutionFixtureCard> => {
  const physicalBounds = await requireRect(
    locator,
    `${side} ${role} evolution card`
  );
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('Legacy evolution fixture target must be an image');
    }
    type EvolutionImage = HTMLImageElement & {
      readonly attached?: boolean;
      readonly target?: string;
      readonly relative?: EvolutionImage | 0;
      readonly layer?: number;
      readonly energyLayer?: number;
    };
    const image = element as EvolutionImage;
    const bounds = image.getBoundingClientRect();
    const styles = getComputedStyle(image);
    const transform =
      styles.transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(styles.transform);
    const container = image.closest<HTMLElement>(
      '[data-legacy-evolution-stack-id]'
    );
    if (!container) throw new Error('Evolution card is outside its stack');
    const domImages = [
      ...container.querySelectorAll<HTMLImageElement>(':scope > img'),
    ];
    const logicalOrder = JSON.parse(
      container.dataset.legacyEvolutionLogicalOrder ?? '[]'
    ) as string[];
    return {
      id: image.dataset.legacyEvolutionCardId ?? '',
      frameLocalBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      clientWidth: image.clientWidth,
      clientHeight: image.clientHeight,
      localRotationDegrees:
        ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) % 360,
      zIndex: Number.parseInt(styles.zIndex, 10) || 0,
      layer: image.layer ?? 0,
      energyLayer: image.energyLayer ?? 0,
      inlineLeftPx: Number.parseFloat(image.style.left) || 0,
      inlineBottomPx: Number.parseFloat(image.style.bottom) || 0,
      position: styles.position,
      attached: image.attached === true,
      target: image.target ?? '',
      relativeId:
        image.relative instanceof HTMLImageElement
          ? (image.relative.dataset.legacyEvolutionCardId ?? null)
          : null,
      domOrdinal: domImages.indexOf(image),
      logicalOrdinal: logicalOrder.indexOf(
        image.dataset.legacyEvolutionCardId ?? ''
      ),
      sourcePath: new URL(image.currentSrc).pathname,
    };
  });
  return {
    ...details,
    side,
    role,
    physicalBounds,
    effectiveRotationDegrees:
      (details.localRotationDegrees + frameRotationDegrees) % 360,
  };
};

const captureEvolutionFixtureStack = async (
  locator: Locator,
  side: LegacyFixtureSide
): Promise<LegacyEvolutionFixtureStack> => {
  const physicalBounds = await requireRect(locator, `${side} evolution stack`);
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('Legacy evolution stack target must be an element');
    }
    type EvolutionImage = HTMLImageElement & {
      readonly layer?: number;
    };
    const fixture = JSON.parse(
      element.dataset.legacyEvolutionResult ?? '{}'
    ) as Omit<
      LegacyEvolutionFixtureStack,
      | 'id'
      | 'side'
      | 'physicalBounds'
      | 'frameLocalBounds'
      | 'topClientWidth'
      | 'topLayer'
      | 'childDomOrder'
      | 'logicalOrder'
      | 'hitOrder'
    >;
    const card = (suffix: 'base' | 'middle' | 'top') => {
      const match = element.querySelector<HTMLImageElement>(
        `[data-legacy-evolution-card-id$="-${suffix}"]`
      );
      if (!match) throw new Error(`Missing evolution fixture card ${suffix}`);
      return match as EvolutionImage;
    };
    const base = card('base');
    const middle = card('middle');
    const top = card('top');
    const baseBounds = base.getBoundingClientRect();
    const middleBounds = middle.getBoundingClientRect();
    const topBounds = top.getBoundingClientRect();
    const idsAt = (x: number, y: number) =>
      document
        .elementsFromPoint(x, y)
        .flatMap((candidate) =>
          candidate instanceof HTMLImageElement &&
          candidate.dataset.legacyEvolutionCardId
            ? [candidate.dataset.legacyEvolutionCardId]
            : []
        );
    const intersectionCenter = (rectangles: readonly DOMRect[]) => {
      const left = Math.max(...rectangles.map((bounds) => bounds.left));
      const topEdge = Math.max(...rectangles.map((bounds) => bounds.top));
      const right = Math.min(...rectangles.map((bounds) => bounds.right));
      const bottom = Math.min(...rectangles.map((bounds) => bounds.bottom));
      if (left >= right || topEdge >= bottom) {
        throw new Error('Legacy evolution fixture cards do not overlap');
      }
      return { x: (left + right) / 2, y: (topEdge + bottom) / 2 };
    };
    const common = intersectionCenter([baseBounds, middleBounds, topBounds]);
    const horizontalCenter = common.x;
    const containerBounds = element.getBoundingClientRect();
    return {
      ...fixture,
      id: element.dataset.legacyEvolutionStackId ?? '',
      frameLocalBounds: {
        x: containerBounds.x,
        y: containerBounds.y,
        width: containerBounds.width,
        height: containerBounds.height,
      },
      topClientWidth: top.clientWidth,
      topLayer: top.layer ?? 0,
      childDomOrder: [
        ...element.querySelectorAll<HTMLImageElement>(':scope > img'),
      ].map((image) => image.dataset.legacyEvolutionCardId ?? ''),
      logicalOrder: JSON.parse(
        element.dataset.legacyEvolutionLogicalOrder ?? '[]'
      ) as string[],
      hitOrder: {
        commonOverlap: idsAt(common.x, common.y),
        middleAndBaseOverlap: idsAt(
          horizontalCenter,
          (middleBounds.top + topBounds.top) / 2
        ),
        outermostBase: idsAt(
          horizontalCenter,
          (baseBounds.top + middleBounds.top) / 2
        ),
      },
    };
  });
  return { ...details, side, physicalBounds };
};

/**
 * Replays the layout-relevant mutation output of the narrow, ordinary v1
 * evolution path against checked-in HTML/CSS and card assets. Application and
 * network modules remain inert; this is a manually reviewed transcription, not
 * module execution. The synchronous empty wrapper is measured but only the
 * post-MutationObserver state is treated as stable layout output.
 */
export const captureLegacySourceEvolutionReflowFixture = async (
  page: Page
): Promise<LegacySourceEvolutionReflowFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(async (body, fixtureSide) => {
        type EvolutionImage = HTMLImageElement & {
          attached: boolean;
          target: string;
          relative: EvolutionImage | 0;
          layer: number;
          energyLayer: number;
        };
        type EvolutionCard = {
          readonly type: 'Pokémon';
          readonly image: EvolutionImage;
        };

        const waitForStableLayout = () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        const rect = (bounds: DOMRect) => ({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
        const resetImageOutput = (image: EvolutionImage) => {
          image.style.opacity = '1';
          image.style.position = 'relative';
          image.style.bottom = '0%';
          image.style.zIndex = '0';
          image.energyLayer = 0;
          image.layer = 0;
          image.relative = 0;
          image.style.left = '0px';
          image.attached = false;
          image.target = 'off';
          image.style.transform = 'rotate(0deg)';
          image.classList.remove(
            'default-rotation',
            'prizes-normal-size',
            'prizes-small-size'
          );
        };
        const makeImage = (id: string) => {
          const image = document.createElement('img') as EvolutionImage;
          image.dataset.legacyEvolutionCardId = id;
          image.alt = '';
          image.src = `${location.origin}/src/assets/cardback.png`;
          resetImageOutput(image);
          return image;
        };
        const makePlayContainer = (id: string) => {
          const container = document.createElement('div');
          container.className = 'play-container';
          container.style.zIndex = '0';
          container.dataset.legacyEvolutionStackId = id;
          const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              if (
                mutation.removedNodes.length > 0 &&
                container.getElementsByTagName('img').length === 0
              ) {
                container.remove();
              }
            }
          });
          observer.observe(container, { childList: true });
          return container;
        };
        const captureStage = (
          container: HTMLElement,
          logical: readonly EvolutionCard[]
        ): LegacyEvolutionFixtureStage => {
          const domImages = [
            ...container.querySelectorAll<HTMLImageElement>(':scope > img'),
          ] as EvolutionImage[];
          const logicalOrder = logical.map(
            (card) => card.image.dataset.legacyEvolutionCardId ?? ''
          );
          const styles = getComputedStyle(container);
          return {
            logicalOrder,
            domOrder: domImages.map(
              (image) => image.dataset.legacyEvolutionCardId ?? ''
            ),
            containerFrameLocalBounds: rect(container.getBoundingClientRect()),
            containerClientWidth: container.clientWidth,
            computedWidthPx: Number.parseFloat(styles.width),
            authoredWidthPx: container.style.width
              ? Number.parseFloat(container.style.width)
              : null,
            inlineMarginRight: container.style.marginRight,
            inlineMarginLeft: container.style.marginLeft,
            computedMarginRightPx: Number.parseFloat(styles.marginRight) || 0,
            computedMarginLeftPx: Number.parseFloat(styles.marginLeft) || 0,
            cards: logical.map((card, logicalOrdinal) => {
              const image = card.image;
              const imageStyles = getComputedStyle(image);
              const transform =
                imageStyles.transform === 'none'
                  ? new DOMMatrixReadOnly()
                  : new DOMMatrixReadOnly(imageStyles.transform);
              return {
                id: image.dataset.legacyEvolutionCardId ?? '',
                frameLocalBounds: rect(image.getBoundingClientRect()),
                clientWidth: image.clientWidth,
                clientHeight: image.clientHeight,
                localRotationDegrees:
                  ((Math.atan2(transform.b, transform.a) * 180) / Math.PI +
                    360) %
                  360,
                zIndex: Number.parseInt(imageStyles.zIndex, 10) || 0,
                layer: image.layer,
                energyLayer: image.energyLayer,
                inlineLeftPx: Number.parseFloat(image.style.left) || 0,
                inlineBottomPx: Number.parseFloat(image.style.bottom) || 0,
                position: imageStyles.position,
                attached: image.attached === true,
                target: image.target,
                relativeId:
                  image.relative instanceof HTMLImageElement
                    ? (image.relative.dataset.legacyEvolutionCardId ?? null)
                    : null,
                domOrdinal: domImages.indexOf(image),
                logicalOrdinal,
              };
            }),
          };
        };
        const attachPokemon = (
          moving: EvolutionCard,
          target: EvolutionCard
        ) => {
          resetImageOutput(moving.image);
          moving.image.attached = true;
          moving.image.target = 'on';
          moving.image.relative = target.image;
          moving.image.style.position = 'absolute';
          const adjustment = target.image.clientWidth / 15;
          target.image.layer += 1;
          const layer = target.image.layer;
          moving.image.style.bottom = `${layer * adjustment}px`;
          moving.image.style.zIndex = String(
            (Number.parseInt(moving.image.style.zIndex, 10) || 0) - layer
          );
          target.image.after(moving.image);
          const currentRotation =
            Number.parseInt(
              target.image.style.transform.replace(/[^0-9-]/gu, ''),
              10
            ) || 0;
          moving.image.style.transform = `rotate(${currentRotation}deg)`;
        };
        const moveAttachedWithinZone = (
          logical: EvolutionCard[],
          index: number,
          target: EvolutionCard
        ) => {
          const [moving] = logical.splice(index, 1);
          if (!moving) throw new Error('Missing attached evolution card');
          logical.push(moving);
          attachPokemon(moving, target);
        };
        const evolve = (
          logical: EvolutionCard[],
          moving: EvolutionCard,
          target: EvolutionCard
        ) => {
          logical.push(moving);
          resetImageOutput(moving.image);
          target.image.after(moving.image);
          target.image.relative = moving.image;
          const container = target.image.parentElement;
          if (!(container instanceof HTMLElement)) {
            throw new Error('Evolution target has no play container');
          }
          container.style.marginRight = '1%';
          container.style.marginLeft = '0%';
          const transientResetClientWidth = moving.image.clientWidth;
          container.style.width = `${Number.parseFloat(
            String(transientResetClientWidth)
          )}px`;
          for (const card of logical) {
            if (card.image.relative === target.image) {
              card.image.relative = moving.image;
            }
          }
          for (let index = 0; index < logical.length; index += 1) {
            const card = logical[index];
            if (!card) throw new Error('Missing evolution logical card');
            if (card.image === moving.image) break;
            if (card.image.relative === moving.image) {
              resetImageOutput(card.image);
              card.image.attached = true;
              moveAttachedWithinZone(logical, index, moving);
              index -= 1;
            }
          }
          return {
            transientResetClientWidth,
            transientResetAuthoredWidthPx: Number.parseFloat(
              container.style.width
            ),
            container,
          };
        };
        const refresh = (
          zone: Element,
          logical: EvolutionCard[],
          currentContainer: HTMLElement
        ) => {
          const topIndex = logical.findIndex(
            (card) => card.image.attached !== true
          );
          if (topIndex < 0) throw new Error('Evolution stack has no top card');
          const [top] = logical.splice(topIndex, 1);
          if (!top) throw new Error('Missing top evolution card');
          logical.push(top);
          resetImageOutput(top.image);
          const nextContainer = makePlayContainer(
            currentContainer.dataset.legacyEvolutionStackId ?? ''
          );
          zone.append(nextContainer);
          nextContainer.append(top.image);
          for (let index = 0; index < logical.length; index += 1) {
            const card = logical[index];
            if (!card) throw new Error('Missing refresh logical card');
            if (card.image === top.image) break;
            if (card.image.relative === top.image) {
              resetImageOutput(card.image);
              card.image.attached = true;
              moveAttachedWithinZone(logical, index, top);
              index -= 1;
            }
          }
          const baseWidth = Number.parseFloat(String(top.image.clientWidth));
          const adjustment = Number.parseFloat(
            String(top.image.clientWidth / 6)
          );
          nextContainer.style.width = `${
            baseWidth + top.image.energyLayer * adjustment
          }px`;
          return nextContainer;
        };

        const hand = body.querySelector('#hand');
        if (!(hand instanceof HTMLElement)) {
          throw new Error('Legacy evolution fixture hand is missing');
        }
        for (const slot of ['active', 'bench'] as const) {
          const zone = body.querySelector(`#${slot}`);
          if (!(zone instanceof HTMLElement)) {
            throw new Error(`Legacy evolution fixture ${slot} is missing`);
          }
          const stackId = `${fixtureSide}-${slot}-evolution-stack`;
          const [baseId, middleId, topId] = [
            `${fixtureSide}-${slot}-evolution-base`,
            `${fixtureSide}-${slot}-evolution-middle`,
            `${fixtureSide}-${slot}-evolution-top`,
          ];
          const base: EvolutionCard = {
            type: 'Pokémon',
            image: makeImage(baseId),
          };
          const middle: EvolutionCard = {
            type: 'Pokémon',
            image: makeImage(middleId),
          };
          const top: EvolutionCard = {
            type: 'Pokémon',
            image: makeImage(topId),
          };
          let container = makePlayContainer(stackId);
          container.append(base.image);
          zone.append(container);
          hand.append(middle.image, top.image);
          await Promise.all(
            [base.image, middle.image, top.image].map((image) => image.decode())
          );
          const logical = [base];

          evolve(logical, middle, base);
          container = refresh(zone, logical, container);
          await waitForStableLayout();
          const preEvolution = captureStage(container, logical);

          const secondEvolution = evolve(logical, top, middle);
          const transientPostEvolution = captureStage(container, logical);
          const oldContainer = container;
          container = refresh(zone, logical, oldContainer);
          const synchronousPostRefreshContainerCount = zone.querySelectorAll(
            ':scope > .play-container'
          ).length;
          const oldContainerConnectedImmediatelyAfterRefresh =
            oldContainer.isConnected;
          await waitForStableLayout();
          const stablePostRefresh = captureStage(container, logical);
          container.dataset.legacyEvolutionLogicalOrder = JSON.stringify(
            logical.map(
              (card) => card.image.dataset.legacyEvolutionCardId ?? ''
            )
          );
          container.dataset.legacyEvolutionResult = JSON.stringify({
            preEvolution,
            transientResetClientWidth:
              secondEvolution.transientResetClientWidth,
            transientResetAuthoredWidthPx:
              secondEvolution.transientResetAuthoredWidthPx,
            transientPostEvolution,
            stablePostRefresh,
            synchronousPostRefreshContainerCount,
            oldContainerConnectedImmediatelyAfterRefresh,
            stableContainerCount: zone.querySelectorAll(
              ':scope > .play-container'
            ).length,
            oldContainerConnected: oldContainer.isConnected,
          });
        }
      }, side);
  }

  requireServedPaths(loaded, evolutionFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const cards: LegacyEvolutionFixtureCard[] = [];
  const stacks: LegacyEvolutionFixtureStack[] = [];
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const frame = page.frameLocator(frameSelector);
    for (const slot of ['active', 'bench'] as const) {
      const [baseId, middleId, topId] = evolutionFixtureCardIds(side, slot);
      for (const [id, role] of [
        [baseId, 'lowerEvolution'],
        [middleId, 'lowerEvolution'],
        [topId, 'topEvolution'],
      ] as const) {
        cards.push(
          await captureEvolutionFixtureCard(
            frame.locator(`[data-legacy-evolution-card-id="${id}"]`),
            side,
            role,
            frameTransforms[side].rotationDegrees
          )
        );
      }
      stacks.push(
        await captureEvolutionFixtureStack(
          frame.locator(
            `[data-legacy-evolution-stack-id="${side}-${slot}-evolution-stack"]`
          ),
          side
        )
      );
    }
  }

  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames: {
      local: await requireRect(
        page.locator('#selfContainer'),
        '#selfContainer'
      ),
      opponent: await requireRect(
        page.locator('#oppContainer'),
        '#oppContainer'
      ),
    },
    frameTransforms,
    cards,
    stacks,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

type RawCompoundRotationCard = Omit<
  LegacyCompoundRotationCard,
  'physicalBounds' | 'effectiveRotationDegrees'
>;

type RawCompoundRotationStack = Omit<
  LegacyCompoundRotationStack,
  'physicalBounds' | 'hitPointsPhysical'
>;

type RawCompoundRotationPhase = Omit<
  LegacyCompoundRotationPhase,
  'cards' | 'stack'
> & {
  readonly cards: readonly RawCompoundRotationCard[];
  readonly stack: RawCompoundRotationStack;
};

type RawCompoundRotationCase = Omit<
  LegacyCompoundRotationCase,
  'side' | 'phases'
> & { readonly phases: readonly RawCompoundRotationPhase[] };

/**
 * Replays the digest-pinned, marker-free legacy evolution, whole-stack
 * rotation from top or lower evolutions, BREAK toggle, pristine/returned/
 * history-authored/nonzero-group single-card rotation, its same-card follow-up,
 * a top-, same-lower-, different-lower-, or repeated same-lower-initiated
 * group rotation or immediate wrapper refresh after lower-card divergence,
 * and selected q0/q1/q2/q3 refresh paths.
 * Every ordinary, BREAK, single-card, and BREAK-refresh history is constructed
 * independently so no oracle inherits inline margins or wrapper identity from
 * another.
 * Application and network modules stay inert; source DOM mutations are
 * narrowly transcribed below.
 */
export const captureLegacySourceCompoundRotationFixture = async (
  page: Page,
  mode:
    | 'canonical'
    | 'lowerGroupInitiator'
    | 'lowerQ0Single'
    | 'lowerReturnedQ0SingleOrdinary'
    | 'lowerReturnedQ0SingleBreak'
    | 'lowerHistoryAuthoredQ0Single'
    | 'lowerNonzeroGroupSingleOrdinary'
    | 'lowerNonzeroGroupSingleBreak'
    | 'lowerNonzeroGroupSingleFollowupOrdinary'
    | 'lowerNonzeroGroupSingleFollowupBreak'
    | 'lowerNonzeroGroupRotationAfterSingleOrdinary'
    | 'lowerNonzeroGroupRotationAfterSingleBreak'
    | 'lowerNonzeroSameLowerGroupAfterSingleOrdinary'
    | 'lowerNonzeroSameLowerGroupAfterSingleBreak'
    | 'lowerNonzeroDifferentLowerGroupAfterSingleOrdinary'
    | 'lowerNonzeroDifferentLowerGroupAfterSingleBreak'
    | 'lowerNonzeroSameLowerSecondGroupAfterSingleOrdinary'
    | 'lowerNonzeroSameLowerSecondGroupAfterSingleBreak'
    | 'lowerNonzeroGroupRefreshAfterSingleOrdinary'
    | 'lowerNonzeroGroupRefreshAfterSingleBreak'
    | 'nonzeroGroupSingle'
    | 'breakRefreshQ0Q2'
    | 'breakRefreshQ3' = 'canonical'
): Promise<LegacySourceCompoundRotationFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  const rawCases: {
    readonly side: LegacyFixtureSide;
    readonly value: RawCompoundRotationCase;
  }[] = [];

  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const captured = await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (body, input): Promise<RawCompoundRotationCase[]> => {
          type CardRole = 'top' | 'middle' | 'base';
          type CompoundImage = HTMLImageElement & {
            attached: boolean;
            target: string;
            relative: CompoundImage | 0;
            layer: number;
            energyLayer: number;
            PokémonBreak: boolean;
            type: string;
            type2?: string;
          };
          type CompoundCard = {
            readonly id: string;
            readonly role: CardRole;
            readonly type: 'Pokémon';
            readonly image: CompoundImage;
          };

          const rect = (bounds: DOMRect): CapturedRect => ({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
          const waitForStableLayout = () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
          const rotation = (image: HTMLImageElement) =>
            Number.parseInt(
              image.style.transform.replace(/[^0-9-]/gu, ''),
              10
            ) || 0;

          const runScenario = async (
            slot: 'active' | 'bench',
            scenario: LegacyCompoundRotationScenario
          ): Promise<RawCompoundRotationCase> => {
            const zone = body.querySelector(`#${slot}`);
            const hand = body.querySelector('#hand');
            if (
              !(zone instanceof HTMLElement) ||
              !(hand instanceof HTMLElement)
            ) {
              throw new Error(
                `Legacy compound fixture ${slot} regions are missing`
              );
            }
            zone.replaceChildren();

            const scenarioSuffix: Record<
              LegacyCompoundRotationScenario,
              string
            > = {
              ordinaryGroup: 'compound-group',
              breakGroup: 'compound-break',
              ordinaryGroupFromMiddle: 'compound-group-from-middle',
              ordinaryGroupFromBase: 'compound-group-from-base',
              breakGroupFromMiddle: 'compound-break-group-from-middle',
              breakGroupFromBase: 'compound-break-group-from-base',
              ordinaryMiddleSingleAtGroupQ0: 'compound-group-q0-middle-single',
              ordinaryBaseSingleAtGroupQ0: 'compound-group-q0-base-single',
              breakMiddleSingleAtGroupQ0:
                'compound-break-group-q0-middle-single',
              breakBaseSingleAtGroupQ0: 'compound-break-group-q0-base-single',
              ordinaryReturnedFromTopMiddleSingle:
                'compound-group-returned-from-top-middle-single',
              ordinaryReturnedFromTopBaseSingle:
                'compound-group-returned-from-top-base-single',
              ordinaryReturnedFromMiddleMiddleSingle:
                'compound-group-returned-from-middle-middle-single',
              ordinaryReturnedFromMiddleBaseSingle:
                'compound-group-returned-from-middle-base-single',
              ordinaryReturnedFromBaseMiddleSingle:
                'compound-group-returned-from-base-middle-single',
              ordinaryReturnedFromBaseBaseSingle:
                'compound-group-returned-from-base-base-single',
              breakReturnedFromTopMiddleSingle:
                'compound-break-group-returned-from-top-middle-single',
              breakReturnedFromTopBaseSingle:
                'compound-break-group-returned-from-top-base-single',
              breakReturnedFromMiddleMiddleSingle:
                'compound-break-group-returned-from-middle-middle-single',
              breakReturnedFromMiddleBaseSingle:
                'compound-break-group-returned-from-middle-base-single',
              breakReturnedFromBaseMiddleSingle:
                'compound-break-group-returned-from-base-middle-single',
              breakReturnedFromBaseBaseSingle:
                'compound-break-group-returned-from-base-base-single',
              ordinaryMiddleThirdSingleAtHistoryQ0:
                'compound-history-q0-middle-third-single',
              ordinaryBaseThirdSingleAtHistoryQ0:
                'compound-history-q0-base-third-single',
              breakMiddleThirdSingleAtHistoryQ0:
                'compound-break-history-q0-middle-third-single',
              breakBaseThirdSingleAtHistoryQ0:
                'compound-break-history-q0-base-third-single',
              ordinaryMiddleSingleAtGroupQ1: 'compound-group-q1-middle-single',
              ordinaryMiddleSingleAtGroupQ2: 'compound-group-q2-middle-single',
              ordinaryMiddleSingleAtGroupQ3: 'compound-group-q3-middle-single',
              ordinaryBaseSingleAtGroupQ1: 'compound-group-q1-base-single',
              ordinaryBaseSingleAtGroupQ2: 'compound-group-q2-base-single',
              ordinaryBaseSingleAtGroupQ3: 'compound-group-q3-base-single',
              breakMiddleSingleAtGroupQ1:
                'compound-break-group-q1-middle-single',
              breakMiddleSingleAtGroupQ2:
                'compound-break-group-q2-middle-single',
              breakMiddleSingleAtGroupQ3:
                'compound-break-group-q3-middle-single',
              breakBaseSingleAtGroupQ1: 'compound-break-group-q1-base-single',
              breakBaseSingleAtGroupQ2: 'compound-break-group-q2-base-single',
              breakBaseSingleAtGroupQ3: 'compound-break-group-q3-base-single',
              ordinaryMiddleFollowupSingleAfterGroupQ1:
                'compound-group-q1-middle-single-followup',
              ordinaryMiddleFollowupSingleAfterGroupQ2:
                'compound-group-q2-middle-single-followup',
              ordinaryMiddleFollowupSingleAfterGroupQ3:
                'compound-group-q3-middle-single-followup',
              ordinaryBaseFollowupSingleAfterGroupQ1:
                'compound-group-q1-base-single-followup',
              ordinaryBaseFollowupSingleAfterGroupQ2:
                'compound-group-q2-base-single-followup',
              ordinaryBaseFollowupSingleAfterGroupQ3:
                'compound-group-q3-base-single-followup',
              breakMiddleFollowupSingleAfterGroupQ1:
                'compound-break-group-q1-middle-single-followup',
              breakMiddleFollowupSingleAfterGroupQ2:
                'compound-break-group-q2-middle-single-followup',
              breakMiddleFollowupSingleAfterGroupQ3:
                'compound-break-group-q3-middle-single-followup',
              breakBaseFollowupSingleAfterGroupQ1:
                'compound-break-group-q1-base-single-followup',
              breakBaseFollowupSingleAfterGroupQ2:
                'compound-break-group-q2-base-single-followup',
              breakBaseFollowupSingleAfterGroupQ3:
                'compound-break-group-q3-base-single-followup',
              ordinaryTopGroupAfterMiddleSingleAtGroupQ1:
                'compound-group-q1-middle-single-top-group',
              ordinaryTopGroupAfterMiddleSingleAtGroupQ2:
                'compound-group-q2-middle-single-top-group',
              ordinaryTopGroupAfterMiddleSingleAtGroupQ3:
                'compound-group-q3-middle-single-top-group',
              ordinaryTopGroupAfterBaseSingleAtGroupQ1:
                'compound-group-q1-base-single-top-group',
              ordinaryTopGroupAfterBaseSingleAtGroupQ2:
                'compound-group-q2-base-single-top-group',
              ordinaryTopGroupAfterBaseSingleAtGroupQ3:
                'compound-group-q3-base-single-top-group',
              breakTopGroupAfterMiddleSingleAtGroupQ1:
                'compound-break-group-q1-middle-single-top-group',
              breakTopGroupAfterMiddleSingleAtGroupQ2:
                'compound-break-group-q2-middle-single-top-group',
              breakTopGroupAfterMiddleSingleAtGroupQ3:
                'compound-break-group-q3-middle-single-top-group',
              breakTopGroupAfterBaseSingleAtGroupQ1:
                'compound-break-group-q1-base-single-top-group',
              breakTopGroupAfterBaseSingleAtGroupQ2:
                'compound-break-group-q2-base-single-top-group',
              breakTopGroupAfterBaseSingleAtGroupQ3:
                'compound-break-group-q3-base-single-top-group',
              ordinaryMiddleGroupAfterMiddleSingleAtGroupQ1:
                'compound-group-q1-middle-single-middle-group',
              ordinaryMiddleGroupAfterMiddleSingleAtGroupQ2:
                'compound-group-q2-middle-single-middle-group',
              ordinaryMiddleGroupAfterMiddleSingleAtGroupQ3:
                'compound-group-q3-middle-single-middle-group',
              ordinaryBaseGroupAfterBaseSingleAtGroupQ1:
                'compound-group-q1-base-single-base-group',
              ordinaryBaseGroupAfterBaseSingleAtGroupQ2:
                'compound-group-q2-base-single-base-group',
              ordinaryBaseGroupAfterBaseSingleAtGroupQ3:
                'compound-group-q3-base-single-base-group',
              breakMiddleGroupAfterMiddleSingleAtGroupQ1:
                'compound-break-group-q1-middle-single-middle-group',
              breakMiddleGroupAfterMiddleSingleAtGroupQ2:
                'compound-break-group-q2-middle-single-middle-group',
              breakMiddleGroupAfterMiddleSingleAtGroupQ3:
                'compound-break-group-q3-middle-single-middle-group',
              breakBaseGroupAfterBaseSingleAtGroupQ1:
                'compound-break-group-q1-base-single-base-group',
              breakBaseGroupAfterBaseSingleAtGroupQ2:
                'compound-break-group-q2-base-single-base-group',
              breakBaseGroupAfterBaseSingleAtGroupQ3:
                'compound-break-group-q3-base-single-base-group',
              ordinaryBaseGroupAfterMiddleSingleAtGroupQ1:
                'compound-group-q1-middle-single-base-group',
              ordinaryBaseGroupAfterMiddleSingleAtGroupQ2:
                'compound-group-q2-middle-single-base-group',
              ordinaryBaseGroupAfterMiddleSingleAtGroupQ3:
                'compound-group-q3-middle-single-base-group',
              ordinaryMiddleGroupAfterBaseSingleAtGroupQ1:
                'compound-group-q1-base-single-middle-group',
              ordinaryMiddleGroupAfterBaseSingleAtGroupQ2:
                'compound-group-q2-base-single-middle-group',
              ordinaryMiddleGroupAfterBaseSingleAtGroupQ3:
                'compound-group-q3-base-single-middle-group',
              breakBaseGroupAfterMiddleSingleAtGroupQ1:
                'compound-break-group-q1-middle-single-base-group',
              breakBaseGroupAfterMiddleSingleAtGroupQ2:
                'compound-break-group-q2-middle-single-base-group',
              breakBaseGroupAfterMiddleSingleAtGroupQ3:
                'compound-break-group-q3-middle-single-base-group',
              breakMiddleGroupAfterBaseSingleAtGroupQ1:
                'compound-break-group-q1-base-single-middle-group',
              breakMiddleGroupAfterBaseSingleAtGroupQ2:
                'compound-break-group-q2-base-single-middle-group',
              breakMiddleGroupAfterBaseSingleAtGroupQ3:
                'compound-break-group-q3-base-single-middle-group',
              ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ1:
                'compound-group-q1-middle-single-middle-group-second-group',
              ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ2:
                'compound-group-q2-middle-single-middle-group-second-group',
              ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ3:
                'compound-group-q3-middle-single-middle-group-second-group',
              ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ1:
                'compound-group-q1-base-single-base-group-second-group',
              ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ2:
                'compound-group-q2-base-single-base-group-second-group',
              ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ3:
                'compound-group-q3-base-single-base-group-second-group',
              breakMiddleSecondGroupAfterMiddleSingleAtGroupQ1:
                'compound-break-group-q1-middle-single-middle-group-second-group',
              breakMiddleSecondGroupAfterMiddleSingleAtGroupQ2:
                'compound-break-group-q2-middle-single-middle-group-second-group',
              breakMiddleSecondGroupAfterMiddleSingleAtGroupQ3:
                'compound-break-group-q3-middle-single-middle-group-second-group',
              breakBaseSecondGroupAfterBaseSingleAtGroupQ1:
                'compound-break-group-q1-base-single-base-group-second-group',
              breakBaseSecondGroupAfterBaseSingleAtGroupQ2:
                'compound-break-group-q2-base-single-base-group-second-group',
              breakBaseSecondGroupAfterBaseSingleAtGroupQ3:
                'compound-break-group-q3-base-single-base-group-second-group',
              ordinaryRefreshAfterMiddleSingleAtGroupQ1:
                'compound-group-q1-middle-single-refresh',
              ordinaryRefreshAfterMiddleSingleAtGroupQ2:
                'compound-group-q2-middle-single-refresh',
              ordinaryRefreshAfterMiddleSingleAtGroupQ3:
                'compound-group-q3-middle-single-refresh',
              ordinaryRefreshAfterBaseSingleAtGroupQ1:
                'compound-group-q1-base-single-refresh',
              ordinaryRefreshAfterBaseSingleAtGroupQ2:
                'compound-group-q2-base-single-refresh',
              ordinaryRefreshAfterBaseSingleAtGroupQ3:
                'compound-group-q3-base-single-refresh',
              breakRefreshAfterMiddleSingleAtGroupQ1:
                'compound-break-group-q1-middle-single-refresh',
              breakRefreshAfterMiddleSingleAtGroupQ2:
                'compound-break-group-q2-middle-single-refresh',
              breakRefreshAfterMiddleSingleAtGroupQ3:
                'compound-break-group-q3-middle-single-refresh',
              breakRefreshAfterBaseSingleAtGroupQ1:
                'compound-break-group-q1-base-single-refresh',
              breakRefreshAfterBaseSingleAtGroupQ2:
                'compound-break-group-q2-base-single-refresh',
              breakRefreshAfterBaseSingleAtGroupQ3:
                'compound-break-group-q3-base-single-refresh',
              ordinarySingleAtGroupQ1: 'compound-group-q1-single',
              ordinarySingleAtGroupQ2: 'compound-group-q2-single',
              ordinarySingleAtGroupQ3: 'compound-group-q3-single',
              breakSingleAtGroupQ1: 'compound-break-group-q1-single',
              breakSingleAtGroupQ2: 'compound-break-group-q2-single',
              breakSingleAtGroupQ3: 'compound-break-group-q3-single',
              breakRefreshFreshQ0: 'compound-break-refresh-fresh-q0',
              breakRefreshReturnedQ0: 'compound-break-refresh-returned-q0',
              breakRefreshQ2: 'compound-break-refresh-q2',
              breakRefreshQ3: 'compound-break-refresh-q3',
            };
            const prefix = `${input.side}-${slot}-${scenarioSuffix[scenario]}`;
            const mutationObservers: MutationObserver[] = [];
            const resizeObservers: ResizeObserver[] = [];
            let resizeCallbacks = 0;
            const transcribedSourceDisconnectCalls = 0;
            const callTrace: string[] = [];
            let transitionTrace: string[] = [];

            const resetImageOutput = (
              image: CompoundImage,
              destination = ''
            ) => {
              image.style.opacity = '1';
              image.style.position = 'relative';
              image.style.bottom = '0%';
              image.style.zIndex = '0';
              image.energyLayer = 0;
              image.layer = 0;
              image.relative = 0;
              image.style.left = '0px';
              image.attached = false;
              image.target = 'off';
              if (
                image.PokémonBreak &&
                (destination === 'active' || destination === 'bench')
              ) {
                image.style.transform = 'rotate(90deg)';
              } else {
                image.style.transform = 'rotate(0deg)';
                image.PokémonBreak = false;
              }
              image.classList.remove(
                'default-rotation',
                'prizes-normal-size',
                'prizes-small-size'
              );
            };

            const makeImage = (role: CardRole): CompoundImage => {
              const image = document.createElement('img') as CompoundImage;
              image.dataset.legacyCompoundRotationCardId = `${prefix}-${role}`;
              image.dataset.legacyCompoundRotationRole = role;
              image.alt = '';
              image.src = `${location.origin}/src/assets/cardback.png`;
              image.type = 'Pokémon';
              image.type2 = 'Pokémon';
              image.PokémonBreak = false;
              resetImageOutput(image);
              return image;
            };

            const makePlayContainer = (
              initialImage: CompoundImage
            ): HTMLElement => {
              const container = document.createElement('div');
              if (
                initialImage.PokémonBreak &&
                (slot === 'active' || slot === 'bench')
              ) {
                container.style.marginRight = '3%';
                container.style.marginLeft = '2%';
              }
              container.className = 'play-container';
              container.style.zIndex = '0';
              container.dataset.legacyCompoundRotationStackId = `${prefix}-stack`;
              zone.append(container);
              container.append(initialImage);
              const mutationObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                  if (
                    mutation.removedNodes.length > 0 &&
                    container.getElementsByTagName('img').length === 0
                  ) {
                    if (container.parentElement) {
                      container.parentElement.style.zIndex = '0';
                    }
                    container.remove();
                  }
                }
              });
              mutationObserver.observe(container, { childList: true });
              mutationObservers.push(mutationObserver);
              const resizeObserver = new ResizeObserver(() => {
                resizeCallbacks += 1;
              });
              resizeObserver.observe(container);
              resizeObservers.push(resizeObserver);
              return container;
            };

            const attachPokemon = (
              moving: CompoundCard,
              target: CompoundCard
            ) => {
              resetImageOutput(moving.image);
              moving.image.attached = true;
              moving.image.target = 'on';
              moving.image.relative = target.image;
              moving.image.style.position = 'absolute';
              const adjustment = target.image.clientWidth / 15;
              target.image.layer += 1;
              const layer = target.image.layer;
              moving.image.style.bottom = `${layer * adjustment}px`;
              moving.image.style.zIndex = String(
                (Number.parseInt(moving.image.style.zIndex, 10) || 0) - layer
              );
              target.image.after(moving.image);
              const rotationOffset = target.image.PokémonBreak ? 1 : 0;
              moving.image.style.transform = `rotate(${
                rotation(target.image) - 90 * rotationOffset
              }deg)`;
            };

            const moveAttachedWithinZone = (
              logical: CompoundCard[],
              index: number,
              target: CompoundCard
            ) => {
              const [moving] = logical.splice(index, 1);
              if (!moving) throw new Error('Missing compound attached card');
              logical.push(moving);
              attachPokemon(moving, target);
            };

            const evolve = (
              logical: CompoundCard[],
              moving: CompoundCard,
              target: CompoundCard
            ) => {
              logical.push(moving);
              resetImageOutput(moving.image);
              target.image.after(moving.image);
              target.image.relative = moving.image;
              const container = target.image.parentElement;
              if (!(container instanceof HTMLElement)) {
                throw new Error('Compound evolution target has no wrapper');
              }
              if (rotation(target.image) !== 0) {
                container
                  .querySelectorAll<HTMLImageElement>('img')
                  .forEach((image) => {
                    image.style.transform = 'rotate(0deg)';
                  });
              }
              container.style.marginRight = '1%';
              container.style.marginLeft = '0%';
              container.style.width = `${Number.parseFloat(
                String(moving.image.clientWidth)
              )}px`;
              for (const card of logical) {
                if (card.image.relative === target.image) {
                  card.image.relative = moving.image;
                }
              }
              for (let index = 0; index < logical.length; index += 1) {
                const card = logical[index];
                if (!card) throw new Error('Missing compound evolution card');
                if (card === moving) break;
                if (card.image.relative === moving.image) {
                  resetImageOutput(card.image);
                  card.image.attached = true;
                  moveAttachedWithinZone(logical, index, moving);
                  index -= 1;
                }
              }
              callTrace.push(`evolve:${target.id}->${moving.id}`);
              return container;
            };

            const refresh = (
              logical: CompoundCard[],
              currentContainer: HTMLElement
            ) => {
              const topIndex = logical.findIndex(
                (card) => card.image.attached !== true
              );
              if (topIndex < 0)
                throw new Error('Compound stack has no top card');
              const [top] = logical.splice(topIndex, 1);
              if (!top) throw new Error('Missing compound top card');
              logical.push(top);
              const effectiveRotation = rotation(top.image);
              const groupRotation = top.image.PokémonBreak
                ? effectiveRotation - 90
                : effectiveRotation;
              const numberRotations = groupRotation / 90;
              resetImageOutput(top.image, slot);
              const nextContainer = makePlayContainer(top.image);
              for (let index = 0; index < logical.length; index += 1) {
                const card = logical[index];
                if (!card) throw new Error('Missing compound refresh card');
                if (card === top) break;
                if (card.image.relative === top.image) {
                  resetImageOutput(card.image);
                  card.image.attached = true;
                  moveAttachedWithinZone(logical, index, top);
                  index -= 1;
                }
              }
              nextContainer.style.width = `${Number.parseFloat(
                String(top.image.clientWidth)
              )}px`;
              callTrace.push(
                `refresh:${top.id}:break=${String(
                  top.image.PokémonBreak
                )}:groupTurns=${String(numberRotations)}`
              );
              for (let count = 0; count < numberRotations; count += 1) {
                rotateCard(top, false, logical, nextContainer, true);
              }
              return {
                container: nextContainer,
                synchronousWrapperCount: zone.querySelectorAll(
                  ':scope > [data-legacy-compound-rotation-stack-id]'
                ).length,
                oldWrapperConnectedImmediately: currentContainer.isConnected,
              };
            };

            const rotateCard = (
              selected: CompoundCard,
              single: boolean,
              logical: CompoundCard[],
              container: HTMLElement,
              replay = false
            ): LegacyCompoundRotationAction => {
              const before = rotation(selected.image);
              const breakBefore = selected.image.PokémonBreak;
              const next = (before + 90) % 360;
              selected.image.style.transform = `rotate(${next}deg)`;
              if (slot === 'bench') {
                container.style.marginRight = '3%';
                container.style.marginLeft = '2%';
              }
              if (next === 0 || next === 180) {
                container.style.marginRight = '1%';
                container.style.marginLeft = '0%';
              }
              if (!single) {
                container
                  .querySelectorAll<CompoundImage>('img')
                  .forEach((image) => {
                    if (image !== selected.image && image.type === 'Pokémon') {
                      image.style.transform = `rotate(${
                        (rotation(image) + 90) % 360
                      }deg)`;
                    }
                  });
              } else if (next === 90) {
                selected.image.PokémonBreak = true;
              } else {
                selected.image.style.transform = 'rotate(0deg)';
                selected.image.PokémonBreak = false;
              }
              const indexBefore = logical.indexOf(selected);
              callTrace.push(
                `${replay ? 'replay-' : ''}rotate:${selected.id}:index=${String(
                  indexBefore
                )}:single=${String(single)}:${String(before)}->${String(
                  rotation(selected.image)
                )}:break=${String(breakBefore)}->${String(
                  selected.image.PokémonBreak
                )}`
              );
              return {
                selectedCardId: selected.id,
                selectedRole: selected.role,
                indexBefore,
                single,
              };
            };

            const idsAt = (point: CapturedPoint, ids: ReadonlySet<string>) =>
              document
                .elementsFromPoint(point.x, point.y)
                .flatMap((candidate) =>
                  candidate instanceof HTMLImageElement &&
                  candidate.dataset.legacyCompoundRotationCardId &&
                  ids.has(candidate.dataset.legacyCompoundRotationCardId)
                    ? [candidate.dataset.legacyCompoundRotationCardId]
                    : []
                );

            const snapshot = (
              name: LegacyCompoundRotationPhaseName,
              action: LegacyCompoundRotationAction | null,
              logical: CompoundCard[],
              container: HTMLElement
            ): RawCompoundRotationPhase => {
              const domImages = [
                ...container.querySelectorAll<CompoundImage>(':scope > img'),
              ];
              const cards = logical.map((card): RawCompoundRotationCard => {
                const paintedBounds = rect(card.image.getBoundingClientRect());
                const priorTransform = card.image.style.transform;
                card.image.style.transform = 'none';
                const untransformedFrameLocalBounds = rect(
                  card.image.getBoundingClientRect()
                );
                card.image.style.transform = priorTransform;
                const styles = getComputedStyle(card.image);
                const transform =
                  styles.transform === 'none'
                    ? new DOMMatrixReadOnly()
                    : new DOMMatrixReadOnly(styles.transform);
                return {
                  id: card.id,
                  role: card.role,
                  frameLocalBounds: paintedBounds,
                  untransformedFrameLocalBounds,
                  naturalWidth: card.image.naturalWidth,
                  naturalHeight: card.image.naturalHeight,
                  clientWidth: card.image.clientWidth,
                  clientHeight: card.image.clientHeight,
                  localRotationDegrees:
                    ((Math.atan2(transform.b, transform.a) * 180) / Math.PI +
                      360) %
                    360,
                  inlineTransform: card.image.style.transform,
                  transformOrigin: styles.transformOrigin,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  layer: card.image.layer,
                  energyLayer: card.image.energyLayer,
                  inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
                  inlineBottomPx:
                    Number.parseFloat(card.image.style.bottom) || 0,
                  position: styles.position,
                  attached: card.image.attached === true,
                  target: card.image.target,
                  relativeId:
                    card.image.relative instanceof HTMLImageElement
                      ? (card.image.relative.dataset
                          .legacyCompoundRotationCardId ?? null)
                      : null,
                  pokemonBreak: card.image.PokémonBreak === true,
                  imageType: card.image.type,
                  domOrdinal: domImages.indexOf(card.image),
                  logicalOrdinal: logical.indexOf(card),
                  sourcePath: new URL(card.image.currentSrc).pathname,
                };
              });
              const byRole = (role: CardRole) => {
                const card = cards.find((candidate) => candidate.role === role);
                if (!card) throw new Error(`Missing compound ${role} card`);
                return card;
              };
              const top = byRole('top');
              const middle = byRole('middle');
              const base = byRole('base');
              const fixtureIds = new Set(cards.map((card) => card.id));
              const pointInside = (
                point: CapturedPoint,
                bounds: CapturedRect,
                inset = 2
              ) =>
                point.x >= bounds.x + inset &&
                point.x <= bounds.x + bounds.width - inset &&
                point.y >= bounds.y + inset &&
                point.y <= bounds.y + bounds.height - inset;
              const pointOutside = (
                point: CapturedPoint,
                bounds: CapturedRect,
                inset = 2
              ) =>
                point.x <= bounds.x - inset ||
                point.x >= bounds.x + bounds.width + inset ||
                point.y <= bounds.y - inset ||
                point.y >= bounds.y + bounds.height + inset;
              const sameIds = (
                actual: readonly string[],
                expected: readonly string[]
              ) =>
                actual.length === expected.length &&
                actual.every((id, index) => id === expected[index]);
              const samples: {
                readonly point: CapturedPoint;
                readonly hitIds: readonly string[];
              }[] = [];
              const candidateBounds = [
                ...cards.map((card) => card.frameLocalBounds),
                top.untransformedFrameLocalBounds,
              ];
              const axisCandidates = (
                axis: 'x' | 'y',
                size: 'width' | 'height',
                boundsList = candidateBounds
              ) =>
                [
                  ...new Set(
                    boundsList.flatMap((bounds) => {
                      const start = bounds[axis];
                      const end = start + bounds[size];
                      return [
                        start - 2.25,
                        start + 2.25,
                        (start + end) / 2,
                        end - 2.25,
                        end + 2.25,
                      ];
                    })
                  ),
                ].sort((left, right) => left - right);
              for (const y of axisCandidates('y', 'height')) {
                for (const x of axisCandidates('x', 'width')) {
                  const point = { x, y };
                  samples.push({ point, hitIds: idsAt(point, fixtureIds) });
                }
              }
              const lowerSamples = [...samples];
              const lowerCandidateBounds = [
                ...candidateBounds,
                middle.untransformedFrameLocalBounds,
                base.untransformedFrameLocalBounds,
              ];
              for (const y of axisCandidates(
                'y',
                'height',
                lowerCandidateBounds
              )) {
                for (const x of axisCandidates(
                  'x',
                  'width',
                  lowerCandidateBounds
                )) {
                  const point = { x, y };
                  lowerSamples.push({
                    point,
                    hitIds: idsAt(point, fixtureIds),
                  });
                }
              }
              const findPoint = (
                predicate: (
                  ids: readonly string[],
                  point: CapturedPoint
                ) => boolean
              ): CapturedPoint | null =>
                samples.find(({ hitIds, point }) => predicate(hitIds, point))
                  ?.point ?? null;
              const findLowerPoint = (
                predicate: (
                  ids: readonly string[],
                  point: CapturedPoint
                ) => boolean
              ): CapturedPoint | null =>
                lowerSamples.find(({ hitIds, point }) =>
                  predicate(hitIds, point)
                )?.point ?? null;
              const lowerPaintedOnly = (
                card: RawCompoundRotationCard
              ): CapturedPoint | null =>
                findLowerPoint(
                  (ids, point) =>
                    ids.includes(card.id) &&
                    pointInside(point, card.frameLocalBounds) &&
                    pointOutside(point, card.untransformedFrameLocalBounds)
                );
              const lowerAuthoredOnly = (
                card: RawCompoundRotationCard
              ): CapturedPoint | null =>
                findLowerPoint(
                  (ids, point) =>
                    !ids.includes(card.id) &&
                    pointInside(point, card.untransformedFrameLocalBounds) &&
                    pointOutside(point, card.frameLocalBounds)
                );
              const points = {
                commonOverlap: findPoint(
                  (ids, point) =>
                    sameIds(ids, [top.id, middle.id, base.id]) &&
                    [top, middle, base].every((card) =>
                      pointInside(point, card.frameLocalBounds)
                    )
                ),
                topOnly: findPoint(
                  (ids, point) =>
                    sameIds(ids, [top.id]) &&
                    pointInside(point, top.frameLocalBounds) &&
                    pointOutside(point, middle.frameLocalBounds) &&
                    pointOutside(point, base.frameLocalBounds)
                ),
                middleAndBaseOverlap: findPoint(
                  (ids, point) =>
                    sameIds(ids, [middle.id, base.id]) &&
                    pointOutside(point, top.frameLocalBounds) &&
                    pointInside(point, middle.frameLocalBounds) &&
                    pointInside(point, base.frameLocalBounds)
                ),
                baseOnly: findPoint(
                  (ids, point) =>
                    sameIds(ids, [base.id]) &&
                    pointOutside(point, top.frameLocalBounds) &&
                    pointOutside(point, middle.frameLocalBounds) &&
                    pointInside(point, base.frameLocalBounds)
                ),
                topPaintedOnly: findPoint(
                  (ids, point) =>
                    ids.includes(top.id) &&
                    pointInside(point, top.frameLocalBounds) &&
                    pointOutside(point, top.untransformedFrameLocalBounds)
                ),
                topAuthoredOnly: findPoint(
                  (ids, point) =>
                    ids.length > 0 &&
                    !ids.includes(top.id) &&
                    pointInside(point, top.untransformedFrameLocalBounds) &&
                    pointOutside(point, top.frameLocalBounds)
                ),
                middlePaintedOnly: lowerPaintedOnly(middle),
                middleAuthoredOnly: lowerAuthoredOnly(middle),
                basePaintedOnly: lowerPaintedOnly(base),
                baseAuthoredOnly: lowerAuthoredOnly(base),
              };
              const hitOrder: RawCompoundRotationStack['hitOrder'] = {
                commonOverlap: points.commonOverlap
                  ? idsAt(points.commonOverlap, fixtureIds)
                  : null,
                topOnly: points.topOnly
                  ? idsAt(points.topOnly, fixtureIds)
                  : null,
                middleAndBaseOverlap: points.middleAndBaseOverlap
                  ? idsAt(points.middleAndBaseOverlap, fixtureIds)
                  : null,
                baseOnly: points.baseOnly
                  ? idsAt(points.baseOnly, fixtureIds)
                  : null,
                topPaintedOnly: points.topPaintedOnly
                  ? idsAt(points.topPaintedOnly, fixtureIds)
                  : null,
                topAuthoredOnly: points.topAuthoredOnly
                  ? idsAt(points.topAuthoredOnly, fixtureIds)
                  : null,
                middlePaintedOnly: points.middlePaintedOnly
                  ? idsAt(points.middlePaintedOnly, fixtureIds)
                  : null,
                middleAuthoredOnly: points.middleAuthoredOnly
                  ? idsAt(points.middleAuthoredOnly, fixtureIds)
                  : null,
                basePaintedOnly: points.basePaintedOnly
                  ? idsAt(points.basePaintedOnly, fixtureIds)
                  : null,
                baseAuthoredOnly: points.baseAuthoredOnly
                  ? idsAt(points.baseAuthoredOnly, fixtureIds)
                  : null,
              };
              const containerBounds = rect(container.getBoundingClientRect());
              const styles = getComputedStyle(container);
              return {
                name,
                action,
                cards,
                stack: {
                  id: container.dataset.legacyCompoundRotationStackId ?? '',
                  frameLocalBounds: containerBounds,
                  clientWidth: container.clientWidth,
                  clientHeight: container.clientHeight,
                  offsetWidth: container.offsetWidth,
                  offsetHeight: container.offsetHeight,
                  computedWidthPx: Number.parseFloat(styles.width),
                  computedHeightPx: Number.parseFloat(styles.height),
                  authoredWidthPx: container.style.width
                    ? Number.parseFloat(container.style.width)
                    : null,
                  inlineMarginRight: container.style.marginRight,
                  inlineMarginLeft: container.style.marginLeft,
                  computedMarginRightPx:
                    Number.parseFloat(styles.marginRight) || 0,
                  computedMarginLeftPx:
                    Number.parseFloat(styles.marginLeft) || 0,
                  transform: styles.transform,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  childDomOrder: domImages.map(
                    (image) => image.dataset.legacyCompoundRotationCardId ?? ''
                  ),
                  logicalOrder: logical.map((card) => card.id),
                  hitOrder,
                  hitPointsFrameLocal: points,
                },
                wrapperCount: zone.querySelectorAll(
                  ':scope > [data-legacy-compound-rotation-stack-id]'
                ).length,
              };
            };

            const base: CompoundCard = {
              id: `${prefix}-base`,
              role: 'base',
              type: 'Pokémon',
              image: makeImage('base'),
            };
            const middle: CompoundCard = {
              id: `${prefix}-middle`,
              role: 'middle',
              type: 'Pokémon',
              image: makeImage('middle'),
            };
            const top: CompoundCard = {
              id: `${prefix}-top`,
              role: 'top',
              type: 'Pokémon',
              image: makeImage('top'),
            };
            let container = makePlayContainer(base.image);
            hand.append(middle.image, top.image);
            await Promise.all(
              [base.image, middle.image, top.image].map((image) =>
                image.decode()
              )
            );
            const logical = [base];
            evolve(logical, middle, base);
            container = refresh(logical, container).container;
            await waitForStableLayout();
            evolve(logical, top, middle);
            container = refresh(logical, container).container;
            await waitForStableLayout();

            const phases: RawCompoundRotationPhase[] = [
              ...(scenario === 'ordinaryGroup' ||
              scenario === 'breakGroup' ||
              scenario === 'ordinaryGroupFromMiddle' ||
              scenario === 'ordinaryGroupFromBase' ||
              scenario === 'breakGroupFromMiddle' ||
              scenario === 'breakGroupFromBase'
                ? [snapshot('pristine-q0', null, logical, container)]
                : []),
            ];
            let refreshEvidence: LegacyCompoundRotationCase['refresh'] = null;

            if (
              scenario === 'ordinaryGroup' ||
              scenario === 'ordinaryGroupFromMiddle' ||
              scenario === 'ordinaryGroupFromBase'
            ) {
              const selected = scenario.endsWith('FromMiddle')
                ? middle
                : scenario.endsWith('FromBase')
                  ? base
                  : top;
              const q1Action = rotateCard(selected, false, logical, container);
              phases.push(snapshot('q1', q1Action, logical, container));
              const oldContainer = container;
              const cardNodesBeforeRefresh = logical.map((card) => card.image);
              const refreshed = refresh(logical, oldContainer);
              container = refreshed.container;
              await waitForStableLayout();
              refreshEvidence = {
                synchronousWrapperCount: refreshed.synchronousWrapperCount,
                oldWrapperConnectedImmediately:
                  refreshed.oldWrapperConnectedImmediately,
                stableWrapperCount: zone.querySelectorAll(
                  ':scope > [data-legacy-compound-rotation-stack-id]'
                ).length,
                oldWrapperConnectedAfterSettle: oldContainer.isConnected,
                wrapperIdentityChanged: oldContainer !== container,
                cardNodeIdentityPreserved: cardNodesBeforeRefresh.every(
                  (node, index) => logical[index]?.image === node
                ),
              };
              phases.push(snapshot('q1-refreshed', null, logical, container));
              phases.push(
                snapshot(
                  'q2',
                  rotateCard(selected, false, logical, container),
                  logical,
                  container
                )
              );
              phases.push(
                snapshot(
                  'q3',
                  rotateCard(selected, false, logical, container),
                  logical,
                  container
                )
              );
              phases.push(
                snapshot(
                  'q0-return',
                  rotateCard(selected, false, logical, container),
                  logical,
                  container
                )
              );
            } else if (
              scenario === 'breakGroup' ||
              scenario === 'breakGroupFromMiddle' ||
              scenario === 'breakGroupFromBase'
            ) {
              const selected = scenario.endsWith('FromMiddle')
                ? middle
                : scenario.endsWith('FromBase')
                  ? base
                  : top;
              phases.push(
                snapshot(
                  'break-on-q0',
                  rotateCard(top, true, logical, container),
                  logical,
                  container
                )
              );
              phases.push(
                snapshot(
                  'break-group-q1',
                  rotateCard(selected, false, logical, container),
                  logical,
                  container
                )
              );
              const oldContainer = container;
              const cardNodesBeforeRefresh = logical.map((card) => card.image);
              const refreshed = refresh(logical, oldContainer);
              container = refreshed.container;
              await waitForStableLayout();
              refreshEvidence = {
                synchronousWrapperCount: refreshed.synchronousWrapperCount,
                oldWrapperConnectedImmediately:
                  refreshed.oldWrapperConnectedImmediately,
                stableWrapperCount: zone.querySelectorAll(
                  ':scope > [data-legacy-compound-rotation-stack-id]'
                ).length,
                oldWrapperConnectedAfterSettle: oldContainer.isConnected,
                wrapperIdentityChanged: oldContainer !== container,
                cardNodeIdentityPreserved: cardNodesBeforeRefresh.every(
                  (node, index) => logical[index]?.image === node
                ),
              };
              phases.push(
                snapshot('break-group-q1-refreshed', null, logical, container)
              );
              phases.push(
                snapshot(
                  'break-group-q2',
                  rotateCard(selected, false, logical, container),
                  logical,
                  container
                )
              );
              phases.push(
                snapshot(
                  'break-group-q3',
                  rotateCard(selected, false, logical, container),
                  logical,
                  container
                )
              );
              phases.push(
                snapshot(
                  'break-group-q0-return',
                  rotateCard(selected, false, logical, container),
                  logical,
                  container
                )
              );
              phases.push(
                snapshot(
                  'break-off-q0',
                  rotateCard(top, true, logical, container),
                  logical,
                  container
                )
              );
            } else if (
              scenario === 'ordinaryMiddleSingleAtGroupQ0' ||
              scenario === 'ordinaryBaseSingleAtGroupQ0' ||
              scenario === 'breakMiddleSingleAtGroupQ0' ||
              scenario === 'breakBaseSingleAtGroupQ0'
            ) {
              const setupBreak = scenario.startsWith('break');
              const selected = scenario.includes('Middle') ? middle : base;
              if (setupBreak) {
                rotateCard(top, true, logical, container);
              }
              phases.push(snapshot('pre-single', null, logical, container));
              const transitionTraceStart = callTrace.length;
              phases.push(
                snapshot(
                  'post-single',
                  rotateCard(selected, true, logical, container),
                  logical,
                  container
                )
              );
              transitionTrace = callTrace.slice(transitionTraceStart);
            } else if (
              scenario === 'ordinaryReturnedFromTopMiddleSingle' ||
              scenario === 'ordinaryReturnedFromTopBaseSingle' ||
              scenario === 'ordinaryReturnedFromMiddleMiddleSingle' ||
              scenario === 'ordinaryReturnedFromMiddleBaseSingle' ||
              scenario === 'ordinaryReturnedFromBaseMiddleSingle' ||
              scenario === 'ordinaryReturnedFromBaseBaseSingle' ||
              scenario === 'breakReturnedFromTopMiddleSingle' ||
              scenario === 'breakReturnedFromTopBaseSingle' ||
              scenario === 'breakReturnedFromMiddleMiddleSingle' ||
              scenario === 'breakReturnedFromMiddleBaseSingle' ||
              scenario === 'breakReturnedFromBaseMiddleSingle' ||
              scenario === 'breakReturnedFromBaseBaseSingle'
            ) {
              const metadata = {
                ordinaryReturnedFromTopMiddleSingle: {
                  composition: 'ordinary',
                  groupInitiatorRole: 'top',
                  selectedRole: 'middle',
                },
                ordinaryReturnedFromTopBaseSingle: {
                  composition: 'ordinary',
                  groupInitiatorRole: 'top',
                  selectedRole: 'base',
                },
                ordinaryReturnedFromMiddleMiddleSingle: {
                  composition: 'ordinary',
                  groupInitiatorRole: 'middle',
                  selectedRole: 'middle',
                },
                ordinaryReturnedFromMiddleBaseSingle: {
                  composition: 'ordinary',
                  groupInitiatorRole: 'middle',
                  selectedRole: 'base',
                },
                ordinaryReturnedFromBaseMiddleSingle: {
                  composition: 'ordinary',
                  groupInitiatorRole: 'base',
                  selectedRole: 'middle',
                },
                ordinaryReturnedFromBaseBaseSingle: {
                  composition: 'ordinary',
                  groupInitiatorRole: 'base',
                  selectedRole: 'base',
                },
                breakReturnedFromTopMiddleSingle: {
                  composition: 'break',
                  groupInitiatorRole: 'top',
                  selectedRole: 'middle',
                },
                breakReturnedFromTopBaseSingle: {
                  composition: 'break',
                  groupInitiatorRole: 'top',
                  selectedRole: 'base',
                },
                breakReturnedFromMiddleMiddleSingle: {
                  composition: 'break',
                  groupInitiatorRole: 'middle',
                  selectedRole: 'middle',
                },
                breakReturnedFromMiddleBaseSingle: {
                  composition: 'break',
                  groupInitiatorRole: 'middle',
                  selectedRole: 'base',
                },
                breakReturnedFromBaseMiddleSingle: {
                  composition: 'break',
                  groupInitiatorRole: 'base',
                  selectedRole: 'middle',
                },
                breakReturnedFromBaseBaseSingle: {
                  composition: 'break',
                  groupInitiatorRole: 'base',
                  selectedRole: 'base',
                },
              } as const;
              const scenarioMetadata = metadata[scenario];
              const cardsByRole = { top, middle, base } as const;
              const groupInitiator =
                cardsByRole[scenarioMetadata.groupInitiatorRole];
              const selected = cardsByRole[scenarioMetadata.selectedRole];
              if (scenarioMetadata.composition === 'break') {
                rotateCard(top, true, logical, container);
              }

              rotateCard(groupInitiator, false, logical, container);
              const oldContainer = container;
              const cardNodesBeforeRefresh = logical.map((card) => card.image);
              const refreshed = refresh(logical, oldContainer);
              container = refreshed.container;
              await waitForStableLayout();
              refreshEvidence = {
                synchronousWrapperCount: refreshed.synchronousWrapperCount,
                oldWrapperConnectedImmediately:
                  refreshed.oldWrapperConnectedImmediately,
                stableWrapperCount: zone.querySelectorAll(
                  ':scope > [data-legacy-compound-rotation-stack-id]'
                ).length,
                oldWrapperConnectedAfterSettle: oldContainer.isConnected,
                wrapperIdentityChanged: oldContainer !== container,
                cardNodeIdentityPreserved: cardNodesBeforeRefresh.every(
                  (node, index) => logical[index]?.image === node
                ),
              };
              for (let count = 1; count < 4; count += 1) {
                rotateCard(groupInitiator, false, logical, container);
              }

              phases.push(snapshot('pre-single', null, logical, container));
              const transitionTraceStart = callTrace.length;
              phases.push(
                snapshot(
                  'post-single',
                  rotateCard(selected, true, logical, container),
                  logical,
                  container
                )
              );
              transitionTrace = callTrace.slice(transitionTraceStart);
            } else if (
              scenario === 'ordinaryMiddleThirdSingleAtHistoryQ0' ||
              scenario === 'ordinaryBaseThirdSingleAtHistoryQ0' ||
              scenario === 'breakMiddleThirdSingleAtHistoryQ0' ||
              scenario === 'breakBaseThirdSingleAtHistoryQ0'
            ) {
              const setupBreak = scenario.startsWith('break');
              const selected = scenario.includes('Middle') ? middle : base;
              if (setupBreak) {
                rotateCard(top, true, logical, container);
              }
              rotateCard(selected, true, logical, container);
              rotateCard(selected, true, logical, container);
              phases.push(snapshot('pre-single', null, logical, container));
              const transitionTraceStart = callTrace.length;
              phases.push(
                snapshot(
                  'post-single',
                  rotateCard(selected, true, logical, container),
                  logical,
                  container
                )
              );
              transitionTrace = callTrace.slice(transitionTraceStart);
            } else if (
              scenario === 'ordinaryMiddleSingleAtGroupQ1' ||
              scenario === 'ordinaryMiddleSingleAtGroupQ2' ||
              scenario === 'ordinaryMiddleSingleAtGroupQ3' ||
              scenario === 'ordinaryBaseSingleAtGroupQ1' ||
              scenario === 'ordinaryBaseSingleAtGroupQ2' ||
              scenario === 'ordinaryBaseSingleAtGroupQ3' ||
              scenario === 'breakMiddleSingleAtGroupQ1' ||
              scenario === 'breakMiddleSingleAtGroupQ2' ||
              scenario === 'breakMiddleSingleAtGroupQ3' ||
              scenario === 'breakBaseSingleAtGroupQ1' ||
              scenario === 'breakBaseSingleAtGroupQ2' ||
              scenario === 'breakBaseSingleAtGroupQ3'
            ) {
              const metadata = {
                ordinaryMiddleSingleAtGroupQ1: {
                  composition: 'ordinary',
                  role: 'middle',
                  groupTurns: 1,
                },
                ordinaryMiddleSingleAtGroupQ2: {
                  composition: 'ordinary',
                  role: 'middle',
                  groupTurns: 2,
                },
                ordinaryMiddleSingleAtGroupQ3: {
                  composition: 'ordinary',
                  role: 'middle',
                  groupTurns: 3,
                },
                ordinaryBaseSingleAtGroupQ1: {
                  composition: 'ordinary',
                  role: 'base',
                  groupTurns: 1,
                },
                ordinaryBaseSingleAtGroupQ2: {
                  composition: 'ordinary',
                  role: 'base',
                  groupTurns: 2,
                },
                ordinaryBaseSingleAtGroupQ3: {
                  composition: 'ordinary',
                  role: 'base',
                  groupTurns: 3,
                },
                breakMiddleSingleAtGroupQ1: {
                  composition: 'break',
                  role: 'middle',
                  groupTurns: 1,
                },
                breakMiddleSingleAtGroupQ2: {
                  composition: 'break',
                  role: 'middle',
                  groupTurns: 2,
                },
                breakMiddleSingleAtGroupQ3: {
                  composition: 'break',
                  role: 'middle',
                  groupTurns: 3,
                },
                breakBaseSingleAtGroupQ1: {
                  composition: 'break',
                  role: 'base',
                  groupTurns: 1,
                },
                breakBaseSingleAtGroupQ2: {
                  composition: 'break',
                  role: 'base',
                  groupTurns: 2,
                },
                breakBaseSingleAtGroupQ3: {
                  composition: 'break',
                  role: 'base',
                  groupTurns: 3,
                },
              } as const;
              const selected =
                metadata[scenario].role === 'middle' ? middle : base;
              if (metadata[scenario].composition === 'break') {
                rotateCard(top, true, logical, container);
              }
              for (
                let count = 0;
                count < metadata[scenario].groupTurns;
                count += 1
              ) {
                rotateCard(top, false, logical, container);
              }
              phases.push(snapshot('pre-single', null, logical, container));
              const transitionTraceStart = callTrace.length;
              phases.push(
                snapshot(
                  'post-single',
                  rotateCard(selected, true, logical, container),
                  logical,
                  container
                )
              );
              transitionTrace = callTrace.slice(transitionTraceStart);
            } else if (
              scenario === 'ordinaryMiddleFollowupSingleAfterGroupQ1' ||
              scenario === 'ordinaryMiddleFollowupSingleAfterGroupQ2' ||
              scenario === 'ordinaryMiddleFollowupSingleAfterGroupQ3' ||
              scenario === 'ordinaryBaseFollowupSingleAfterGroupQ1' ||
              scenario === 'ordinaryBaseFollowupSingleAfterGroupQ2' ||
              scenario === 'ordinaryBaseFollowupSingleAfterGroupQ3' ||
              scenario === 'breakMiddleFollowupSingleAfterGroupQ1' ||
              scenario === 'breakMiddleFollowupSingleAfterGroupQ2' ||
              scenario === 'breakMiddleFollowupSingleAfterGroupQ3' ||
              scenario === 'breakBaseFollowupSingleAfterGroupQ1' ||
              scenario === 'breakBaseFollowupSingleAfterGroupQ2' ||
              scenario === 'breakBaseFollowupSingleAfterGroupQ3'
            ) {
              const metadata = {
                ordinaryMiddleFollowupSingleAfterGroupQ1: {
                  composition: 'ordinary',
                  selectedRole: 'middle',
                  groupTurns: 1,
                },
                ordinaryMiddleFollowupSingleAfterGroupQ2: {
                  composition: 'ordinary',
                  selectedRole: 'middle',
                  groupTurns: 2,
                },
                ordinaryMiddleFollowupSingleAfterGroupQ3: {
                  composition: 'ordinary',
                  selectedRole: 'middle',
                  groupTurns: 3,
                },
                ordinaryBaseFollowupSingleAfterGroupQ1: {
                  composition: 'ordinary',
                  selectedRole: 'base',
                  groupTurns: 1,
                },
                ordinaryBaseFollowupSingleAfterGroupQ2: {
                  composition: 'ordinary',
                  selectedRole: 'base',
                  groupTurns: 2,
                },
                ordinaryBaseFollowupSingleAfterGroupQ3: {
                  composition: 'ordinary',
                  selectedRole: 'base',
                  groupTurns: 3,
                },
                breakMiddleFollowupSingleAfterGroupQ1: {
                  composition: 'break',
                  selectedRole: 'middle',
                  groupTurns: 1,
                },
                breakMiddleFollowupSingleAfterGroupQ2: {
                  composition: 'break',
                  selectedRole: 'middle',
                  groupTurns: 2,
                },
                breakMiddleFollowupSingleAfterGroupQ3: {
                  composition: 'break',
                  selectedRole: 'middle',
                  groupTurns: 3,
                },
                breakBaseFollowupSingleAfterGroupQ1: {
                  composition: 'break',
                  selectedRole: 'base',
                  groupTurns: 1,
                },
                breakBaseFollowupSingleAfterGroupQ2: {
                  composition: 'break',
                  selectedRole: 'base',
                  groupTurns: 2,
                },
                breakBaseFollowupSingleAfterGroupQ3: {
                  composition: 'break',
                  selectedRole: 'base',
                  groupTurns: 3,
                },
              } as const;
              const scenarioMetadata = metadata[scenario];
              const selected =
                scenarioMetadata.selectedRole === 'middle' ? middle : base;
              if (scenarioMetadata.composition === 'break') {
                rotateCard(top, true, logical, container);
              }
              for (
                let count = 0;
                count < scenarioMetadata.groupTurns;
                count += 1
              ) {
                rotateCard(top, false, logical, container);
              }
              rotateCard(selected, true, logical, container);
              phases.push(snapshot('pre-single', null, logical, container));
              const transitionTraceStart = callTrace.length;
              phases.push(
                snapshot(
                  'post-single',
                  rotateCard(selected, true, logical, container),
                  logical,
                  container
                )
              );
              transitionTrace = callTrace.slice(transitionTraceStart);
            } else if (
              scenario === 'ordinaryRefreshAfterMiddleSingleAtGroupQ1' ||
              scenario === 'ordinaryRefreshAfterMiddleSingleAtGroupQ2' ||
              scenario === 'ordinaryRefreshAfterMiddleSingleAtGroupQ3' ||
              scenario === 'ordinaryRefreshAfterBaseSingleAtGroupQ1' ||
              scenario === 'ordinaryRefreshAfterBaseSingleAtGroupQ2' ||
              scenario === 'ordinaryRefreshAfterBaseSingleAtGroupQ3' ||
              scenario === 'breakRefreshAfterMiddleSingleAtGroupQ1' ||
              scenario === 'breakRefreshAfterMiddleSingleAtGroupQ2' ||
              scenario === 'breakRefreshAfterMiddleSingleAtGroupQ3' ||
              scenario === 'breakRefreshAfterBaseSingleAtGroupQ1' ||
              scenario === 'breakRefreshAfterBaseSingleAtGroupQ2' ||
              scenario === 'breakRefreshAfterBaseSingleAtGroupQ3'
            ) {
              const metadata = {
                ordinaryRefreshAfterMiddleSingleAtGroupQ1: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  originalGroupTurns: 1,
                },
                ordinaryRefreshAfterMiddleSingleAtGroupQ2: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  originalGroupTurns: 2,
                },
                ordinaryRefreshAfterMiddleSingleAtGroupQ3: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  originalGroupTurns: 3,
                },
                ordinaryRefreshAfterBaseSingleAtGroupQ1: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  originalGroupTurns: 1,
                },
                ordinaryRefreshAfterBaseSingleAtGroupQ2: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  originalGroupTurns: 2,
                },
                ordinaryRefreshAfterBaseSingleAtGroupQ3: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  originalGroupTurns: 3,
                },
                breakRefreshAfterMiddleSingleAtGroupQ1: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  originalGroupTurns: 1,
                },
                breakRefreshAfterMiddleSingleAtGroupQ2: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  originalGroupTurns: 2,
                },
                breakRefreshAfterMiddleSingleAtGroupQ3: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  originalGroupTurns: 3,
                },
                breakRefreshAfterBaseSingleAtGroupQ1: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  originalGroupTurns: 1,
                },
                breakRefreshAfterBaseSingleAtGroupQ2: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  originalGroupTurns: 2,
                },
                breakRefreshAfterBaseSingleAtGroupQ3: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  originalGroupTurns: 3,
                },
              } as const;
              const scenarioMetadata = metadata[scenario];
              const priorLower =
                scenarioMetadata.priorLowerRole === 'middle' ? middle : base;
              if (scenarioMetadata.composition === 'break') {
                rotateCard(top, true, logical, container);
              }
              for (
                let count = 0;
                count < scenarioMetadata.originalGroupTurns;
                count += 1
              ) {
                rotateCard(top, false, logical, container);
              }
              rotateCard(priorLower, true, logical, container);
              phases.push(snapshot('pre-refresh', null, logical, container));
              const transitionTraceStart = callTrace.length;
              const oldContainer = container;
              const cardNodesBeforeRefresh = logical.map((card) => card.image);
              const refreshed = refresh(logical, oldContainer);
              container = refreshed.container;
              phases.push(
                snapshot('synchronous-post-refresh', null, logical, container)
              );
              await waitForStableLayout();
              refreshEvidence = {
                synchronousWrapperCount: refreshed.synchronousWrapperCount,
                oldWrapperConnectedImmediately:
                  refreshed.oldWrapperConnectedImmediately,
                stableWrapperCount: zone.querySelectorAll(
                  ':scope > [data-legacy-compound-rotation-stack-id]'
                ).length,
                oldWrapperConnectedAfterSettle: oldContainer.isConnected,
                wrapperIdentityChanged: oldContainer !== container,
                cardNodeIdentityPreserved: cardNodesBeforeRefresh.every(
                  (node, index) => logical[index]?.image === node
                ),
              };
              transitionTrace = callTrace.slice(transitionTraceStart);
              phases.push(
                snapshot('settled-post-refresh', null, logical, container)
              );
            } else if (
              scenario ===
                'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ1' ||
              scenario ===
                'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ2' ||
              scenario ===
                'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ3' ||
              scenario === 'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ1' ||
              scenario === 'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ2' ||
              scenario === 'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ3' ||
              scenario === 'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ1' ||
              scenario === 'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ2' ||
              scenario === 'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ3' ||
              scenario === 'breakBaseSecondGroupAfterBaseSingleAtGroupQ1' ||
              scenario === 'breakBaseSecondGroupAfterBaseSingleAtGroupQ2' ||
              scenario === 'breakBaseSecondGroupAfterBaseSingleAtGroupQ3'
            ) {
              const metadata = {
                ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ1: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 1,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
                ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ2: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 2,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
                ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ3: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 3,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
                ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ1: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 1,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
                ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ2: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 2,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
                ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ3: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 3,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
                breakMiddleSecondGroupAfterMiddleSingleAtGroupQ1: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 1,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
                breakMiddleSecondGroupAfterMiddleSingleAtGroupQ2: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 2,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
                breakMiddleSecondGroupAfterMiddleSingleAtGroupQ3: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 3,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
                breakBaseSecondGroupAfterBaseSingleAtGroupQ1: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 1,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
                breakBaseSecondGroupAfterBaseSingleAtGroupQ2: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 2,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
                breakBaseSecondGroupAfterBaseSingleAtGroupQ3: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 3,
                  setupGroupRotationCount: 1,
                  measuredGroupRotationOrdinal: 2,
                  measuredSingle: false,
                },
              } as const;
              const scenarioMetadata = metadata[scenario];
              const priorLower =
                scenarioMetadata.priorLowerRole === 'middle' ? middle : base;
              if (scenarioMetadata.composition === 'break') {
                rotateCard(top, true, logical, container);
              }
              for (
                let count = 0;
                count < scenarioMetadata.originalGroupTurns;
                count += 1
              ) {
                rotateCard(top, false, logical, container);
              }
              rotateCard(priorLower, true, logical, container);
              for (
                let count = 0;
                count < scenarioMetadata.setupGroupRotationCount;
                count += 1
              ) {
                rotateCard(priorLower, false, logical, container);
              }
              const domImages = [
                ...container.querySelectorAll<CompoundImage>(':scope > img'),
              ];
              if (
                logical.indexOf(priorLower) !==
                  scenarioMetadata.priorLowerIndex ||
                domImages.indexOf(priorLower.image) !==
                  scenarioMetadata.priorLowerDomOrdinal
              ) {
                throw new Error(
                  `Legacy compound second-group topology mismatch for ${scenario}`
                );
              }
              phases.push(
                snapshot('pre-second-group-rotation', null, logical, container)
              );
              const transitionTraceStart = callTrace.length;
              phases.push(
                snapshot(
                  'post-second-group-rotation',
                  rotateCard(
                    priorLower,
                    scenarioMetadata.measuredSingle,
                    logical,
                    container
                  ),
                  logical,
                  container
                )
              );
              transitionTrace = callTrace.slice(transitionTraceStart);
            } else if (
              scenario === 'ordinaryTopGroupAfterMiddleSingleAtGroupQ1' ||
              scenario === 'ordinaryTopGroupAfterMiddleSingleAtGroupQ2' ||
              scenario === 'ordinaryTopGroupAfterMiddleSingleAtGroupQ3' ||
              scenario === 'ordinaryTopGroupAfterBaseSingleAtGroupQ1' ||
              scenario === 'ordinaryTopGroupAfterBaseSingleAtGroupQ2' ||
              scenario === 'ordinaryTopGroupAfterBaseSingleAtGroupQ3' ||
              scenario === 'breakTopGroupAfterMiddleSingleAtGroupQ1' ||
              scenario === 'breakTopGroupAfterMiddleSingleAtGroupQ2' ||
              scenario === 'breakTopGroupAfterMiddleSingleAtGroupQ3' ||
              scenario === 'breakTopGroupAfterBaseSingleAtGroupQ1' ||
              scenario === 'breakTopGroupAfterBaseSingleAtGroupQ2' ||
              scenario === 'breakTopGroupAfterBaseSingleAtGroupQ3' ||
              scenario === 'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ1' ||
              scenario === 'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ2' ||
              scenario === 'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ3' ||
              scenario === 'ordinaryBaseGroupAfterBaseSingleAtGroupQ1' ||
              scenario === 'ordinaryBaseGroupAfterBaseSingleAtGroupQ2' ||
              scenario === 'ordinaryBaseGroupAfterBaseSingleAtGroupQ3' ||
              scenario === 'breakMiddleGroupAfterMiddleSingleAtGroupQ1' ||
              scenario === 'breakMiddleGroupAfterMiddleSingleAtGroupQ2' ||
              scenario === 'breakMiddleGroupAfterMiddleSingleAtGroupQ3' ||
              scenario === 'breakBaseGroupAfterBaseSingleAtGroupQ1' ||
              scenario === 'breakBaseGroupAfterBaseSingleAtGroupQ2' ||
              scenario === 'breakBaseGroupAfterBaseSingleAtGroupQ3' ||
              scenario === 'ordinaryBaseGroupAfterMiddleSingleAtGroupQ1' ||
              scenario === 'ordinaryBaseGroupAfterMiddleSingleAtGroupQ2' ||
              scenario === 'ordinaryBaseGroupAfterMiddleSingleAtGroupQ3' ||
              scenario === 'ordinaryMiddleGroupAfterBaseSingleAtGroupQ1' ||
              scenario === 'ordinaryMiddleGroupAfterBaseSingleAtGroupQ2' ||
              scenario === 'ordinaryMiddleGroupAfterBaseSingleAtGroupQ3' ||
              scenario === 'breakBaseGroupAfterMiddleSingleAtGroupQ1' ||
              scenario === 'breakBaseGroupAfterMiddleSingleAtGroupQ2' ||
              scenario === 'breakBaseGroupAfterMiddleSingleAtGroupQ3' ||
              scenario === 'breakMiddleGroupAfterBaseSingleAtGroupQ1' ||
              scenario === 'breakMiddleGroupAfterBaseSingleAtGroupQ2' ||
              scenario === 'breakMiddleGroupAfterBaseSingleAtGroupQ3'
            ) {
              const metadata = {
                ordinaryTopGroupAfterMiddleSingleAtGroupQ1: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 1,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                ordinaryTopGroupAfterMiddleSingleAtGroupQ2: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 2,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                ordinaryTopGroupAfterMiddleSingleAtGroupQ3: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 3,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                ordinaryTopGroupAfterBaseSingleAtGroupQ1: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 1,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                ordinaryTopGroupAfterBaseSingleAtGroupQ2: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 2,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                ordinaryTopGroupAfterBaseSingleAtGroupQ3: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 3,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                breakTopGroupAfterMiddleSingleAtGroupQ1: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 1,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                breakTopGroupAfterMiddleSingleAtGroupQ2: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 2,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                breakTopGroupAfterMiddleSingleAtGroupQ3: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 3,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                breakTopGroupAfterBaseSingleAtGroupQ1: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 1,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                breakTopGroupAfterBaseSingleAtGroupQ2: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 2,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                breakTopGroupAfterBaseSingleAtGroupQ3: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 3,
                  measuredRole: 'top',
                  measuredIndex: 0,
                  measuredDomOrdinal: 0,
                  measuredSingle: false,
                },
                ordinaryMiddleGroupAfterMiddleSingleAtGroupQ1: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 1,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
                ordinaryMiddleGroupAfterMiddleSingleAtGroupQ2: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 2,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
                ordinaryMiddleGroupAfterMiddleSingleAtGroupQ3: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 3,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
                ordinaryBaseGroupAfterBaseSingleAtGroupQ1: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 1,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                ordinaryBaseGroupAfterBaseSingleAtGroupQ2: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 2,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                ordinaryBaseGroupAfterBaseSingleAtGroupQ3: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 3,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                breakMiddleGroupAfterMiddleSingleAtGroupQ1: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 1,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
                breakMiddleGroupAfterMiddleSingleAtGroupQ2: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 2,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
                breakMiddleGroupAfterMiddleSingleAtGroupQ3: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 3,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
                breakBaseGroupAfterBaseSingleAtGroupQ1: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 1,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                breakBaseGroupAfterBaseSingleAtGroupQ2: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 2,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                breakBaseGroupAfterBaseSingleAtGroupQ3: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 3,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                ordinaryBaseGroupAfterMiddleSingleAtGroupQ1: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 1,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                ordinaryBaseGroupAfterMiddleSingleAtGroupQ2: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 2,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                ordinaryBaseGroupAfterMiddleSingleAtGroupQ3: {
                  composition: 'ordinary',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 3,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                ordinaryMiddleGroupAfterBaseSingleAtGroupQ1: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 1,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
                ordinaryMiddleGroupAfterBaseSingleAtGroupQ2: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 2,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
                ordinaryMiddleGroupAfterBaseSingleAtGroupQ3: {
                  composition: 'ordinary',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 3,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
                breakBaseGroupAfterMiddleSingleAtGroupQ1: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 1,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                breakBaseGroupAfterMiddleSingleAtGroupQ2: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 2,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                breakBaseGroupAfterMiddleSingleAtGroupQ3: {
                  composition: 'break',
                  priorLowerRole: 'middle',
                  priorLowerIndex: 1,
                  priorLowerDomOrdinal: 2,
                  originalGroupTurns: 3,
                  measuredRole: 'base',
                  measuredIndex: 2,
                  measuredDomOrdinal: 1,
                  measuredSingle: false,
                },
                breakMiddleGroupAfterBaseSingleAtGroupQ1: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 1,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
                breakMiddleGroupAfterBaseSingleAtGroupQ2: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 2,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
                breakMiddleGroupAfterBaseSingleAtGroupQ3: {
                  composition: 'break',
                  priorLowerRole: 'base',
                  priorLowerIndex: 2,
                  priorLowerDomOrdinal: 1,
                  originalGroupTurns: 3,
                  measuredRole: 'middle',
                  measuredIndex: 1,
                  measuredDomOrdinal: 2,
                  measuredSingle: false,
                },
              } as const;
              const scenarioMetadata = metadata[scenario];
              const cardsByRole = { top, middle, base } as const;
              const priorLower = cardsByRole[scenarioMetadata.priorLowerRole];
              const measured = cardsByRole[scenarioMetadata.measuredRole];
              if (scenarioMetadata.composition === 'break') {
                rotateCard(top, true, logical, container);
              }
              for (
                let count = 0;
                count < scenarioMetadata.originalGroupTurns;
                count += 1
              ) {
                rotateCard(top, false, logical, container);
              }
              rotateCard(priorLower, true, logical, container);
              const domImages = [
                ...container.querySelectorAll<CompoundImage>(':scope > img'),
              ];
              if (
                logical.indexOf(priorLower) !==
                  scenarioMetadata.priorLowerIndex ||
                domImages.indexOf(priorLower.image) !==
                  scenarioMetadata.priorLowerDomOrdinal ||
                logical.indexOf(measured) !== scenarioMetadata.measuredIndex ||
                domImages.indexOf(measured.image) !==
                  scenarioMetadata.measuredDomOrdinal
              ) {
                throw new Error(
                  `Legacy compound rotation-after-single topology mismatch for ${scenario}`
                );
              }
              phases.push(
                snapshot('pre-group-rotation', null, logical, container)
              );
              const transitionTraceStart = callTrace.length;
              phases.push(
                snapshot(
                  'post-group-rotation',
                  rotateCard(
                    measured,
                    scenarioMetadata.measuredSingle,
                    logical,
                    container
                  ),
                  logical,
                  container
                )
              );
              transitionTrace = callTrace.slice(transitionTraceStart);
            } else if (
              scenario === 'ordinarySingleAtGroupQ1' ||
              scenario === 'ordinarySingleAtGroupQ2' ||
              scenario === 'ordinarySingleAtGroupQ3' ||
              scenario === 'breakSingleAtGroupQ1' ||
              scenario === 'breakSingleAtGroupQ2' ||
              scenario === 'breakSingleAtGroupQ3'
            ) {
              const setupBreak = scenario.startsWith('breakSingle');
              const setupGroupTurns = scenario.endsWith('Q1')
                ? 1
                : scenario.endsWith('Q2')
                  ? 2
                  : 3;
              if (setupBreak) {
                rotateCard(top, true, logical, container);
              }
              for (let count = 0; count < setupGroupTurns; count += 1) {
                rotateCard(top, false, logical, container);
              }
              phases.push(snapshot('pre-single', null, logical, container));
              const transitionTraceStart = callTrace.length;
              phases.push(
                snapshot(
                  'post-single',
                  rotateCard(top, true, logical, container),
                  logical,
                  container
                )
              );
              transitionTrace = callTrace.slice(transitionTraceStart);
            } else {
              rotateCard(top, true, logical, container);
              const setupGroupTurns =
                scenario === 'breakRefreshQ2'
                  ? 2
                  : scenario === 'breakRefreshQ3'
                    ? 3
                    : scenario === 'breakRefreshReturnedQ0'
                      ? 4
                      : 0;
              for (let count = 0; count < setupGroupTurns; count += 1) {
                rotateCard(top, false, logical, container);
              }
              phases.push(snapshot('pre-refresh', null, logical, container));
              const transitionTraceStart = callTrace.length;
              const oldContainer = container;
              const cardNodesBeforeRefresh = logical.map((card) => card.image);
              const refreshed = refresh(logical, oldContainer);
              container = refreshed.container;
              phases.push(
                snapshot('synchronous-post-refresh', null, logical, container)
              );
              await waitForStableLayout();
              refreshEvidence = {
                synchronousWrapperCount: refreshed.synchronousWrapperCount,
                oldWrapperConnectedImmediately:
                  refreshed.oldWrapperConnectedImmediately,
                stableWrapperCount: zone.querySelectorAll(
                  ':scope > [data-legacy-compound-rotation-stack-id]'
                ).length,
                oldWrapperConnectedAfterSettle: oldContainer.isConnected,
                wrapperIdentityChanged: oldContainer !== container,
                cardNodeIdentityPreserved: cardNodesBeforeRefresh.every(
                  (node, index) => logical[index]?.image === node
                ),
              };
              transitionTrace = callTrace.slice(transitionTraceStart);
              phases.push(
                snapshot('settled-post-refresh', null, logical, container)
              );
            }

            const resizeCallbacksBeforeCardRemoval = resizeCallbacks;
            for (const card of logical) card.image.remove();
            await waitForStableLayout();
            const resizeCallbacksAfterCardRemoval = resizeCallbacks;
            const cleanup: LegacyFixtureCleanup = {
              observedWrapperCount: body.querySelectorAll(
                `[data-legacy-compound-rotation-stack-id^="${prefix}"]`
              ).length,
              observedCardCount: body.querySelectorAll(
                `[data-legacy-compound-rotation-card-id^="${prefix}"]`
              ).length,
              sinkConnected: false,
            };
            const observers = {
              mutationObserversCreated: mutationObservers.length,
              resizeObserversCreated: resizeObservers.length,
              resizeCallbacksBeforeCardRemoval,
              resizeCallbacksAfterCardRemoval,
              transcribedSourceDisconnectCalls,
              harnessRetainedSourceShapedObserverHandlesBeforeCleanup:
                mutationObservers.length > 0 && resizeObservers.length > 0,
              harnessMutationDisconnectCalls: 0,
              harnessResizeDisconnectCalls: 0,
            };
            for (const observer of mutationObservers) {
              observer.disconnect();
              observers.harnessMutationDisconnectCalls += 1;
            }
            for (const observer of resizeObservers) {
              observer.disconnect();
              observers.harnessResizeDisconnectCalls += 1;
            }
            return {
              id: prefix,
              slot,
              scenario,
              phases,
              callTrace,
              transitionTrace,
              refresh: refreshEvidence,
              observers,
              cleanup,
            };
          };

          const cases: RawCompoundRotationCase[] = [];
          const scenarios: readonly LegacyCompoundRotationScenario[] =
            input.mode === 'canonical'
              ? ['ordinaryGroup', 'breakGroup']
              : input.mode === 'lowerGroupInitiator'
                ? [
                    'ordinaryGroupFromMiddle',
                    'ordinaryGroupFromBase',
                    'breakGroupFromMiddle',
                    'breakGroupFromBase',
                  ]
                : input.mode === 'lowerQ0Single'
                  ? [
                      'ordinaryMiddleSingleAtGroupQ0',
                      'ordinaryBaseSingleAtGroupQ0',
                      'breakMiddleSingleAtGroupQ0',
                      'breakBaseSingleAtGroupQ0',
                    ]
                  : input.mode === 'lowerReturnedQ0SingleOrdinary'
                    ? [
                        'ordinaryReturnedFromTopMiddleSingle',
                        'ordinaryReturnedFromTopBaseSingle',
                        'ordinaryReturnedFromMiddleMiddleSingle',
                        'ordinaryReturnedFromMiddleBaseSingle',
                        'ordinaryReturnedFromBaseMiddleSingle',
                        'ordinaryReturnedFromBaseBaseSingle',
                      ]
                    : input.mode === 'lowerReturnedQ0SingleBreak'
                      ? [
                          'breakReturnedFromTopMiddleSingle',
                          'breakReturnedFromTopBaseSingle',
                          'breakReturnedFromMiddleMiddleSingle',
                          'breakReturnedFromMiddleBaseSingle',
                          'breakReturnedFromBaseMiddleSingle',
                          'breakReturnedFromBaseBaseSingle',
                        ]
                      : input.mode === 'lowerHistoryAuthoredQ0Single'
                        ? [
                            'ordinaryMiddleThirdSingleAtHistoryQ0',
                            'ordinaryBaseThirdSingleAtHistoryQ0',
                            'breakMiddleThirdSingleAtHistoryQ0',
                            'breakBaseThirdSingleAtHistoryQ0',
                          ]
                        : input.mode === 'lowerNonzeroGroupSingleOrdinary'
                          ? [
                              'ordinaryMiddleSingleAtGroupQ1',
                              'ordinaryMiddleSingleAtGroupQ2',
                              'ordinaryMiddleSingleAtGroupQ3',
                              'ordinaryBaseSingleAtGroupQ1',
                              'ordinaryBaseSingleAtGroupQ2',
                              'ordinaryBaseSingleAtGroupQ3',
                            ]
                          : input.mode === 'lowerNonzeroGroupSingleBreak'
                            ? [
                                'breakMiddleSingleAtGroupQ1',
                                'breakMiddleSingleAtGroupQ2',
                                'breakMiddleSingleAtGroupQ3',
                                'breakBaseSingleAtGroupQ1',
                                'breakBaseSingleAtGroupQ2',
                                'breakBaseSingleAtGroupQ3',
                              ]
                            : input.mode ===
                                'lowerNonzeroGroupSingleFollowupOrdinary'
                              ? [
                                  'ordinaryMiddleFollowupSingleAfterGroupQ1',
                                  'ordinaryMiddleFollowupSingleAfterGroupQ2',
                                  'ordinaryMiddleFollowupSingleAfterGroupQ3',
                                  'ordinaryBaseFollowupSingleAfterGroupQ1',
                                  'ordinaryBaseFollowupSingleAfterGroupQ2',
                                  'ordinaryBaseFollowupSingleAfterGroupQ3',
                                ]
                              : input.mode ===
                                  'lowerNonzeroGroupSingleFollowupBreak'
                                ? [
                                    'breakMiddleFollowupSingleAfterGroupQ1',
                                    'breakMiddleFollowupSingleAfterGroupQ2',
                                    'breakMiddleFollowupSingleAfterGroupQ3',
                                    'breakBaseFollowupSingleAfterGroupQ1',
                                    'breakBaseFollowupSingleAfterGroupQ2',
                                    'breakBaseFollowupSingleAfterGroupQ3',
                                  ]
                                : input.mode ===
                                    'lowerNonzeroGroupRotationAfterSingleOrdinary'
                                  ? [
                                      'ordinaryTopGroupAfterMiddleSingleAtGroupQ1',
                                      'ordinaryTopGroupAfterMiddleSingleAtGroupQ2',
                                      'ordinaryTopGroupAfterMiddleSingleAtGroupQ3',
                                      'ordinaryTopGroupAfterBaseSingleAtGroupQ1',
                                      'ordinaryTopGroupAfterBaseSingleAtGroupQ2',
                                      'ordinaryTopGroupAfterBaseSingleAtGroupQ3',
                                    ]
                                  : input.mode ===
                                      'lowerNonzeroGroupRotationAfterSingleBreak'
                                    ? [
                                        'breakTopGroupAfterMiddleSingleAtGroupQ1',
                                        'breakTopGroupAfterMiddleSingleAtGroupQ2',
                                        'breakTopGroupAfterMiddleSingleAtGroupQ3',
                                        'breakTopGroupAfterBaseSingleAtGroupQ1',
                                        'breakTopGroupAfterBaseSingleAtGroupQ2',
                                        'breakTopGroupAfterBaseSingleAtGroupQ3',
                                      ]
                                    : input.mode ===
                                        'lowerNonzeroSameLowerGroupAfterSingleOrdinary'
                                      ? [
                                          'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ1',
                                          'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ2',
                                          'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ3',
                                          'ordinaryBaseGroupAfterBaseSingleAtGroupQ1',
                                          'ordinaryBaseGroupAfterBaseSingleAtGroupQ2',
                                          'ordinaryBaseGroupAfterBaseSingleAtGroupQ3',
                                        ]
                                      : input.mode ===
                                          'lowerNonzeroSameLowerGroupAfterSingleBreak'
                                        ? [
                                            'breakMiddleGroupAfterMiddleSingleAtGroupQ1',
                                            'breakMiddleGroupAfterMiddleSingleAtGroupQ2',
                                            'breakMiddleGroupAfterMiddleSingleAtGroupQ3',
                                            'breakBaseGroupAfterBaseSingleAtGroupQ1',
                                            'breakBaseGroupAfterBaseSingleAtGroupQ2',
                                            'breakBaseGroupAfterBaseSingleAtGroupQ3',
                                          ]
                                        : input.mode ===
                                            'lowerNonzeroDifferentLowerGroupAfterSingleOrdinary'
                                          ? [
                                              'ordinaryBaseGroupAfterMiddleSingleAtGroupQ1',
                                              'ordinaryBaseGroupAfterMiddleSingleAtGroupQ2',
                                              'ordinaryBaseGroupAfterMiddleSingleAtGroupQ3',
                                              'ordinaryMiddleGroupAfterBaseSingleAtGroupQ1',
                                              'ordinaryMiddleGroupAfterBaseSingleAtGroupQ2',
                                              'ordinaryMiddleGroupAfterBaseSingleAtGroupQ3',
                                            ]
                                          : input.mode ===
                                              'lowerNonzeroDifferentLowerGroupAfterSingleBreak'
                                            ? [
                                                'breakBaseGroupAfterMiddleSingleAtGroupQ1',
                                                'breakBaseGroupAfterMiddleSingleAtGroupQ2',
                                                'breakBaseGroupAfterMiddleSingleAtGroupQ3',
                                                'breakMiddleGroupAfterBaseSingleAtGroupQ1',
                                                'breakMiddleGroupAfterBaseSingleAtGroupQ2',
                                                'breakMiddleGroupAfterBaseSingleAtGroupQ3',
                                              ]
                                            : input.mode ===
                                                'lowerNonzeroSameLowerSecondGroupAfterSingleOrdinary'
                                              ? [
                                                  'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ1',
                                                  'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ2',
                                                  'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ3',
                                                  'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ1',
                                                  'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ2',
                                                  'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ3',
                                                ]
                                              : input.mode ===
                                                  'lowerNonzeroSameLowerSecondGroupAfterSingleBreak'
                                                ? [
                                                    'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ1',
                                                    'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ2',
                                                    'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ3',
                                                    'breakBaseSecondGroupAfterBaseSingleAtGroupQ1',
                                                    'breakBaseSecondGroupAfterBaseSingleAtGroupQ2',
                                                    'breakBaseSecondGroupAfterBaseSingleAtGroupQ3',
                                                  ]
                                                : input.mode ===
                                                    'lowerNonzeroGroupRefreshAfterSingleOrdinary'
                                                  ? [
                                                      'ordinaryRefreshAfterMiddleSingleAtGroupQ1',
                                                      'ordinaryRefreshAfterMiddleSingleAtGroupQ2',
                                                      'ordinaryRefreshAfterMiddleSingleAtGroupQ3',
                                                      'ordinaryRefreshAfterBaseSingleAtGroupQ1',
                                                      'ordinaryRefreshAfterBaseSingleAtGroupQ2',
                                                      'ordinaryRefreshAfterBaseSingleAtGroupQ3',
                                                    ]
                                                  : input.mode ===
                                                      'lowerNonzeroGroupRefreshAfterSingleBreak'
                                                    ? [
                                                        'breakRefreshAfterMiddleSingleAtGroupQ1',
                                                        'breakRefreshAfterMiddleSingleAtGroupQ2',
                                                        'breakRefreshAfterMiddleSingleAtGroupQ3',
                                                        'breakRefreshAfterBaseSingleAtGroupQ1',
                                                        'breakRefreshAfterBaseSingleAtGroupQ2',
                                                        'breakRefreshAfterBaseSingleAtGroupQ3',
                                                      ]
                                                    : input.mode ===
                                                        'nonzeroGroupSingle'
                                                      ? [
                                                          'ordinarySingleAtGroupQ1',
                                                          'ordinarySingleAtGroupQ2',
                                                          'ordinarySingleAtGroupQ3',
                                                          'breakSingleAtGroupQ1',
                                                          'breakSingleAtGroupQ2',
                                                          'breakSingleAtGroupQ3',
                                                        ]
                                                      : input.mode ===
                                                          'breakRefreshQ0Q2'
                                                        ? [
                                                            'breakRefreshFreshQ0',
                                                            'breakRefreshReturnedQ0',
                                                            'breakRefreshQ2',
                                                          ]
                                                        : ['breakRefreshQ3'];
          for (const scenario of scenarios) {
            for (const slot of ['active', 'bench'] as const) {
              cases.push(await runScenario(slot, scenario));
            }
          }
          return cases;
        },
        { side, mode }
      );
    rawCases.push(...captured.map((value) => ({ side, value })));
  }

  const frames = {
    local: await requireRect(page.locator('#selfContainer'), '#selfContainer'),
    opponent: await requireRect(page.locator('#oppContainer'), '#oppContainer'),
  };
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const physicalRect = (
    side: LegacyFixtureSide,
    bounds: CapturedRect
  ): CapturedRect =>
    side === 'local'
      ? {
          x: frames.local.x + bounds.x,
          y: frames.local.y + bounds.y,
          width: bounds.width,
          height: bounds.height,
        }
      : {
          x:
            frames.opponent.x + frames.opponent.width - bounds.x - bounds.width,
          y:
            frames.opponent.y +
            frames.opponent.height -
            bounds.y -
            bounds.height,
          width: bounds.width,
          height: bounds.height,
        };
  const physicalPoint = (
    side: LegacyFixtureSide,
    point: CapturedPoint | null
  ): CapturedPoint | null =>
    point === null
      ? null
      : side === 'local'
        ? { x: frames.local.x + point.x, y: frames.local.y + point.y }
        : {
            x: frames.opponent.x + frames.opponent.width - point.x,
            y: frames.opponent.y + frames.opponent.height - point.y,
          };
  const cases: LegacyCompoundRotationCase[] = rawCases.map(
    ({ side: caseSide, value }) => ({
      ...value,
      side: caseSide,
      phases: value.phases.map((phase) => ({
        ...phase,
        cards: phase.cards.map((card) => ({
          ...card,
          physicalBounds: physicalRect(caseSide, card.frameLocalBounds),
          effectiveRotationDegrees:
            (card.localRotationDegrees +
              frameTransforms[caseSide].rotationDegrees) %
            360,
        })),
        stack: {
          ...phase.stack,
          physicalBounds: physicalRect(caseSide, phase.stack.frameLocalBounds),
          hitPointsPhysical: Object.fromEntries(
            Object.entries(phase.stack.hitPointsFrameLocal).map(
              ([key, point]) => [key, physicalPoint(caseSide, point)]
            )
          ) as LegacyCompoundRotationStack['hitPointsPhysical'],
        },
      })),
    })
  );

  requireServedPaths(loaded, evolutionFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames,
    frameTransforms,
    ordinaryGroupCases: cases.filter(
      (entry) => entry.scenario === 'ordinaryGroup'
    ),
    breakGroupCases: cases.filter((entry) => entry.scenario === 'breakGroup'),
    lowerGroupInitiatorCases: cases.filter(
      (entry) =>
        entry.scenario === 'ordinaryGroupFromMiddle' ||
        entry.scenario === 'ordinaryGroupFromBase' ||
        entry.scenario === 'breakGroupFromMiddle' ||
        entry.scenario === 'breakGroupFromBase'
    ),
    lowerQ0SingleCases: cases.filter(
      (entry) =>
        entry.scenario === 'ordinaryMiddleSingleAtGroupQ0' ||
        entry.scenario === 'ordinaryBaseSingleAtGroupQ0' ||
        entry.scenario === 'breakMiddleSingleAtGroupQ0' ||
        entry.scenario === 'breakBaseSingleAtGroupQ0'
    ),
    lowerReturnedQ0SingleCases: cases.filter(
      (entry) =>
        entry.scenario === 'ordinaryReturnedFromTopMiddleSingle' ||
        entry.scenario === 'ordinaryReturnedFromTopBaseSingle' ||
        entry.scenario === 'ordinaryReturnedFromMiddleMiddleSingle' ||
        entry.scenario === 'ordinaryReturnedFromMiddleBaseSingle' ||
        entry.scenario === 'ordinaryReturnedFromBaseMiddleSingle' ||
        entry.scenario === 'ordinaryReturnedFromBaseBaseSingle' ||
        entry.scenario === 'breakReturnedFromTopMiddleSingle' ||
        entry.scenario === 'breakReturnedFromTopBaseSingle' ||
        entry.scenario === 'breakReturnedFromMiddleMiddleSingle' ||
        entry.scenario === 'breakReturnedFromMiddleBaseSingle' ||
        entry.scenario === 'breakReturnedFromBaseMiddleSingle' ||
        entry.scenario === 'breakReturnedFromBaseBaseSingle'
    ),
    lowerHistoryAuthoredQ0SingleCases: cases.filter(
      (entry) =>
        entry.scenario === 'ordinaryMiddleThirdSingleAtHistoryQ0' ||
        entry.scenario === 'ordinaryBaseThirdSingleAtHistoryQ0' ||
        entry.scenario === 'breakMiddleThirdSingleAtHistoryQ0' ||
        entry.scenario === 'breakBaseThirdSingleAtHistoryQ0'
    ),
    lowerNonzeroGroupSingleCases: cases.filter(
      (entry) =>
        entry.scenario === 'ordinaryMiddleSingleAtGroupQ1' ||
        entry.scenario === 'ordinaryMiddleSingleAtGroupQ2' ||
        entry.scenario === 'ordinaryMiddleSingleAtGroupQ3' ||
        entry.scenario === 'ordinaryBaseSingleAtGroupQ1' ||
        entry.scenario === 'ordinaryBaseSingleAtGroupQ2' ||
        entry.scenario === 'ordinaryBaseSingleAtGroupQ3' ||
        entry.scenario === 'breakMiddleSingleAtGroupQ1' ||
        entry.scenario === 'breakMiddleSingleAtGroupQ2' ||
        entry.scenario === 'breakMiddleSingleAtGroupQ3' ||
        entry.scenario === 'breakBaseSingleAtGroupQ1' ||
        entry.scenario === 'breakBaseSingleAtGroupQ2' ||
        entry.scenario === 'breakBaseSingleAtGroupQ3'
    ),
    lowerNonzeroGroupSingleFollowupCases: cases.filter(
      (entry) =>
        entry.scenario === 'ordinaryMiddleFollowupSingleAfterGroupQ1' ||
        entry.scenario === 'ordinaryMiddleFollowupSingleAfterGroupQ2' ||
        entry.scenario === 'ordinaryMiddleFollowupSingleAfterGroupQ3' ||
        entry.scenario === 'ordinaryBaseFollowupSingleAfterGroupQ1' ||
        entry.scenario === 'ordinaryBaseFollowupSingleAfterGroupQ2' ||
        entry.scenario === 'ordinaryBaseFollowupSingleAfterGroupQ3' ||
        entry.scenario === 'breakMiddleFollowupSingleAfterGroupQ1' ||
        entry.scenario === 'breakMiddleFollowupSingleAfterGroupQ2' ||
        entry.scenario === 'breakMiddleFollowupSingleAfterGroupQ3' ||
        entry.scenario === 'breakBaseFollowupSingleAfterGroupQ1' ||
        entry.scenario === 'breakBaseFollowupSingleAfterGroupQ2' ||
        entry.scenario === 'breakBaseFollowupSingleAfterGroupQ3'
    ),
    lowerNonzeroGroupRotationAfterSingleCases: cases.filter(
      (entry) =>
        entry.scenario === 'ordinaryTopGroupAfterMiddleSingleAtGroupQ1' ||
        entry.scenario === 'ordinaryTopGroupAfterMiddleSingleAtGroupQ2' ||
        entry.scenario === 'ordinaryTopGroupAfterMiddleSingleAtGroupQ3' ||
        entry.scenario === 'ordinaryTopGroupAfterBaseSingleAtGroupQ1' ||
        entry.scenario === 'ordinaryTopGroupAfterBaseSingleAtGroupQ2' ||
        entry.scenario === 'ordinaryTopGroupAfterBaseSingleAtGroupQ3' ||
        entry.scenario === 'breakTopGroupAfterMiddleSingleAtGroupQ1' ||
        entry.scenario === 'breakTopGroupAfterMiddleSingleAtGroupQ2' ||
        entry.scenario === 'breakTopGroupAfterMiddleSingleAtGroupQ3' ||
        entry.scenario === 'breakTopGroupAfterBaseSingleAtGroupQ1' ||
        entry.scenario === 'breakTopGroupAfterBaseSingleAtGroupQ2' ||
        entry.scenario === 'breakTopGroupAfterBaseSingleAtGroupQ3'
    ),
    lowerNonzeroSameLowerGroupAfterSingleCases: cases.filter(
      (entry) =>
        entry.scenario === 'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ1' ||
        entry.scenario === 'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ2' ||
        entry.scenario === 'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ3' ||
        entry.scenario === 'ordinaryBaseGroupAfterBaseSingleAtGroupQ1' ||
        entry.scenario === 'ordinaryBaseGroupAfterBaseSingleAtGroupQ2' ||
        entry.scenario === 'ordinaryBaseGroupAfterBaseSingleAtGroupQ3' ||
        entry.scenario === 'breakMiddleGroupAfterMiddleSingleAtGroupQ1' ||
        entry.scenario === 'breakMiddleGroupAfterMiddleSingleAtGroupQ2' ||
        entry.scenario === 'breakMiddleGroupAfterMiddleSingleAtGroupQ3' ||
        entry.scenario === 'breakBaseGroupAfterBaseSingleAtGroupQ1' ||
        entry.scenario === 'breakBaseGroupAfterBaseSingleAtGroupQ2' ||
        entry.scenario === 'breakBaseGroupAfterBaseSingleAtGroupQ3'
    ),
    lowerNonzeroDifferentLowerGroupAfterSingleCases: cases.filter(
      (entry) =>
        entry.scenario === 'ordinaryBaseGroupAfterMiddleSingleAtGroupQ1' ||
        entry.scenario === 'ordinaryBaseGroupAfterMiddleSingleAtGroupQ2' ||
        entry.scenario === 'ordinaryBaseGroupAfterMiddleSingleAtGroupQ3' ||
        entry.scenario === 'ordinaryMiddleGroupAfterBaseSingleAtGroupQ1' ||
        entry.scenario === 'ordinaryMiddleGroupAfterBaseSingleAtGroupQ2' ||
        entry.scenario === 'ordinaryMiddleGroupAfterBaseSingleAtGroupQ3' ||
        entry.scenario === 'breakBaseGroupAfterMiddleSingleAtGroupQ1' ||
        entry.scenario === 'breakBaseGroupAfterMiddleSingleAtGroupQ2' ||
        entry.scenario === 'breakBaseGroupAfterMiddleSingleAtGroupQ3' ||
        entry.scenario === 'breakMiddleGroupAfterBaseSingleAtGroupQ1' ||
        entry.scenario === 'breakMiddleGroupAfterBaseSingleAtGroupQ2' ||
        entry.scenario === 'breakMiddleGroupAfterBaseSingleAtGroupQ3'
    ),
    lowerNonzeroSameLowerSecondGroupAfterSingleCases: cases.filter(
      (entry) =>
        entry.scenario ===
          'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ1' ||
        entry.scenario ===
          'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ2' ||
        entry.scenario ===
          'ordinaryMiddleSecondGroupAfterMiddleSingleAtGroupQ3' ||
        entry.scenario === 'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ1' ||
        entry.scenario === 'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ2' ||
        entry.scenario === 'ordinaryBaseSecondGroupAfterBaseSingleAtGroupQ3' ||
        entry.scenario === 'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ1' ||
        entry.scenario === 'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ2' ||
        entry.scenario === 'breakMiddleSecondGroupAfterMiddleSingleAtGroupQ3' ||
        entry.scenario === 'breakBaseSecondGroupAfterBaseSingleAtGroupQ1' ||
        entry.scenario === 'breakBaseSecondGroupAfterBaseSingleAtGroupQ2' ||
        entry.scenario === 'breakBaseSecondGroupAfterBaseSingleAtGroupQ3'
    ),
    lowerNonzeroGroupRefreshAfterSingleCases: cases.filter(
      (entry) =>
        entry.scenario === 'ordinaryRefreshAfterMiddleSingleAtGroupQ1' ||
        entry.scenario === 'ordinaryRefreshAfterMiddleSingleAtGroupQ2' ||
        entry.scenario === 'ordinaryRefreshAfterMiddleSingleAtGroupQ3' ||
        entry.scenario === 'ordinaryRefreshAfterBaseSingleAtGroupQ1' ||
        entry.scenario === 'ordinaryRefreshAfterBaseSingleAtGroupQ2' ||
        entry.scenario === 'ordinaryRefreshAfterBaseSingleAtGroupQ3' ||
        entry.scenario === 'breakRefreshAfterMiddleSingleAtGroupQ1' ||
        entry.scenario === 'breakRefreshAfterMiddleSingleAtGroupQ2' ||
        entry.scenario === 'breakRefreshAfterMiddleSingleAtGroupQ3' ||
        entry.scenario === 'breakRefreshAfterBaseSingleAtGroupQ1' ||
        entry.scenario === 'breakRefreshAfterBaseSingleAtGroupQ2' ||
        entry.scenario === 'breakRefreshAfterBaseSingleAtGroupQ3'
    ),
    nonzeroGroupSingleCases: cases.filter(
      (entry) =>
        entry.scenario === 'ordinarySingleAtGroupQ1' ||
        entry.scenario === 'ordinarySingleAtGroupQ2' ||
        entry.scenario === 'ordinarySingleAtGroupQ3' ||
        entry.scenario === 'breakSingleAtGroupQ1' ||
        entry.scenario === 'breakSingleAtGroupQ2' ||
        entry.scenario === 'breakSingleAtGroupQ3'
    ),
    breakRefreshCases: cases.filter(
      (entry) =>
        entry.scenario === 'breakRefreshFreshQ0' ||
        entry.scenario === 'breakRefreshReturnedQ0' ||
        entry.scenario === 'breakRefreshQ2' ||
        entry.scenario === 'breakRefreshQ3'
    ),
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

export const captureLegacySourceCompoundBreakRefreshFixture = (
  page: Page
): Promise<LegacySourceCompoundRotationFixture> =>
  captureLegacySourceCompoundRotationFixture(page, 'breakRefreshQ0Q2');

export const captureLegacySourceCompoundNonzeroGroupSingleFixture = (
  page: Page
): Promise<LegacySourceCompoundRotationFixture> =>
  captureLegacySourceCompoundRotationFixture(page, 'nonzeroGroupSingle');

export const captureLegacySourceCompoundLowerGroupInitiatorFixture = (
  page: Page
): Promise<LegacySourceCompoundRotationFixture> =>
  captureLegacySourceCompoundRotationFixture(page, 'lowerGroupInitiator');

export const captureLegacySourceCompoundLowerQ0SingleFixture = (
  page: Page
): Promise<LegacySourceCompoundRotationFixture> =>
  captureLegacySourceCompoundRotationFixture(page, 'lowerQ0Single');

export const captureLegacySourceCompoundLowerReturnedQ0SingleOrdinaryFixture = (
  page: Page
): Promise<LegacySourceCompoundRotationFixture> =>
  captureLegacySourceCompoundRotationFixture(
    page,
    'lowerReturnedQ0SingleOrdinary'
  );

export const captureLegacySourceCompoundLowerReturnedQ0SingleBreakFixture = (
  page: Page
): Promise<LegacySourceCompoundRotationFixture> =>
  captureLegacySourceCompoundRotationFixture(
    page,
    'lowerReturnedQ0SingleBreak'
  );

export const captureLegacySourceCompoundLowerHistoryAuthoredQ0SingleFixture = (
  page: Page
): Promise<LegacySourceCompoundRotationFixture> =>
  captureLegacySourceCompoundRotationFixture(
    page,
    'lowerHistoryAuthoredQ0Single'
  );

export const captureLegacySourceCompoundLowerNonzeroGroupSingleOrdinaryFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroGroupSingleOrdinary'
    );

export const captureLegacySourceCompoundLowerNonzeroGroupSingleBreakFixture = (
  page: Page
): Promise<LegacySourceCompoundRotationFixture> =>
  captureLegacySourceCompoundRotationFixture(
    page,
    'lowerNonzeroGroupSingleBreak'
  );

export const captureLegacySourceCompoundLowerNonzeroGroupSingleFollowupOrdinaryFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroGroupSingleFollowupOrdinary'
    );

export const captureLegacySourceCompoundLowerNonzeroGroupSingleFollowupBreakFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroGroupSingleFollowupBreak'
    );

export const captureLegacySourceCompoundLowerNonzeroGroupRotationAfterSingleOrdinaryFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroGroupRotationAfterSingleOrdinary'
    );

export const captureLegacySourceCompoundLowerNonzeroGroupRotationAfterSingleBreakFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroGroupRotationAfterSingleBreak'
    );

export const captureLegacySourceCompoundLowerNonzeroSameLowerGroupAfterSingleOrdinaryFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroSameLowerGroupAfterSingleOrdinary'
    );

export const captureLegacySourceCompoundLowerNonzeroSameLowerGroupAfterSingleBreakFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroSameLowerGroupAfterSingleBreak'
    );

export const captureLegacySourceCompoundLowerNonzeroDifferentLowerGroupAfterSingleOrdinaryFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroDifferentLowerGroupAfterSingleOrdinary'
    );

export const captureLegacySourceCompoundLowerNonzeroDifferentLowerGroupAfterSingleBreakFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroDifferentLowerGroupAfterSingleBreak'
    );

export const captureLegacySourceCompoundLowerNonzeroSameLowerSecondGroupAfterSingleOrdinaryFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroSameLowerSecondGroupAfterSingleOrdinary'
    );

export const captureLegacySourceCompoundLowerNonzeroSameLowerSecondGroupAfterSingleBreakFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroSameLowerSecondGroupAfterSingleBreak'
    );

export const captureLegacySourceCompoundLowerNonzeroGroupRefreshAfterSingleOrdinaryFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroGroupRefreshAfterSingleOrdinary'
    );

export const captureLegacySourceCompoundLowerNonzeroGroupRefreshAfterSingleBreakFixture =
  (page: Page): Promise<LegacySourceCompoundRotationFixture> =>
    captureLegacySourceCompoundRotationFixture(
      page,
      'lowerNonzeroGroupRefreshAfterSingleBreak'
    );

export const captureLegacySourceCompoundBreakRefreshQ3Fixture = (
  page: Page
): Promise<LegacySourceCompoundRotationFixture> =>
  captureLegacySourceCompoundRotationFixture(page, 'breakRefreshQ3');

type RawMixedStackMovementCard = Omit<
  LegacyMixedStackMovementCard,
  | 'side'
  | 'physicalBounds'
  | 'untransformedPhysicalBounds'
  | 'effectiveRotationDegrees'
>;

type RawMixedStackMovementPhase = Omit<
  LegacyMixedStackMovementPhase,
  'cards' | 'stack'
> & {
  readonly cards: readonly RawMixedStackMovementCard[];
  readonly stack: Omit<
    LegacyMixedStackMovementPhase['stack'],
    'side' | 'physicalBounds' | 'hitPointsPhysical'
  >;
};

type RawMixedStackMovementCase = Omit<
  LegacyMixedStackMovementCase,
  'side' | 'phases'
> & { readonly phases: readonly RawMixedStackMovementPhase[] };

/**
 * Replays the narrow v1 whole-stack active/bench move and current-category
 * cycle call graphs against checked-in HTML/CSS. Application modules stay
 * inert; each source operation below is deliberately small enough for its
 * digest-pinned source to remain reviewable alongside the fixture.
 */
export const captureLegacySourceMixedStackMovementFixture = async (
  page: Page
): Promise<LegacySourceMixedStackMovementFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const frames = {
    local: await requireRect(page.locator('#selfContainer'), '#selfContainer'),
    opponent: await requireRect(page.locator('#oppContainer'), '#oppContainer'),
  };
  const rawCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawMixedStackMovementCase;
  }> = [];

  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const captured = await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (body, input): Promise<readonly RawMixedStackMovementCase[]> => {
          type Category = 'Pokémon' | 'Energy' | 'Trainer';
          type ZoneName = 'active' | 'bench' | 'board';
          type FixtureImage = HTMLImageElement & {
            attached: boolean;
            target: string;
            relative: HTMLImageElement | number;
            energyLayer: number;
            layer: number;
          };
          interface FixtureCard {
            readonly id: string;
            readonly role: LegacyMixedStackMovementRole;
            currentCategory: Category;
            originalCategory: Category | null;
            readonly image: FixtureImage;
          }
          interface FixtureState {
            readonly arrays: Record<ZoneName, FixtureCard[]>;
            readonly cards: readonly FixtureCard[];
            readonly base: FixtureCard;
            readonly energy: FixtureCard;
            readonly trainerTool: FixtureCard;
            readonly controlBase: FixtureCard;
            readonly callTrace: LegacyMixedStackMovementTraceEntry[];
            readonly resetTrace: LegacyMixedStackResetTraceEntry[];
            readonly observers: MutationObserver[];
            wrapperOrdinal: number;
          }

          const active = body.querySelector('#active');
          const bench = body.querySelector('#bench');
          const board = body.querySelector('#board');
          if (
            !(active instanceof HTMLElement) ||
            !(bench instanceof HTMLElement) ||
            !(board instanceof HTMLElement)
          ) {
            throw new Error('Legacy mixed movement zones are missing');
          }
          const zones: Record<ZoneName, HTMLElement> = {
            active,
            bench,
            board,
          };
          const twoAnimationFrames = () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
          const rect = (bounds: DOMRect): CapturedRect => ({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
          const zoneForElement = (element: Element): ZoneName | null => {
            for (const name of ['active', 'bench', 'board'] as const) {
              if (zones[name].contains(element)) return name;
            }
            return null;
          };
          const cardId = (card: FixtureCard | null | undefined) =>
            card?.id ?? null;
          const traceCall = (
            state: FixtureState,
            functionName: LegacyMixedStackMovementTraceEntry['functionName'],
            card: FixtureCard | null,
            origin: string | null,
            destination: string | null,
            target: FixtureCard | null,
            detail: string
          ) => {
            state.callTrace.push({
              functionName,
              cardId: cardId(card),
              origin,
              destination,
              targetCardId: cardId(target),
              detail,
            });
          };
          const resetImage = (
            state: FixtureState,
            card: FixtureCard,
            reason: string
          ) => {
            state.resetTrace.push({
              cardId: card.id,
              reason,
              parentZoneBefore: zoneForElement(card.image),
            });
            const image = card.image;
            image.style.opacity = '1';
            image.style.position = 'relative';
            image.style.bottom = '0%';
            image.style.zIndex = '0';
            image.energyLayer = 0;
            image.layer = 0;
            image.relative = 0;
            image.style.left = '0px';
            image.attached = false;
            image.target = 'off';
            image.style.transform = 'rotate(0deg)';
          };
          const observeEmptyStack = (
            state: FixtureState,
            stack: HTMLElement
          ) => {
            const observer = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                if (
                  mutation.removedNodes[0]?.nodeName === 'IMG' &&
                  stack.getElementsByTagName('img').length === 0
                ) {
                  stack.remove();
                }
              }
            });
            observer.observe(stack, { childList: true });
            state.observers.push(observer);
          };
          const makeStack = (
            state: FixtureState,
            zone: 'active' | 'bench',
            purpose: string
          ) => {
            const stack = document.createElement('div');
            stack.className = 'play-container';
            stack.style.zIndex = '0';
            stack.dataset.legacyMixedMovementStackId = `${input.side}-${purpose}-${state.wrapperOrdinal}`;
            state.wrapperOrdinal += 1;
            zones[zone].append(stack);
            observeEmptyStack(state, stack);
            return stack;
          };
          const makeCard = (
            id: string,
            role: LegacyMixedStackMovementRole,
            category: Category
          ): FixtureCard => {
            const image = document.createElement('img') as FixtureImage;
            image.dataset.legacyMixedMovementCardId = id;
            image.alt = '';
            image.src = `${location.origin}/src/assets/cardback.png`;
            return {
              id,
              role,
              currentCategory: category,
              originalCategory: null,
              image,
            };
          };
          const newState = async (scenario: string): Promise<FixtureState> => {
            active.replaceChildren();
            bench.replaceChildren();
            board
              .querySelectorAll('[data-legacy-mixed-movement-card-id]')
              .forEach((element) => element.remove());
            const prefix = `${input.side}-${scenario}`;
            const base = makeCard(`${prefix}-base`, 'base', 'Pokémon');
            const energy = makeCard(`${prefix}-energy`, 'energy', 'Energy');
            const trainerTool = makeCard(
              `${prefix}-trainer-tool`,
              'trainerTool',
              'Trainer'
            );
            const controlBase = makeCard(
              `${prefix}-control-base`,
              'controlBase',
              'Pokémon'
            );
            const state: FixtureState = {
              arrays: { active: [], bench: [], board: [] },
              cards: [base, energy, trainerTool, controlBase],
              base,
              energy,
              trainerTool,
              controlBase,
              callTrace: [],
              resetTrace: [],
              observers: [],
              wrapperOrdinal: 0,
            };
            for (const card of state.cards) {
              resetImage(state, card, 'card-construction');
              board.append(card.image);
            }
            await Promise.all(state.cards.map((card) => card.image.decode()));
            return state;
          };
          const updateAttachedCardsPosition = (
            logicalCards: readonly FixtureCard[],
            movingCard: FixtureCard
          ) => {
            for (const card of logicalCards) {
              if (
                card.currentCategory !== 'Pokémon' &&
                movingCard.currentCategory !== 'Pokémon'
              ) {
                const relative = movingCard.image.relative;
                if (
                  relative instanceof HTMLImageElement &&
                  relative === card.image.relative &&
                  Number.parseInt(card.image.style.left) >
                    Number.parseInt(movingCard.image.style.left)
                ) {
                  const adjustment = relative.clientWidth / 6;
                  card.image.style.left = `${Number.parseInt(card.image.style.left) - adjustment}px`;
                  card.image.style.zIndex = String(
                    Number.parseInt(card.image.style.zIndex) + 1
                  );
                }
              }
            }
          };
          const decreaseCardLayer = (movingCard: FixtureCard) => {
            if (!(movingCard.image.relative instanceof HTMLImageElement)) {
              throw new Error('Legacy mixed movement attachment lost its base');
            }
            const baseImage = movingCard.image.relative as FixtureImage;
            const stack = baseImage.parentElement;
            if (!(stack instanceof HTMLElement)) {
              throw new Error('Legacy mixed movement attachment lost wrapper');
            }
            if (movingCard.currentCategory !== 'Pokémon') {
              baseImage.energyLayer -= 1;
              stack.style.width = `${Number.parseFloat(String(stack.clientWidth)) - baseImage.clientWidth / 6}px`;
            } else {
              baseImage.layer -= 1;
            }
          };
          const attachCard = (
            state: FixtureState,
            logicalCards: FixtureCard[],
            movingCard: FixtureCard,
            targetCard: FixtureCard,
            stack: HTMLElement,
            allowEnergyToolMove: boolean,
            reason: string
          ) => {
            const nonEvolveAttachment =
              movingCard.image.target === 'on' ||
              !movingCard.image.parentElement?.classList.contains(
                'play-container'
              );
            traceCall(
              state,
              'attachCard',
              movingCard,
              zoneForElement(movingCard.image),
              zoneForElement(stack),
              targetCard,
              reason
            );
            resetImage(state, movingCard, `attachCard:${reason}`);
            movingCard.image.attached = true;
            movingCard.image.target = 'on';
            movingCard.image.relative = targetCard.image;
            movingCard.image.style.position = 'absolute';
            const adjustment = targetCard.image.clientWidth / 6;
            targetCard.image.energyLayer += 1;
            const layer = targetCard.image.energyLayer;
            movingCard.image.style.left = `${layer * adjustment}px`;
            stack.style.width = `${Number.parseFloat(String(stack.clientWidth)) + adjustment}px`;
            movingCard.image.style.zIndex = String(-layer);
            targetCard.image.after(movingCard.image);
            if (movingCard.currentCategory === 'Trainer') {
              stack.style.marginRight = '2%';
              movingCard.image.style.transform = 'rotate(90deg)';
            } else {
              movingCard.image.style.transform = 'rotate(0deg)';
            }

            if (
              allowEnergyToolMove &&
              movingCard.currentCategory === 'Energy' &&
              nonEvolveAttachment
            ) {
              for (let index = 0; index < logicalCards.length - 1; index += 1) {
                const candidate = logicalCards[index];
                if (!candidate) throw new Error('Tool scan lost a card');
                if (
                  candidate.image.relative === movingCard.image.relative &&
                  candidate.currentCategory !== 'Pokémon' &&
                  candidate.currentCategory !== 'Energy'
                ) {
                  traceCall(
                    state,
                    'moveCard',
                    candidate,
                    zoneForElement(candidate.image),
                    zoneForElement(candidate.image),
                    targetCard,
                    'Energy-triggered recursive Tool move'
                  );
                  logicalCards.push(...logicalCards.splice(index, 1));
                  updateAttachedCardsPosition(logicalCards, candidate);
                  if (candidate.image.target === 'on') {
                    decreaseCardLayer(candidate);
                  }
                  attachCard(
                    state,
                    logicalCards,
                    candidate,
                    targetCard,
                    stack,
                    false,
                    'Energy-triggered Tool reattachment'
                  );
                  index -= 1;
                }
                if (logicalCards[index] === movingCard) break;
              }
            }
          };
          const initializeBase = (
            state: FixtureState,
            card: FixtureCard,
            zone: 'active' | 'bench',
            reason: string
          ) => {
            if (!card.originalCategory) {
              card.originalCategory = card.currentCategory;
            }
            card.currentCategory = 'Pokémon';
            const stack = makeStack(state, zone, reason);
            stack.append(card.image);
            return stack;
          };
          const findBaseStack = (baseCard: FixtureCard) => {
            const stack = baseCard.image.parentElement;
            if (!(stack instanceof HTMLElement)) {
              throw new Error(`Base ${baseCard.id} lacks a wrapper`);
            }
            return stack;
          };
          const refreshBoard = (state: FixtureState, reason: string) => {
            traceCall(state, 'refreshBoard', null, null, null, null, reason);
            for (const zoneName of ['active', 'bench'] as const) {
              const logicalCards = state.arrays[zoneName];
              const bases = logicalCards.filter((card) => !card.image.attached);
              for (const baseCard of bases) {
                resetImage(
                  state,
                  baseCard,
                  `initialize:refresh-${reason}-${baseCard.role}`
                );
                const stack = initializeBase(
                  state,
                  baseCard,
                  zoneName,
                  `refresh-${reason}-${baseCard.role}`
                );
                const attachments = logicalCards.filter(
                  (card) => card.image.relative === baseCard.image
                );
                for (const attachment of attachments) {
                  resetImage(state, attachment, `refresh-relocate:${reason}`);
                  attachment.image.attached = true;
                  attachCard(
                    state,
                    logicalCards,
                    attachment,
                    baseCard,
                    stack,
                    false,
                    `refresh:${reason}`
                  );
                }
                stack.style.width = `${baseCard.image.clientWidth + (baseCard.image.energyLayer * baseCard.image.clientWidth) / 6}px`;
              }
            }
          };
          const relocateAttachedCards = (
            state: FixtureState,
            movingCard: FixtureCard,
            originName: 'active' | 'bench',
            destinationName: ZoneName,
            moveCard: (
              origin: ZoneName,
              destination: ZoneName,
              index: number,
              targetIndex?: number
            ) => void
          ) => {
            traceCall(
              state,
              'relocateAttachedCards',
              movingCard,
              originName,
              destinationName,
              null,
              'scan source order for relative images'
            );
            const origin = state.arrays[originName];
            for (let index = 0; index < origin.length; index += 1) {
              const card = origin[index];
              if (!card) throw new Error('Relocation scan lost a card');
              if (card.image === movingCard.image) break;
              if (card.image.relative === movingCard.image) {
                if (
                  destinationName !== 'active' &&
                  destinationName !== 'bench'
                ) {
                  throw new Error(
                    'The bounded fixture excludes a base leaving live play'
                  );
                }
                resetImage(state, card, 'relocateAttachedCards');
                card.image.attached = true;
                const targetIndex = state.arrays[destinationName].findIndex(
                  (candidate) => candidate.image === movingCard.image
                );
                moveCard(originName, destinationName, index, targetIndex);
                index -= 1;
              }
            }
          };
          const moveCard = (
            state: FixtureState,
            originName: ZoneName,
            destinationName: ZoneName,
            index: number,
            targetIndex?: number,
            detail = 'direct moveCard'
          ): void => {
            const origin = state.arrays[originName];
            const destination = state.arrays[destinationName];
            const targetCard =
              typeof targetIndex === 'number'
                ? (destination[targetIndex] ?? null)
                : null;
            const movingCard = origin[index];
            if (!movingCard) throw new Error('moveCard lost its moving card');
            traceCall(
              state,
              'moveCard',
              movingCard,
              originName,
              destinationName,
              targetCard,
              detail
            );
            destination.push(...origin.splice(index, 1));
            updateAttachedCardsPosition(origin, movingCard);
            if (movingCard.image.target === 'on') decreaseCardLayer(movingCard);
            const activeOrBench = ['active', 'bench'];
            const targetValid =
              targetCard !== null &&
              activeOrBench.includes(destinationName) &&
              !targetCard.image.attached;
            const attachAllowed =
              !activeOrBench.includes(originName) || movingCard.image.attached;
            if (targetValid && attachAllowed) {
              attachCard(
                state,
                destination,
                movingCard,
                targetCard,
                findBaseStack(targetCard),
                true,
                detail
              );
            } else {
              resetImage(state, movingCard, `moveCard:${detail}`);
              if (destinationName === 'active' || destinationName === 'bench') {
                initializeBase(
                  state,
                  movingCard,
                  destinationName,
                  `move-${detail}-${movingCard.role}`
                );

                const destinationBases = destination.filter(
                  (card) => !card.image.attached
                );
                const originBases = origin.filter(
                  (card) => !card.image.attached
                );
                if (
                  destinationName === 'active' &&
                  destination[1] &&
                  !movingCard.image.attached &&
                  !destination[0]?.image.attached
                ) {
                  const autoCard = destination[0] ?? null;
                  traceCall(
                    state,
                    'autoMoveActiveBenchCard',
                    autoCard,
                    destinationName,
                    'bench',
                    null,
                    'case 1 occupied active auto-demotion'
                  );
                  moveCard(
                    state,
                    'active',
                    'bench',
                    0,
                    undefined,
                    'auto case 1'
                  );
                } else if (
                  destinationName === 'bench' &&
                  originName === 'active' &&
                  destinationBases.length === 2 &&
                  originBases.length === 0 &&
                  !destination[0]?.image.attached
                ) {
                  const autoCard = destination[0] ?? null;
                  traceCall(
                    state,
                    'autoMoveActiveBenchCard',
                    autoCard,
                    destinationName,
                    'active',
                    null,
                    'case 2 lone bench auto-promotion'
                  );
                  moveCard(
                    state,
                    'bench',
                    'active',
                    0,
                    undefined,
                    'auto case 2'
                  );
                } else if (targetValid && targetCard) {
                  const displacedIndex = destination.indexOf(targetCard);
                  traceCall(
                    state,
                    'autoMoveActiveBenchCard',
                    targetCard,
                    destinationName,
                    originName,
                    movingCard,
                    'case 3 explicit target swap'
                  );
                  moveCard(
                    state,
                    destinationName,
                    originName,
                    displacedIndex,
                    undefined,
                    'auto case 3'
                  );
                }
              } else {
                zones[destinationName].append(movingCard.image);
              }
            }
            if (
              (originName === 'active' || originName === 'bench') &&
              !movingCard.image.attached
            ) {
              relocateAttachedCards(
                state,
                movingCard,
                originName,
                destinationName,
                (originZone, destinationZone, movingIndex, movingTargetIndex) =>
                  moveCard(
                    state,
                    originZone,
                    destinationZone,
                    movingIndex,
                    movingTargetIndex,
                    'relocate attached card'
                  )
              );
            }
          };
          const moveCardBundle = (
            state: FixtureState,
            origin: ZoneName,
            destination: ZoneName,
            index: number,
            targetIndex?: number,
            detail = 'user move'
          ) => {
            const moving = state.arrays[origin][index] ?? null;
            const target =
              typeof targetIndex === 'number'
                ? (state.arrays[destination][targetIndex] ?? null)
                : null;
            traceCall(
              state,
              'moveCardBundle',
              moving,
              origin,
              destination,
              target,
              detail
            );
            moveCard(state, origin, destination, index, targetIndex, detail);
            refreshBoard(state, detail);
          };
          const placeBase = (
            state: FixtureState,
            card: FixtureCard,
            zone: 'active' | 'bench',
            reason: string
          ) => {
            state.arrays[zone].push(card);
            resetImage(state, card, `initialize:${reason}`);
            return initializeBase(state, card, zone, reason);
          };
          const attachFromBoard = (
            state: FixtureState,
            card: FixtureCard,
            target: FixtureCard,
            reason: string
          ) => {
            const cardIndex = state.arrays.board.indexOf(card);
            const zone = zoneForElement(target.image);
            if (cardIndex < 0 || (zone !== 'active' && zone !== 'bench')) {
              throw new Error('Attachment source or target zone is missing');
            }
            moveCardBundle(
              state,
              'board',
              zone,
              cardIndex,
              state.arrays[zone].indexOf(target),
              reason
            );
          };
          const buildCanonical = (state: FixtureState, reason: string) => {
            const stack = placeBase(state, state.base, 'active', reason);
            state.arrays.active.push(state.energy);
            attachCard(
              state,
              state.arrays.active,
              state.energy,
              state.base,
              stack,
              true,
              `${reason}:Energy`
            );
            state.arrays.active.push(state.trainerTool);
            attachCard(
              state,
              state.arrays.active,
              state.trainerTool,
              state.base,
              stack,
              true,
              `${reason}:Trainer`
            );
            placeBase(state, state.controlBase, 'bench', `${reason}:control`);
            refreshBoard(state, `${reason}:canonical-refresh`);
          };
          const buildReverseRestore = (state: FixtureState, reason: string) => {
            const stack = placeBase(state, state.base, 'active', reason);
            state.arrays.active.push(state.trainerTool);
            attachCard(
              state,
              state.arrays.active,
              state.trainerTool,
              state.base,
              stack,
              true,
              `${reason}:Trainer-first`
            );
            state.arrays.active.push(state.energy);
            attachCard(
              state,
              state.arrays.active,
              state.energy,
              state.base,
              stack,
              true,
              `${reason}:Energy-second`
            );
            placeBase(state, state.controlBase, 'bench', `${reason}:control`);
          };
          const changeType = (
            state: FixtureState,
            card: FixtureCard,
            origin: ZoneName,
            type: Category,
            reason: string
          ) => {
            if (!card.originalCategory) {
              card.originalCategory = card.currentCategory;
            }
            card.currentCategory = type;
            traceCall(
              state,
              'changeType',
              card,
              origin,
              'board',
              null,
              `${reason}:${type}`
            );
            moveCard(
              state,
              origin,
              'board',
              state.arrays[origin].indexOf(card),
              undefined,
              `changeType:${reason}:${type}`
            );
          };
          const directDomOrder = (zone: HTMLElement) =>
            [
              ...zone.querySelectorAll<HTMLImageElement>(
                ':scope > .play-container > img'
              ),
            ].map((image) => image.dataset.legacyMixedMovementCardId ?? '');
          const snapshot = (
            state: FixtureState,
            name: string
          ): RawMixedStackMovementPhase => {
            const mixedZone = zoneForElement(state.base.image);
            if (mixedZone !== 'active' && mixedZone !== 'bench') {
              throw new Error('Mixed movement base is not in play');
            }
            const stack = findBaseStack(state.base);
            const mixedCards = state.cards.filter(
              (card) =>
                card === state.base || card.image.relative === state.base.image
            );
            const paintedBounds = new Map(
              state.cards.map((card) => [
                card.id,
                card.image.getBoundingClientRect(),
              ])
            );
            const untransformedBounds = new Map<string, DOMRect>();
            for (const card of state.cards) {
              const transform = card.image.style.transform;
              try {
                card.image.style.transform = 'none';
                untransformedBounds.set(
                  card.id,
                  card.image.getBoundingClientRect()
                );
              } finally {
                card.image.style.transform = transform;
              }
            }
            const baseBounds = paintedBounds.get(state.base.id);
            const energyBounds = paintedBounds.get(state.energy.id);
            const toolBounds = paintedBounds.get(state.trainerTool.id);
            const toolLayoutBounds = untransformedBounds.get(
              state.trainerTool.id
            );
            if (
              !baseBounds ||
              !energyBounds ||
              !toolBounds ||
              !toolLayoutBounds
            ) {
              throw new Error('Mixed movement snapshot lacks card bounds');
            }
            const center = (bounds: {
              left: number;
              right: number;
              top: number;
              bottom: number;
            }): CapturedPoint => ({
              x: (bounds.left + bounds.right) / 2,
              y: (bounds.top + bounds.bottom) / 2,
            });
            const hitPointsFrameLocal = {
              baseOnly: center({
                left: baseBounds.left + 2,
                right: Math.min(energyBounds.left, toolBounds.left) - 2,
                top: baseBounds.top + 2,
                bottom: toolBounds.top - 2,
              }),
              allCardOverlap: center({
                left: Math.max(
                  baseBounds.left,
                  energyBounds.left,
                  toolBounds.left
                ),
                right: Math.min(
                  baseBounds.right,
                  energyBounds.right,
                  toolBounds.right
                ),
                top: Math.max(baseBounds.top, energyBounds.top, toolBounds.top),
                bottom: Math.min(
                  baseBounds.bottom,
                  energyBounds.bottom,
                  toolBounds.bottom
                ),
              }),
              energyToolOverlap: center({
                left: baseBounds.right + 2,
                right: Math.min(energyBounds.right, toolBounds.right) - 2,
                top: Math.max(energyBounds.top, toolBounds.top),
                bottom: Math.min(energyBounds.bottom, toolBounds.bottom),
              }),
              toolPaintedOnly: center({
                left:
                  Math.max(
                    baseBounds.right,
                    energyBounds.right,
                    toolLayoutBounds.right
                  ) + 2,
                right: toolBounds.right - 2,
                top: toolBounds.top,
                bottom: toolBounds.bottom,
              }),
            };
            for (const [label, point] of Object.entries(hitPointsFrameLocal)) {
              if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
                throw new Error(`Mixed movement ${label} point is invalid`);
              }
            }
            const idsAt = (point: CapturedPoint) =>
              document
                .elementsFromPoint(point.x, point.y)
                .flatMap((element) => {
                  const image = element.closest<HTMLImageElement>(
                    '[data-legacy-mixed-movement-card-id]'
                  );
                  return image?.dataset.legacyMixedMovementCardId
                    ? [image.dataset.legacyMixedMovementCardId]
                    : [];
                })
                .filter((id, index, ids) => ids.indexOf(id) === index);
            const stackStyles = getComputedStyle(stack);
            return {
              name,
              mixedZone,
              cards: state.cards.map((card) => {
                const painted = paintedBounds.get(card.id);
                const untransformed = untransformedBounds.get(card.id);
                if (!painted || !untransformed) {
                  throw new Error(`Missing ${card.id} bounds`);
                }
                const styles = getComputedStyle(card.image);
                const matrix = new DOMMatrixReadOnly(styles.transform);
                const parentZone = zoneForElement(card.image);
                if (!parentZone) throw new Error(`${card.id} lost its zone`);
                const logicalArray = state.arrays[parentZone];
                const parent = card.image.parentElement;
                return {
                  id: card.id,
                  role: card.role,
                  currentCategory: card.currentCategory,
                  originalCategory: card.originalCategory,
                  parentZone,
                  parentStackId:
                    parent instanceof HTMLElement
                      ? (parent.dataset.legacyMixedMovementStackId ?? null)
                      : null,
                  frameLocalBounds: rect(painted),
                  untransformedFrameLocalBounds: rect(untransformed),
                  clientWidth: card.image.clientWidth,
                  clientHeight: card.image.clientHeight,
                  naturalWidth: card.image.naturalWidth,
                  naturalHeight: card.image.naturalHeight,
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
                  inlineBottomPx:
                    Number.parseFloat(card.image.style.bottom) || 0,
                  attached: card.image.attached,
                  target: card.image.target,
                  relativeId:
                    card.image.relative instanceof HTMLImageElement
                      ? (card.image.relative.dataset
                          .legacyMixedMovementCardId ?? null)
                      : null,
                  energyLayer: card.image.energyLayer,
                  layer: card.image.layer,
                  logicalOrdinal: logicalArray.indexOf(card),
                  domOrdinal:
                    parent instanceof HTMLElement
                      ? [
                          ...parent.querySelectorAll<HTMLImageElement>(
                            ':scope > img'
                          ),
                        ].indexOf(card.image)
                      : -1,
                  sourcePath: new URL(card.image.currentSrc).pathname,
                };
              }),
              zoneLogicalOrder: {
                active: state.arrays.active.map((card) => card.id),
                bench: state.arrays.bench.map((card) => card.id),
                board: state.arrays.board.map((card) => card.id),
              },
              zoneDirectDomOrder: {
                active: directDomOrder(active),
                bench: directDomOrder(bench),
              },
              wrapperCounts: {
                active: active.querySelectorAll(
                  ':scope > [data-legacy-mixed-movement-stack-id]'
                ).length,
                bench: bench.querySelectorAll(
                  ':scope > [data-legacy-mixed-movement-stack-id]'
                ).length,
              },
              connectedWrapperIds: [
                ...body.querySelectorAll<HTMLElement>(
                  '[data-legacy-mixed-movement-stack-id]'
                ),
              ].map(
                (element) => element.dataset.legacyMixedMovementStackId ?? ''
              ),
              stack: {
                id: stack.dataset.legacyMixedMovementStackId ?? '',
                frameLocalBounds: rect(stack.getBoundingClientRect()),
                baseClientWidth: state.base.image.clientWidth,
                baseEnergyLayer: state.base.image.energyLayer,
                clientWidth: stack.clientWidth,
                authoredWidthPx: Number.parseFloat(stack.style.width),
                inlineMarginRight: stack.style.marginRight,
                computedMarginRightPx:
                  Number.parseFloat(stackStyles.marginRight) || 0,
                childDomOrder: [
                  ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
                ].map((image) => image.dataset.legacyMixedMovementCardId ?? ''),
                logicalOrder: state.arrays[mixedZone]
                  .filter(
                    (card) =>
                      card === state.base ||
                      card.image.relative === state.base.image
                  )
                  .map((card) => card.id),
                hitOrder: Object.fromEntries(
                  Object.entries(hitPointsFrameLocal).map(([label, point]) => [
                    label,
                    idsAt(point),
                  ])
                ),
                hitPointsFrameLocal,
              },
            };
          };
          const cleanup = (state: FixtureState): LegacyFixtureCleanup => {
            for (const observer of state.observers) observer.disconnect();
            body
              .querySelectorAll(
                '[data-legacy-mixed-movement-card-id], [data-legacy-mixed-movement-stack-id]'
              )
              .forEach((element) => element.remove());
            state.arrays.active.splice(0);
            state.arrays.bench.splice(0);
            state.arrays.board.splice(0);
            return {
              observedWrapperCount: body.querySelectorAll(
                '[data-legacy-mixed-movement-stack-id]'
              ).length,
              observedCardCount: body.querySelectorAll(
                '[data-legacy-mixed-movement-card-id]'
              ).length,
              sinkConnected: false,
            };
          };

          const cases: RawMixedStackMovementCase[] = [];

          {
            const state = await newState('native-canonical');
            buildCanonical(state, 'native setup');
            await twoAnimationFrames();
            cases.push({
              id: `${input.side}-native-canonical`,
              scenario: 'nativeCanonical',
              phases: [snapshot(state, 'stableCanonicalActive')],
              callTrace: [...state.callTrace],
              resetTrace: [...state.resetTrace],
              cleanup: cleanup(state),
            });
          }

          {
            const state = await newState('reverse-round-trip');
            buildReverseRestore(state, 'reverse restore');
            await twoAnimationFrames();
            const phases: RawMixedStackMovementPhase[] = [
              snapshot(state, 'initialReverseRestoredActive'),
            ];
            moveCardBundle(
              state,
              'active',
              'bench',
              state.arrays.active.indexOf(state.base),
              undefined,
              'active to occupied bench without target'
            );
            phases.push(snapshot(state, 'immediateCanonicalBench'));
            await twoAnimationFrames();
            phases.push(snapshot(state, 'settledCanonicalBench'));
            moveCardBundle(
              state,
              'bench',
              'active',
              state.arrays.bench.indexOf(state.base),
              state.arrays.active.indexOf(state.controlBase),
              'targeted mixed return to occupied active'
            );
            phases.push(snapshot(state, 'immediateCanonicalActiveReturn'));
            await twoAnimationFrames();
            phases.push(snapshot(state, 'settledCanonicalActiveReturn'));
            cases.push({
              id: `${input.side}-reverse-round-trip`,
              scenario: 'reverseRoundTrip',
              phases,
              callTrace: [...state.callTrace],
              resetTrace: [...state.resetTrace],
              cleanup: cleanup(state),
            });
          }

          {
            const state = await newState('category-cycle');
            buildCanonical(state, 'category setup');
            await twoAnimationFrames();
            const phases: RawMixedStackMovementPhase[] = [
              snapshot(state, 'initialCanonicalActive'),
            ];
            changeType(state, state.energy, 'active', 'Trainer', 'Energy-out');
            await twoAnimationFrames();
            changeType(state, state.energy, 'board', 'Energy', 'Energy-back');
            await twoAnimationFrames();
            attachFromBoard(
              state,
              state.energy,
              state.base,
              'reattach cycled Energy'
            );
            await twoAnimationFrames();
            changeType(
              state,
              state.trainerTool,
              'active',
              'Energy',
              'Trainer-out'
            );
            await twoAnimationFrames();
            changeType(
              state,
              state.trainerTool,
              'board',
              'Trainer',
              'Trainer-back'
            );
            await twoAnimationFrames();
            attachFromBoard(
              state,
              state.trainerTool,
              state.base,
              'reattach cycled Trainer'
            );
            phases.push(
              snapshot(state, 'immediateCanonicalAfterCategoryCycle')
            );
            await twoAnimationFrames();
            phases.push(snapshot(state, 'settledCanonicalAfterCategoryCycle'));
            cases.push({
              id: `${input.side}-category-cycle`,
              scenario: 'categoryCycle',
              phases,
              callTrace: [...state.callTrace],
              resetTrace: [...state.resetTrace],
              cleanup: cleanup(state),
            });
          }

          return cases;
        },
        { side }
      );
    rawCases.push(...captured.map((value) => ({ side, value })));
  }

  const physicalRect = (
    side: LegacyFixtureSide,
    bounds: CapturedRect
  ): CapturedRect =>
    side === 'local'
      ? {
          x: frames.local.x + bounds.x,
          y: frames.local.y + bounds.y,
          width: bounds.width,
          height: bounds.height,
        }
      : {
          x:
            frames.opponent.x + frames.opponent.width - bounds.x - bounds.width,
          y:
            frames.opponent.y +
            frames.opponent.height -
            bounds.y -
            bounds.height,
          width: bounds.width,
          height: bounds.height,
        };
  const physicalPoint = (
    side: LegacyFixtureSide,
    point: CapturedPoint
  ): CapturedPoint =>
    side === 'local'
      ? { x: frames.local.x + point.x, y: frames.local.y + point.y }
      : {
          x: frames.opponent.x + frames.opponent.width - point.x,
          y: frames.opponent.y + frames.opponent.height - point.y,
        };
  const cases = rawCases.map(
    ({ side: caseSide, value }): LegacyMixedStackMovementCase => ({
      ...value,
      side: caseSide,
      phases: value.phases.map((phase) => ({
        ...phase,
        cards: phase.cards.map((card) => ({
          ...card,
          side: caseSide,
          physicalBounds: physicalRect(caseSide, card.frameLocalBounds),
          untransformedPhysicalBounds: physicalRect(
            caseSide,
            card.untransformedFrameLocalBounds
          ),
          effectiveRotationDegrees:
            (card.localRotationDegrees +
              frameTransforms[caseSide].rotationDegrees) %
            360,
        })),
        stack: {
          ...phase.stack,
          side: caseSide,
          physicalBounds: physicalRect(caseSide, phase.stack.frameLocalBounds),
          hitPointsPhysical: Object.fromEntries(
            Object.entries(phase.stack.hitPointsFrameLocal).map(
              ([label, point]) => [label, physicalPoint(caseSide, point)]
            )
          ),
        },
      })),
    })
  );

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames,
    frameTransforms,
    cases,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

type RawMarkerRotationCard = Omit<
  LegacyMarkerRotationCard,
  'physicalBounds' | 'effectiveRotationDegrees'
>;

type RawMarkerRotationMarker = Omit<
  LegacyMarkerRotationMarker,
  'physicalBounds' | 'effectiveRotationDegrees'
>;

type RawMarkerRotationPhase = Omit<
  LegacyMarkerRotationPhase,
  'card' | 'wrapper' | 'markers'
> & {
  readonly card: RawMarkerRotationCard;
  readonly wrapper: Omit<
    LegacyMarkerRotationPhase['wrapper'],
    'physicalBounds'
  >;
  readonly markers: readonly RawMarkerRotationMarker[];
};

type RawMarkerRotationCase = Omit<
  LegacyMarkerRotationCase,
  'side' | 'initialCard' | 'phases'
> & {
  readonly initialCard: RawMarkerRotationCard;
  readonly phases: readonly RawMarkerRotationPhase[];
};

/**
 * Replays the source-pinned active-card marker and rotation mutations in inert
 * legacy documents. Application modules remain stubbed: each DOM mutation is
 * a narrow transcription of the digest-pinned legacy functions.
 */
export const captureLegacySourceMarkerRotationFixture = async (
  page: Page
): Promise<LegacySourceMarkerRotationFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  const rawCases: { side: LegacyFixtureSide; value: RawMarkerRotationCase }[] =
    [];

  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const value = await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (body, input): Promise<RawMarkerRotationCase> => {
          type MarkerImage = HTMLImageElement & {
            damageCounter: MarkerElement | null;
            specialCondition: MarkerElement | null;
            abilityCounter: MarkerElement | null;
            PokémonBreak: boolean;
          };
          type MarkerElement = HTMLDivElement & {
            handleInput?: EventListener | null;
            handleColor?: EventListener | null;
            handleRemoveWrapper?: EventListener | null;
            handleRemove?: ((fromBlurEvent?: boolean) => void) | null;
            handleResize?: EventListener | null;
          };

          const rect = (bounds: DOMRect): CapturedRect => ({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
          const nullablePx = (value: string): number | null =>
            value === '' ? null : Number.parseFloat(value);
          const waitForStableLayout = () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
          const active = body.querySelector('#active');
          if (!(active instanceof HTMLElement)) {
            throw new Error('Legacy marker fixture active zone is missing');
          }
          active.replaceChildren();

          const id = `${input.side}-active-marker-card`;
          const wrapperId = `${input.side}-active-marker-stack`;
          const image = document.createElement('img') as MarkerImage;
          image.dataset.legacyMarkerCardId = id;
          image.alt = '';
          image.src = `${location.origin}/src/assets/cardback.png`;
          image.style.opacity = '1';
          image.style.position = 'relative';
          image.style.bottom = '0%';
          image.style.zIndex = '0';
          image.style.left = '0px';
          image.style.transform = 'rotate(0deg)';
          image.damageCounter = null;
          image.specialCondition = null;
          image.abilityCounter = null;
          image.PokémonBreak = false;

          const wrapper = document.createElement('div');
          wrapper.className = 'play-container';
          wrapper.style.zIndex = '0';
          wrapper.dataset.legacyMarkerStackId = wrapperId;
          active.append(wrapper);
          wrapper.append(image);
          const wrapperObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              if (
                mutation.removedNodes.length > 0 &&
                wrapper.getElementsByTagName('img').length === 0
              ) {
                wrapper.remove();
              }
            }
          });
          wrapperObserver.observe(wrapper, { childList: true });

          await image.decode();
          await waitForStableLayout();
          const callTrace: string[] = [];
          let resizeCalls = 0;

          const captureCard = (): RawMarkerRotationCard => {
            const bounds = rect(image.getBoundingClientRect());
            const priorTransform = image.style.transform;
            image.style.transform = 'none';
            const untransformedFrameLocalBounds = rect(
              image.getBoundingClientRect()
            );
            image.style.transform = priorTransform;
            const styles = getComputedStyle(image);
            const transform =
              styles.transform === 'none'
                ? new DOMMatrixReadOnly()
                : new DOMMatrixReadOnly(styles.transform);
            return {
              id,
              frameLocalBounds: bounds,
              untransformedFrameLocalBounds,
              clientWidth: image.clientWidth,
              clientHeight: image.clientHeight,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              localRotationDegrees:
                ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) %
                360,
              inlineTransform: image.style.transform,
              zIndex: Number.parseInt(styles.zIndex, 10) || 0,
              pokemonBreak: image.PokémonBreak === true,
              domOrdinal: [...wrapper.querySelectorAll(':scope > img')].indexOf(
                image
              ),
              sourcePath: new URL(image.currentSrc).pathname,
            };
          };

          const initialCard = captureCard();
          const initialWrapperStyles = getComputedStyle(wrapper);
          const initialWrapperMargins = {
            inlineRight: wrapper.style.marginRight,
            inlineLeft: wrapper.style.marginLeft,
            computedRightPx:
              Number.parseFloat(initialWrapperStyles.marginRight) || 0,
            computedLeftPx:
              Number.parseFloat(initialWrapperStyles.marginLeft) || 0,
          };

          const markerClass = () =>
            input.side === 'local' ? 'self-circle' : 'opp-circle';
          const markerId = (kind: LegacyMarkerKind) =>
            `${input.side}-active-${kind}-marker`;
          const installResize = (
            marker: MarkerElement,
            callback: EventListener
          ) => {
            marker.handleResize = callback;
            window.addEventListener('resize', callback);
          };
          const removeResize = (marker: MarkerElement) => {
            if (marker.handleResize) {
              window.removeEventListener('resize', marker.handleResize);
              marker.handleResize = null;
            }
          };

          const updateDamageCounter = (damageAmount: string, record = true) => {
            if (!image.damageCounter)
              throw new Error('Damage marker is missing');
            if (image.damageCounter.textContent !== damageAmount) {
              image.damageCounter.textContent = damageAmount;
            }
            if (record) callTrace.push(`updateDamageCounter:${damageAmount}`);
          };
          const addDamageCounter = (
            damageAmount: string | false,
            record = true
          ) => {
            const targetRect = image.getBoundingClientRect();
            const zoneRect = active.getBoundingClientRect();
            let marker = image.damageCounter;
            if (marker) {
              if (marker.handleInput)
                marker.removeEventListener('input', marker.handleInput);
              marker.handleInput = null;
              if (marker.handleRemoveWrapper) {
                marker.removeEventListener('blur', marker.handleRemoveWrapper);
              }
              marker.handleRemove = null;
              removeResize(marker);
            } else {
              marker = document.createElement('div') as MarkerElement;
              marker.dataset.legacyMarkerId = markerId('damage');
              marker.dataset.legacyMarkerKind = 'damage';
              marker.className = markerClass();
              marker.contentEditable = 'true';
              marker.textContent = damageAmount ? damageAmount : '10';
            }
            marker.style.display = 'inline-block';
            marker.style.left = `${targetRect.left - zoneRect.left + targetRect.width / 1.5}px`;
            marker.style.top = `${targetRect.top - zoneRect.top + targetRect.height / 4}px`;
            active.append(marker);
            marker.style.width = `${targetRect.width / 3}px`;
            marker.style.height = `${targetRect.width / 3}px`;
            marker.style.lineHeight = `${targetRect.width / 3}px`;
            marker.style.fontSize = `${targetRect.width / 6}px`;
            marker.style.zIndex = '1';
            const handleInput: EventListener = () =>
              updateDamageCounter(marker?.textContent ?? '', false);
            marker.handleInput = handleInput;
            marker.addEventListener('input', handleInput);
            const handleResize: EventListener = () => {
              resizeCalls += 1;
              addDamageCounter(false, false);
            };
            installResize(marker, handleResize);
            marker.handleRemove = () => {
              if (
                marker?.textContent.trim() === '' ||
                Number(marker?.textContent) <= 0
              ) {
                removeDamageCounter(false);
              }
            };
            marker.handleRemoveWrapper = () => marker?.handleRemove?.(true);
            marker.addEventListener('blur', marker.handleRemoveWrapper);
            image.damageCounter = marker;
            if (record)
              callTrace.push(`addDamageCounter:${String(damageAmount)}`);
          };
          const removeDamageCounter = (record = true) => {
            const marker = image.damageCounter;
            if (marker) {
              if (marker.handleInput)
                marker.removeEventListener('input', marker.handleInput);
              marker.handleInput = null;
              if (marker.handleRemoveWrapper)
                marker.removeEventListener('blur', marker.handleRemoveWrapper);
              marker.handleRemove = null;
              removeResize(marker);
              marker.remove();
              image.damageCounter = null;
            }
            if (record) callTrace.push('removeDamageCounter');
          };

          const updateSpecialCondition = (
            textContent: string,
            record = true
          ) => {
            const marker = image.specialCondition;
            if (!marker) throw new Error('Special-condition marker is missing');
            marker.textContent = textContent;
            switch (marker.textContent.toUpperCase()) {
              case 'P':
                marker.style.backgroundColor = 'green';
                marker.style.color = 'white';
                break;
              case 'B':
                marker.style.backgroundColor = 'red';
                marker.style.color = 'white';
                break;
              case 'A':
                marker.style.backgroundColor = 'blue';
                marker.style.color = 'white';
                break;
              case 'PA':
                marker.style.backgroundColor = 'yellow';
                marker.style.color = 'black';
                break;
              case 'C':
                marker.style.backgroundColor = 'purple';
                marker.style.color = 'white';
                break;
              default:
                marker.style.backgroundColor = 'white';
                marker.style.color = 'black';
            }
            if (record) callTrace.push(`updateSpecialCondition:${textContent}`);
          };
          const addSpecialCondition = (record = true) => {
            const targetRect = image.getBoundingClientRect();
            const zoneRect = active.getBoundingClientRect();
            let marker = image.specialCondition;
            if (marker) {
              if (marker.handleColor)
                marker.removeEventListener('input', marker.handleColor);
              marker.handleColor = null;
              if (marker.handleRemoveWrapper)
                marker.removeEventListener('blur', marker.handleRemoveWrapper);
              marker.handleRemove = null;
              removeResize(marker);
            } else {
              marker = document.createElement('div') as MarkerElement;
              marker.dataset.legacyMarkerId = markerId('specialCondition');
              marker.dataset.legacyMarkerKind = 'specialCondition';
              marker.className = markerClass();
              marker.contentEditable = 'true';
              marker.textContent = 'P';
              marker.style.backgroundColor = 'green';
              marker.style.color = 'white';
            }
            marker.style.display = 'inline-block';
            marker.style.left = `${targetRect.left - zoneRect.left}px`;
            marker.style.top = `${targetRect.top - zoneRect.top + targetRect.height / 4}px`;
            active.append(marker);
            marker.style.width = `${targetRect.width / 3}px`;
            marker.style.height = `${targetRect.width / 3}px`;
            marker.style.lineHeight = `${targetRect.width / 3}px`;
            marker.style.fontSize = `${targetRect.width / 4}px`;
            marker.style.zIndex = '1';
            const handleColor: EventListener = () =>
              updateSpecialCondition(marker?.textContent ?? '', false);
            marker.handleColor = handleColor;
            marker.addEventListener('input', handleColor);
            const handleResize: EventListener = () => {
              resizeCalls += 1;
              addSpecialCondition(false);
            };
            installResize(marker, handleResize);
            marker.handleRemove = () => {
              if (
                marker?.textContent.trim() === '' ||
                marker?.textContent === '0'
              ) {
                removeSpecialCondition(false);
              }
            };
            marker.handleRemoveWrapper = () => marker?.handleRemove?.(true);
            marker.addEventListener('blur', marker.handleRemoveWrapper);
            image.specialCondition = marker;
            if (record) callTrace.push('addSpecialCondition');
          };
          const removeSpecialCondition = (record = true) => {
            const marker = image.specialCondition;
            if (marker) {
              if (marker.handleColor)
                marker.removeEventListener('input', marker.handleColor);
              marker.handleColor = null;
              if (marker.handleRemoveWrapper)
                marker.removeEventListener('blur', marker.handleRemoveWrapper);
              marker.handleRemove = null;
              removeResize(marker);
              marker.remove();
              image.specialCondition = null;
            }
            if (record) callTrace.push('removeSpecialCondition');
          };

          const addAbilityCounter = (record = true) => {
            const targetRect = image.getBoundingClientRect();
            const zoneRect = active.getBoundingClientRect();
            let marker = image.abilityCounter;
            if (marker) {
              marker.handleRemove = null;
              removeResize(marker);
            } else {
              marker = document.createElement('div') as MarkerElement;
              marker.dataset.legacyMarkerId = markerId('ability');
              marker.dataset.legacyMarkerKind = 'ability';
              marker.className =
                input.side === 'local' ? 'self-tab' : 'opp-tab';
            }
            marker.style.display = 'inline-block';
            marker.style.width = `${targetRect.width}px`;
            marker.style.height = `${targetRect.width / 5}px`;
            marker.style.lineHeight = `${targetRect.width / 3}px`;
            marker.style.zIndex = '1';
            if (input.side === 'local') {
              marker.style.right = '';
              marker.style.bottom = '';
              marker.style.left = `${targetRect.left - zoneRect.left}px`;
              marker.style.top = `${targetRect.top - zoneRect.top + targetRect.height / 2}px`;
            } else {
              marker.style.left = `${targetRect.left - zoneRect.left}px`;
              marker.style.top = '';
              marker.style.right = '';
              marker.style.bottom = `${targetRect.top - zoneRect.top + targetRect.height / 2 - Number.parseFloat(marker.style.height)}px`;
            }
            active.append(marker);
            const handleResize: EventListener = () => {
              resizeCalls += 1;
              addAbilityCounter(false);
            };
            installResize(marker, handleResize);
            marker.handleRemove = () => removeAbilityCounter(false);
            image.abilityCounter = marker;
            if (record) callTrace.push('addAbilityCounter');
          };
          const removeAbilityCounter = (record = true) => {
            const marker = image.abilityCounter;
            if (marker) {
              marker.handleRemove = null;
              removeResize(marker);
              marker.remove();
              image.abilityCounter = null;
            }
            if (record) callTrace.push('removeAbilityCounter');
          };

          const markerElements = () =>
            [
              image.damageCounter,
              image.specialCondition,
              image.abilityCounter,
            ].filter((marker): marker is MarkerElement => marker !== null);
          const fixtureIdsAt = (x: number, y: number): string[] =>
            document.elementsFromPoint(x, y).flatMap((candidate) => {
              if (!(candidate instanceof HTMLElement)) return [];
              const candidateId =
                candidate.dataset.legacyMarkerId ??
                candidate.dataset.legacyMarkerCardId;
              return candidateId ? [candidateId] : [];
            });
          const captureMarker = (
            marker: MarkerElement
          ): RawMarkerRotationMarker => {
            const bounds = marker.getBoundingClientRect();
            const styles = getComputedStyle(marker);
            const transform =
              styles.transform === 'none'
                ? new DOMMatrixReadOnly()
                : new DOMMatrixReadOnly(styles.transform);
            const kind = marker.dataset.legacyMarkerKind as LegacyMarkerKind;
            return {
              id: marker.dataset.legacyMarkerId ?? '',
              kind,
              frameLocalBounds: rect(bounds),
              className: marker.className,
              parentZoneId: marker.parentElement?.id ?? '',
              domOrdinal: [...active.children].indexOf(marker),
              textContent: marker.textContent ?? '',
              contentEditable: marker.contentEditable,
              pointerEvents: styles.pointerEvents,
              display: styles.display,
              inlineDisplay: marker.style.display,
              inlineLeftPx: nullablePx(marker.style.left),
              inlineTopPx: nullablePx(marker.style.top),
              inlineRightPx: nullablePx(marker.style.right),
              inlineBottomPx: nullablePx(marker.style.bottom),
              inlineWidthPx: Number.parseFloat(marker.style.width),
              inlineHeightPx: Number.parseFloat(marker.style.height),
              inlineLineHeightPx: Number.parseFloat(marker.style.lineHeight),
              inlineFontSizePx: nullablePx(marker.style.fontSize),
              zIndex: Number.parseInt(styles.zIndex, 10) || 0,
              backgroundColor: styles.backgroundColor,
              color: styles.color,
              borderRadius: styles.borderRadius,
              localRotationDegrees:
                ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) %
                360,
              hitOrder: fixtureIdsAt(
                bounds.left + bounds.width / 2,
                bounds.top + bounds.height / 2
              ),
            };
          };
          const capturePhase = (
            name: LegacyMarkerRotationPhase['name']
          ): RawMarkerRotationPhase => {
            const card = captureCard();
            const wrapperBounds = wrapper.getBoundingClientRect();
            const wrapperStyles = getComputedStyle(wrapper);
            const cardBounds = image.getBoundingClientRect();
            return {
              name,
              card,
              wrapper: {
                id: wrapperId,
                frameLocalBounds: rect(wrapperBounds),
                clientWidth: wrapper.clientWidth,
                clientHeight: wrapper.clientHeight,
                authoredWidthPx: wrapper.style.width
                  ? Number.parseFloat(wrapper.style.width)
                  : null,
                inlineMarginRight: wrapper.style.marginRight,
                inlineMarginLeft: wrapper.style.marginLeft,
                computedMarginRightPx:
                  Number.parseFloat(wrapperStyles.marginRight) || 0,
                computedMarginLeftPx:
                  Number.parseFloat(wrapperStyles.marginLeft) || 0,
                childImageCount:
                  wrapper.querySelectorAll(':scope > img').length,
              },
              markers: markerElements().map(captureMarker),
              cardOnlyHitOrder: fixtureIdsAt(
                cardBounds.left + cardBounds.width / 2,
                cardBounds.bottom - 3
              ),
            };
          };

          const rotateCard = () => {
            const currentRotation =
              Number.parseInt(
                image.style.transform.replace(/[^0-9-]/gu, ''),
                10
              ) || 0;
            const nextRotation = (currentRotation + 90) % 360;
            image.style.transform = `rotate(${nextRotation}deg)`;
            if ([0, 180].includes(nextRotation)) {
              wrapper.style.marginRight = '1%';
              wrapper.style.marginLeft = '0%';
            }
            if (image.damageCounter) addDamageCounter(false, false);
            if (image.specialCondition) addSpecialCondition(false);
            if (image.abilityCounter) addAbilityCounter(false);
            callTrace.push(`rotateCard:${currentRotation}->${nextRotation}`);
          };

          addDamageCounter('120');
          updateDamageCounter('130');
          addSpecialCondition();
          const paletteTrace = ['P', 'B', 'A', 'Pa', 'C', 'X', 'P'].map(
            (textContent) => {
              updateSpecialCondition(textContent);
              const marker = image.specialCondition;
              if (!marker)
                throw new Error('Special-condition palette marker is missing');
              const styles = getComputedStyle(marker);
              return {
                input: textContent,
                textContent: marker.textContent ?? '',
                backgroundColor: styles.backgroundColor,
                color: styles.color,
              };
            }
          );
          addAbilityCounter();
          const phases: RawMarkerRotationPhase[] = [capturePhase('marked-q0')];
          for (const name of ['q1', 'q2', 'q3', 'q0-return'] as const) {
            rotateCard();
            phases.push(capturePhase(name));
          }

          const liveResizeCallsBeforeDispatch = resizeCalls;
          window.dispatchEvent(new Event('resize'));
          await waitForStableLayout();
          const liveResizeCallsAfterDispatch = resizeCalls;
          const liveMarkerCountAfterDispatch = active.querySelectorAll(
            '[data-legacy-marker-id]'
          ).length;
          removeDamageCounter();
          removeSpecialCondition();
          removeAbilityCounter();
          const resizeCallsBeforeCleanupDispatch = resizeCalls;
          window.dispatchEvent(new Event('resize'));
          await waitForStableLayout();
          const resizeCallsAfterCleanupDispatch = resizeCalls;
          image.remove();
          await waitForStableLayout();
          const cleanup = {
            markerCount: active.querySelectorAll('[data-legacy-marker-id]')
              .length,
            cardDamageCounterIsNull: image.damageCounter === null,
            cardSpecialConditionIsNull: image.specialCondition === null,
            cardAbilityCounterIsNull: image.abilityCounter === null,
            liveResizeCallsBeforeDispatch,
            liveResizeCallsAfterDispatch,
            liveMarkerCountAfterDispatch,
            resizeCallsBeforeCleanupDispatch,
            resizeCallsAfterCleanupDispatch,
            wrapperCountAfterTwoFrames: active.querySelectorAll(
              '[data-legacy-marker-stack-id]'
            ).length,
            cardCountAfterTwoFrames: active.querySelectorAll(
              '[data-legacy-marker-card-id]'
            ).length,
          };
          wrapperObserver.disconnect();

          return {
            id: `${input.side}-active-marker-rotation`,
            initialCard,
            initialWrapperMargins,
            paletteTrace,
            phases,
            callTrace,
            cleanup,
          };
        },
        { side }
      );
    rawCases.push({ side, value });
  }

  const frames = {
    local: await requireRect(page.locator('#selfContainer'), '#selfContainer'),
    opponent: await requireRect(page.locator('#oppContainer'), '#oppContainer'),
  };
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const physicalRect = (
    side: LegacyFixtureSide,
    bounds: CapturedRect
  ): CapturedRect =>
    side === 'local'
      ? {
          x: frames.local.x + bounds.x,
          y: frames.local.y + bounds.y,
          width: bounds.width,
          height: bounds.height,
        }
      : {
          x:
            frames.opponent.x + frames.opponent.width - bounds.x - bounds.width,
          y:
            frames.opponent.y +
            frames.opponent.height -
            bounds.y -
            bounds.height,
          width: bounds.width,
          height: bounds.height,
        };
  const cases: LegacyMarkerRotationCase[] = rawCases.map(({ side, value }) => ({
    ...value,
    side,
    initialCard: {
      ...value.initialCard,
      physicalBounds: physicalRect(side, value.initialCard.frameLocalBounds),
      effectiveRotationDegrees:
        (value.initialCard.localRotationDegrees +
          frameTransforms[side].rotationDegrees) %
        360,
    },
    phases: value.phases.map((phase) => ({
      ...phase,
      card: {
        ...phase.card,
        physicalBounds: physicalRect(side, phase.card.frameLocalBounds),
        effectiveRotationDegrees:
          (phase.card.localRotationDegrees +
            frameTransforms[side].rotationDegrees) %
          360,
      },
      wrapper: {
        ...phase.wrapper,
        physicalBounds: physicalRect(side, phase.wrapper.frameLocalBounds),
      },
      markers: phase.markers.map((marker) => ({
        ...marker,
        physicalBounds: physicalRect(side, marker.frameLocalBounds),
        effectiveRotationDegrees:
          (marker.localRotationDegrees +
            frameTransforms[side].rotationDegrees) %
          360,
      })),
    })),
  }));

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames,
    frameTransforms,
    cases,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

type RawBenchMarkerRotationCard = Omit<
  LegacyBenchMarkerRotationCard,
  'physicalBounds' | 'effectiveRotationDegrees'
>;

type RawBenchMarkerRotationMarker = Omit<
  LegacyBenchMarkerRotationMarker,
  'physicalBounds' | 'effectiveRotationDegrees'
>;

type RawBenchMarkerRotationPhase = Omit<
  LegacyBenchMarkerRotationPhase,
  'card' | 'wrapper' | 'markers'
> & {
  readonly card: RawBenchMarkerRotationCard;
  readonly wrapper: Omit<
    LegacyBenchMarkerRotationPhase['wrapper'],
    'physicalBounds'
  >;
  readonly markers: readonly RawBenchMarkerRotationMarker[];
};

type RawBenchMarkerRotationCase = Omit<
  LegacyBenchMarkerRotationCase,
  'side' | 'initialCard' | 'phases'
> & {
  readonly initialCard: RawBenchMarkerRotationCard;
  readonly phases: readonly RawBenchMarkerRotationPhase[];
};

/**
 * Replays the source-pinned, sole-bench damage/ability marker and rotation
 * mutations in inert legacy documents. This is deliberately separate from the
 * active-marker capture: special conditions are not a canonical bench action,
 * while the bench wrapper owns an additional native ResizeObserver path.
 */
export const captureLegacySourceBenchMarkerRotationFixture = async (
  page: Page
): Promise<LegacySourceBenchMarkerRotationFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  const rawCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawBenchMarkerRotationCase;
  }> = [];

  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const value = await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (body, input): Promise<RawBenchMarkerRotationCase> => {
          type BenchMarkerElement = HTMLDivElement & {
            handleInput?: EventListener | null;
            handleRemoveWrapper?: EventListener | null;
            handleRemove?: ((fromBlurEvent?: boolean) => void) | null;
            handleResize?: EventListener | null;
          };
          type BenchMarkerImage = HTMLImageElement & {
            damageCounter: BenchMarkerElement | null;
            abilityCounter: BenchMarkerElement | null;
            specialCondition: null;
            PokémonBreak: boolean;
          };

          const rect = (bounds: DOMRect): CapturedRect => ({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
          const nullablePx = (value: string): number | null =>
            value === '' ? null : Number.parseFloat(value);
          const waitForStableLayout = () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
          const bench = body.querySelector('#bench');
          if (!(bench instanceof HTMLElement)) {
            throw new Error(
              'Legacy bench-marker fixture bench zone is missing'
            );
          }
          bench.replaceChildren();

          const id = `${input.side}-bench-marker-card`;
          const wrapperId = `${input.side}-bench-marker-stack`;
          const image = document.createElement('img') as BenchMarkerImage;
          image.dataset.legacyBenchMarkerCardId = id;
          image.alt = '';
          image.src = `${location.origin}/src/assets/cardback.png`;
          image.style.opacity = '1';
          image.style.position = 'relative';
          image.style.bottom = '0%';
          image.style.zIndex = '0';
          image.style.left = '0px';
          image.style.transform = 'rotate(0deg)';
          image.damageCounter = null;
          image.abilityCounter = null;
          image.specialCondition = null;
          image.PokémonBreak = false;

          const wrapper = document.createElement('div');
          wrapper.className = 'play-container';
          wrapper.style.zIndex = '0';
          wrapper.dataset.legacyBenchMarkerStackId = wrapperId;
          bench.append(wrapper);
          wrapper.append(image);
          const logicalBenchCards: BenchMarkerImage[] = [image];

          const wrapperObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              const removedNode = mutation.removedNodes[0];
              if (
                removedNode?.nodeName === 'IMG' &&
                wrapper.getElementsByTagName('img').length === 0
              ) {
                if (wrapper.parentElement) {
                  wrapper.parentElement.style.zIndex = '0';
                }
                wrapper.remove();
              }
              for (const candidate of logicalBenchCards) {
                if (candidate.damageCounter) {
                  addDamageCounter(false, 'mutationObserver');
                }
                if (candidate.abilityCounter) {
                  addAbilityCounter('mutationObserver');
                }
              }
            }
          });
          wrapperObserver.observe(wrapper, { childList: true });

          await image.decode();
          await waitForStableLayout();
          const callTrace: string[] = [];
          let windowResizeCalls = 0;
          let nativeResizeObserverCallbacks = 0;
          let nativeResizeObserverDamageRefreshes = 0;
          let nativeResizeObserverAbilityRefreshes = 0;
          let nativeResizeObserverDisconnectCalls = 0;

          const captureCard = (): RawBenchMarkerRotationCard => {
            const bounds = rect(image.getBoundingClientRect());
            const priorTransform = image.style.transform;
            image.style.transform = 'none';
            const untransformedFrameLocalBounds = rect(
              image.getBoundingClientRect()
            );
            image.style.transform = priorTransform;
            const styles = getComputedStyle(image);
            const transform =
              styles.transform === 'none'
                ? new DOMMatrixReadOnly()
                : new DOMMatrixReadOnly(styles.transform);
            return {
              id,
              frameLocalBounds: bounds,
              untransformedFrameLocalBounds,
              clientWidth: image.clientWidth,
              clientHeight: image.clientHeight,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              localRotationDegrees:
                ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) %
                360,
              inlineTransform: image.style.transform,
              zIndex: Number.parseInt(styles.zIndex, 10) || 0,
              pokemonBreak: image.PokémonBreak === true,
              domOrdinal: [...wrapper.querySelectorAll(':scope > img')].indexOf(
                image
              ),
              sourcePath: new URL(image.currentSrc).pathname,
            };
          };

          const initialCard = captureCard();
          const initialWrapperStyles = getComputedStyle(wrapper);
          const initialWrapperMargins = {
            inlineRight: wrapper.style.marginRight,
            inlineLeft: wrapper.style.marginLeft,
            computedRightPx:
              Number.parseFloat(initialWrapperStyles.marginRight) || 0,
            computedLeftPx:
              Number.parseFloat(initialWrapperStyles.marginLeft) || 0,
          };
          const markerId = (kind: LegacyBenchMarkerKind) =>
            `${input.side}-bench-${kind}-marker`;
          const removeResize = (marker: BenchMarkerElement) => {
            if (marker.handleResize) {
              window.removeEventListener('resize', marker.handleResize);
              marker.handleResize = null;
            }
          };

          const updateDamageCounter = (damageAmount: string) => {
            if (!image.damageCounter) {
              throw new Error('Bench damage marker is missing');
            }
            if (image.damageCounter.textContent !== damageAmount) {
              image.damageCounter.textContent = damageAmount;
            }
            callTrace.push(`updateDamageCounter:${damageAmount}`);
          };
          const addDamageCounter = (
            damageAmount: string | false,
            reason:
              | 'direct'
              | 'rotation'
              | 'window'
              | 'resizeObserver'
              | 'mutationObserver'
          ) => {
            const targetRect = image.getBoundingClientRect();
            const zoneRect = bench.getBoundingClientRect();
            let marker = image.damageCounter;
            if (marker) {
              if (marker.handleInput) {
                marker.removeEventListener('input', marker.handleInput);
              }
              marker.handleInput = null;
              if (marker.handleRemoveWrapper) {
                marker.removeEventListener('blur', marker.handleRemoveWrapper);
              }
              marker.handleRemove = null;
              removeResize(marker);
            } else {
              marker = document.createElement('div') as BenchMarkerElement;
              marker.dataset.legacyBenchMarkerId = markerId('damage');
              marker.dataset.legacyBenchMarkerKind = 'damage';
              marker.className =
                input.side === 'local' ? 'self-circle' : 'opp-circle';
              marker.contentEditable = 'true';
              marker.textContent = damageAmount ? damageAmount : '10';
            }
            marker.style.display = 'inline-block';
            marker.style.left = `${targetRect.left - zoneRect.left + targetRect.width / 1.5}px`;
            marker.style.top = `${targetRect.top - zoneRect.top + targetRect.height / 4}px`;
            bench.append(marker);
            marker.style.width = `${targetRect.width / 3}px`;
            marker.style.height = `${targetRect.width / 3}px`;
            marker.style.lineHeight = `${targetRect.width / 3}px`;
            marker.style.fontSize = `${targetRect.width / 6}px`;
            marker.style.zIndex = '1';
            const handleInput: EventListener = () => undefined;
            marker.handleInput = handleInput;
            marker.addEventListener('input', handleInput);
            const handleResize: EventListener = () => {
              windowResizeCalls += 1;
              addDamageCounter(false, 'window');
            };
            marker.handleResize = handleResize;
            window.addEventListener('resize', handleResize);
            marker.handleRemove = () => removeDamageCounter(false);
            marker.handleRemoveWrapper = () => marker?.handleRemove?.(true);
            marker.addEventListener('blur', marker.handleRemoveWrapper);
            image.damageCounter = marker;
            if (reason === 'resizeObserver') {
              nativeResizeObserverDamageRefreshes += 1;
            }
            if (reason === 'direct') {
              callTrace.push(`addDamageCounter:${String(damageAmount)}`);
            }
          };
          const removeDamageCounter = (record = true) => {
            const marker = image.damageCounter;
            if (marker) {
              if (marker.handleInput) {
                marker.removeEventListener('input', marker.handleInput);
              }
              marker.handleInput = null;
              if (marker.handleRemoveWrapper) {
                marker.removeEventListener('blur', marker.handleRemoveWrapper);
              }
              marker.handleRemove = null;
              removeResize(marker);
              marker.remove();
              image.damageCounter = null;
            }
            if (record) callTrace.push('removeDamageCounter');
          };

          const addAbilityCounter = (
            reason:
              | 'direct'
              | 'rotation'
              | 'window'
              | 'resizeObserver'
              | 'mutationObserver'
          ) => {
            const targetRect = image.getBoundingClientRect();
            const zoneRect = bench.getBoundingClientRect();
            let marker = image.abilityCounter;
            if (marker) {
              marker.handleRemove = null;
              removeResize(marker);
            } else {
              marker = document.createElement('div') as BenchMarkerElement;
              marker.dataset.legacyBenchMarkerId = markerId('ability');
              marker.dataset.legacyBenchMarkerKind = 'ability';
              marker.className =
                input.side === 'local' ? 'self-tab' : 'opp-tab';
            }
            marker.style.display = 'inline-block';
            marker.style.width = `${targetRect.width}px`;
            marker.style.height = `${targetRect.width / 5}px`;
            marker.style.lineHeight = `${targetRect.width / 3}px`;
            marker.style.zIndex = '1';
            if (input.side === 'local') {
              marker.style.right = '';
              marker.style.bottom = '';
              marker.style.left = `${targetRect.left - zoneRect.left}px`;
              marker.style.top = `${targetRect.top - zoneRect.top + targetRect.height / 2}px`;
            } else {
              marker.style.left = `${targetRect.left - zoneRect.left}px`;
              marker.style.top = '';
              marker.style.right = '';
              marker.style.bottom = `${targetRect.top - zoneRect.top + targetRect.height / 2 - Number.parseFloat(marker.style.height)}px`;
            }
            bench.append(marker);
            const handleResize: EventListener = () => {
              windowResizeCalls += 1;
              addAbilityCounter('window');
            };
            marker.handleResize = handleResize;
            window.addEventListener('resize', handleResize);
            marker.handleRemove = () => removeAbilityCounter(false);
            image.abilityCounter = marker;
            if (reason === 'resizeObserver') {
              nativeResizeObserverAbilityRefreshes += 1;
            }
            if (reason === 'direct') callTrace.push('addAbilityCounter');
          };
          const removeAbilityCounter = (record = true) => {
            const marker = image.abilityCounter;
            if (marker) {
              marker.handleRemove = null;
              removeResize(marker);
              marker.remove();
              image.abilityCounter = null;
            }
            if (record) callTrace.push('removeAbilityCounter');
          };

          const benchResizeObserver = new ResizeObserver((entries) => {
            nativeResizeObserverCallbacks += 1;
            for (const entry of entries) {
              if (entry.target.parentElement?.id !== 'bench') continue;
              for (const candidate of logicalBenchCards) {
                if (candidate.damageCounter) {
                  addDamageCounter(false, 'resizeObserver');
                }
                if (candidate.abilityCounter) {
                  addAbilityCounter('resizeObserver');
                }
              }
            }
          });
          benchResizeObserver.observe(wrapper);

          const markerElements = () =>
            [image.damageCounter, image.abilityCounter].filter(
              (marker): marker is BenchMarkerElement => marker !== null
            );
          const fixtureIdsAt = (x: number, y: number): string[] =>
            document.elementsFromPoint(x, y).flatMap((candidate) => {
              if (!(candidate instanceof HTMLElement)) return [];
              const candidateId =
                candidate.dataset.legacyBenchMarkerId ??
                candidate.dataset.legacyBenchMarkerCardId;
              return candidateId ? [candidateId] : [];
            });
          const captureMarker = (
            marker: BenchMarkerElement
          ): RawBenchMarkerRotationMarker => {
            const bounds = marker.getBoundingClientRect();
            const styles = getComputedStyle(marker);
            const transform =
              styles.transform === 'none'
                ? new DOMMatrixReadOnly()
                : new DOMMatrixReadOnly(styles.transform);
            return {
              id: marker.dataset.legacyBenchMarkerId ?? '',
              kind: marker.dataset
                .legacyBenchMarkerKind as LegacyBenchMarkerKind,
              frameLocalBounds: rect(bounds),
              className: marker.className,
              parentZoneId: marker.parentElement?.id ?? '',
              domOrdinal: [...bench.children].indexOf(marker),
              textContent: marker.textContent ?? '',
              contentEditable: marker.contentEditable,
              pointerEvents: styles.pointerEvents,
              display: styles.display,
              inlineDisplay: marker.style.display,
              inlineLeftPx: nullablePx(marker.style.left),
              inlineTopPx: nullablePx(marker.style.top),
              inlineRightPx: nullablePx(marker.style.right),
              inlineBottomPx: nullablePx(marker.style.bottom),
              inlineWidthPx: Number.parseFloat(marker.style.width),
              inlineHeightPx: Number.parseFloat(marker.style.height),
              inlineLineHeightPx: Number.parseFloat(marker.style.lineHeight),
              inlineFontSizePx: nullablePx(marker.style.fontSize),
              zIndex: Number.parseInt(styles.zIndex, 10) || 0,
              backgroundColor: styles.backgroundColor,
              color: styles.color,
              borderRadius: styles.borderRadius,
              localRotationDegrees:
                ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) %
                360,
              hitOrder: fixtureIdsAt(
                bounds.left + bounds.width / 2,
                bounds.top + bounds.height / 2
              ),
            };
          };
          const capturePhase = (
            name: LegacyBenchMarkerRotationPhase['name']
          ): RawBenchMarkerRotationPhase => {
            const card = captureCard();
            const wrapperBounds = wrapper.getBoundingClientRect();
            const wrapperStyles = getComputedStyle(wrapper);
            const cardBounds = image.getBoundingClientRect();
            const damageBounds = image.damageCounter?.getBoundingClientRect();
            const abilityBounds = image.abilityCounter?.getBoundingClientRect();
            const overlapLeft = Math.max(
              damageBounds?.left ?? 0,
              abilityBounds?.left ?? 0
            );
            const overlapRight = Math.min(
              damageBounds?.right ?? 0,
              abilityBounds?.right ?? 0
            );
            const overlapTop = Math.max(
              damageBounds?.top ?? 0,
              abilityBounds?.top ?? 0
            );
            const overlapBottom = Math.min(
              damageBounds?.bottom ?? 0,
              abilityBounds?.bottom ?? 0
            );
            return {
              name,
              card,
              wrapper: {
                id: wrapperId,
                frameLocalBounds: rect(wrapperBounds),
                clientWidth: wrapper.clientWidth,
                clientHeight: wrapper.clientHeight,
                authoredWidthPx: wrapper.style.width
                  ? Number.parseFloat(wrapper.style.width)
                  : null,
                inlineMarginRight: wrapper.style.marginRight,
                inlineMarginLeft: wrapper.style.marginLeft,
                computedMarginRightPx:
                  Number.parseFloat(wrapperStyles.marginRight) || 0,
                computedMarginLeftPx:
                  Number.parseFloat(wrapperStyles.marginLeft) || 0,
                childImageCount:
                  wrapper.querySelectorAll(':scope > img').length,
              },
              markers: markerElements().map(captureMarker),
              specialConditionMarkerCount: bench.querySelectorAll(
                '[data-legacy-bench-marker-kind="specialCondition"]'
              ).length,
              markerOverlapHitOrder:
                overlapRight > overlapLeft && overlapBottom > overlapTop
                  ? fixtureIdsAt(
                      (overlapLeft + overlapRight) / 2,
                      (overlapTop + overlapBottom) / 2
                    )
                  : null,
              cardOnlyHitOrder: fixtureIdsAt(
                cardBounds.left + cardBounds.width / 2,
                cardBounds.bottom - 3
              ),
            };
          };
          const rotateCard = () => {
            const currentRotation =
              Number.parseInt(
                image.style.transform.replace(/[^0-9-]/gu, ''),
                10
              ) || 0;
            const nextRotation = (currentRotation + 90) % 360;
            image.style.transform = `rotate(${nextRotation}deg)`;
            wrapper.style.marginRight = '3%';
            wrapper.style.marginLeft = '2%';
            if ([0, 180].includes(nextRotation)) {
              wrapper.style.marginRight = '1%';
              wrapper.style.marginLeft = '0%';
            }
            if (image.damageCounter) {
              addDamageCounter(false, 'rotation');
            }
            if (image.abilityCounter) {
              addAbilityCounter('rotation');
            }
            callTrace.push(`rotateCard:${currentRotation}->${nextRotation}`);
          };

          addDamageCounter('120', 'direct');
          updateDamageCounter('130');
          addAbilityCounter('direct');
          await waitForStableLayout();
          const callbacksAfterInitialSettle = nativeResizeObserverCallbacks;
          const damageRefreshesAfterInitialSettle =
            nativeResizeObserverDamageRefreshes;
          const abilityRefreshesAfterInitialSettle =
            nativeResizeObserverAbilityRefreshes;
          const phases: RawBenchMarkerRotationPhase[] = [
            capturePhase('marked-q0'),
          ];
          for (const name of ['q1', 'q2', 'q3', 'q0-return'] as const) {
            rotateCard();
            phases.push(capturePhase(name));
          }

          const liveResizeCallsBeforeDispatch = windowResizeCalls;
          window.dispatchEvent(new Event('resize'));
          await waitForStableLayout();
          const liveResizeCallsAfterDispatch = windowResizeCalls;
          const liveMarkerCountAfterDispatch = bench.querySelectorAll(
            '[data-legacy-bench-marker-id]'
          ).length;
          removeDamageCounter();
          removeAbilityCounter();
          const resizeCallsBeforeCleanupDispatch = windowResizeCalls;
          window.dispatchEvent(new Event('resize'));
          await waitForStableLayout();
          const resizeCallsAfterCleanupDispatch = windowResizeCalls;
          const callbacksBeforeCleanup = nativeResizeObserverCallbacks;
          logicalBenchCards.splice(0, logicalBenchCards.length);
          image.remove();
          await waitForStableLayout();
          const callbacksAfterCleanup = nativeResizeObserverCallbacks;
          const sourceObserverStillLiveBeforeHarnessDisconnect =
            nativeResizeObserverDisconnectCalls === 0;
          const cleanup = {
            markerCount: bench.querySelectorAll('[data-legacy-bench-marker-id]')
              .length,
            specialConditionMarkerCount: bench.querySelectorAll(
              '[data-legacy-bench-marker-kind="specialCondition"]'
            ).length,
            cardDamageCounterIsNull: image.damageCounter === null,
            cardAbilityCounterIsNull: image.abilityCounter === null,
            liveResizeCallsBeforeDispatch,
            liveResizeCallsAfterDispatch,
            liveMarkerCountAfterDispatch,
            resizeCallsBeforeCleanupDispatch,
            resizeCallsAfterCleanupDispatch,
            wrapperCountAfterTwoFrames: bench.querySelectorAll(
              '[data-legacy-bench-marker-stack-id]'
            ).length,
            cardCountAfterTwoFrames: bench.querySelectorAll(
              '[data-legacy-bench-marker-card-id]'
            ).length,
            benchZIndexAfterCleanup:
              Number.parseInt(getComputedStyle(bench).zIndex, 10) || 0,
          };
          const nativeBenchResizeObserver = {
            callbacksAfterInitialSettle,
            damageRefreshesAfterInitialSettle,
            abilityRefreshesAfterInitialSettle,
            callbacksBeforeCleanup,
            callbacksAfterCleanup,
            damageRefreshesAfterCleanup: nativeResizeObserverDamageRefreshes,
            abilityRefreshesAfterCleanup: nativeResizeObserverAbilityRefreshes,
            sourceObserverStillLiveBeforeHarnessDisconnect,
            harnessDisconnectCalls: 0,
          };
          benchResizeObserver.disconnect();
          nativeResizeObserverDisconnectCalls += 1;
          nativeBenchResizeObserver.harnessDisconnectCalls =
            nativeResizeObserverDisconnectCalls;
          wrapperObserver.disconnect();

          return {
            id: `${input.side}-bench-marker-rotation`,
            initialCard,
            initialWrapperMargins,
            phases,
            callTrace,
            nativeBenchResizeObserver,
            cleanup,
          };
        },
        { side }
      );
    rawCases.push({ side, value });
  }

  const frames = {
    local: await requireRect(page.locator('#selfContainer'), '#selfContainer'),
    opponent: await requireRect(page.locator('#oppContainer'), '#oppContainer'),
  };
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const physicalRect = (
    side: LegacyFixtureSide,
    bounds: CapturedRect
  ): CapturedRect =>
    side === 'local'
      ? {
          x: frames.local.x + bounds.x,
          y: frames.local.y + bounds.y,
          width: bounds.width,
          height: bounds.height,
        }
      : {
          x:
            frames.opponent.x + frames.opponent.width - bounds.x - bounds.width,
          y:
            frames.opponent.y +
            frames.opponent.height -
            bounds.y -
            bounds.height,
          width: bounds.width,
          height: bounds.height,
        };
  const cases: LegacyBenchMarkerRotationCase[] = rawCases.map(
    ({ side, value }) => ({
      ...value,
      side,
      initialCard: {
        ...value.initialCard,
        physicalBounds: physicalRect(side, value.initialCard.frameLocalBounds),
        effectiveRotationDegrees:
          (value.initialCard.localRotationDegrees +
            frameTransforms[side].rotationDegrees) %
          360,
      },
      phases: value.phases.map((phase) => ({
        ...phase,
        card: {
          ...phase.card,
          physicalBounds: physicalRect(side, phase.card.frameLocalBounds),
          effectiveRotationDegrees:
            (phase.card.localRotationDegrees +
              frameTransforms[side].rotationDegrees) %
            360,
        },
        wrapper: {
          ...phase.wrapper,
          physicalBounds: physicalRect(side, phase.wrapper.frameLocalBounds),
        },
        markers: phase.markers.map((marker) => ({
          ...marker,
          physicalBounds: physicalRect(side, marker.frameLocalBounds),
          effectiveRotationDegrees:
            (marker.localRotationDegrees +
              frameTransforms[side].rotationDegrees) %
            360,
        })),
      })),
    })
  );

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames,
    frameTransforms,
    cases,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};
