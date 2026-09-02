import { useSyncExternalStore } from 'react';

import type { ActivityFeedSnapshot } from './ActivityFeedModel.js';
import type {
  AccessibilityPresentationSnapshot,
  ActivityPresentationSnapshot,
  AnimationPresentationSnapshot,
  PresentationStateSource,
} from './PresentationRuntime.js';

const usePresentationState = <Snapshot>(
  source: PresentationStateSource<Snapshot>
): Snapshot =>
  useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot
  );

export const useActivityPresentation = (
  source: PresentationStateSource<ActivityPresentationSnapshot>
): ActivityPresentationSnapshot => usePresentationState(source);

export const useAccessibilityPresentation = (
  source: PresentationStateSource<AccessibilityPresentationSnapshot>
): AccessibilityPresentationSnapshot => usePresentationState(source);

export const useAnimationPresentation = (
  source: PresentationStateSource<AnimationPresentationSnapshot>
): AnimationPresentationSnapshot => usePresentationState(source);

export const useActivityFeed = (
  source: PresentationStateSource<ActivityFeedSnapshot>
): ActivityFeedSnapshot => usePresentationState(source);
