import type {
  AccessibilityPresentationEffect,
  ActivityPresentationEffect,
  AnimationPresentationEffect,
  PresentationEffectAdapters,
} from './PresentationEffects.js';

export const MAX_PRESENTATION_RUNTIME_ENTRIES = 1_000;

export interface PresentationRuntimePolicy {
  readonly maximumActivityEntries: number;
  readonly maximumAccessibilityAnnouncements: number;
  readonly maximumQueuedAnimations: number;
}

export const DEFAULT_PRESENTATION_RUNTIME_POLICY: PresentationRuntimePolicy = {
  maximumActivityEntries: 100,
  maximumAccessibilityAnnouncements: 32,
  maximumQueuedAnimations: 16,
};

export interface PresentationRuntimeEntry<Effect> {
  /** Local monotonic identity for React keys and exact acknowledgements. */
  readonly id: number;
  readonly effect: Effect;
}

export type ActivityPresentationEntry =
  PresentationRuntimeEntry<ActivityPresentationEffect>;
export type AccessibilityPresentationAnnouncement =
  PresentationRuntimeEntry<AccessibilityPresentationEffect>;
export type QueuedPresentationAnimation =
  PresentationRuntimeEntry<AnimationPresentationEffect>;

export interface ActivityPresentationSnapshot {
  readonly entries: readonly ActivityPresentationEntry[];
}

export interface AccessibilityPresentationSnapshot {
  readonly announcements: readonly AccessibilityPresentationAnnouncement[];
}

export interface AnimationPresentationSnapshot {
  readonly animations: readonly QueuedPresentationAnimation[];
}

export interface PresentationStateSource<Snapshot> {
  readonly getSnapshot: () => Snapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

const EMPTY_ACTIVITY: ActivityPresentationSnapshot = { entries: [] };
const EMPTY_ACCESSIBILITY: AccessibilityPresentationSnapshot = {
  announcements: [],
};
const EMPTY_ANIMATIONS: AnimationPresentationSnapshot = { animations: [] };

class StateChannel<Snapshot> implements PresentationStateSource<Snapshot> {
  private readonly listeners = new Set<() => void>();
  private closed = false;

  constructor(private state: Snapshot) {}

  getSnapshot = (): Snapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(state: Snapshot): void {
    this.state = state;
  }

  emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}

const boundedPolicy = (
  policy: Partial<PresentationRuntimePolicy>
): PresentationRuntimePolicy => {
  const candidate = { ...DEFAULT_PRESENTATION_RUNTIME_POLICY, ...policy };
  for (const [name, value] of Object.entries(candidate)) {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > MAX_PRESENTATION_RUNTIME_ENTRIES
    ) {
      throw new Error(`Invalid presentation runtime policy: ${name}`);
    }
  }
  return candidate;
};

const appendBounded = <Entry>(
  entries: readonly Entry[],
  entry: Entry,
  maximum: number
): readonly Entry[] =>
  maximum === 0 ? [] : [...entries, entry].slice(-maximum);

const sameActivityEffect = (
  left: ActivityPresentationEffect,
  right: ActivityPresentationEffect
): boolean =>
  left.revision === right.revision &&
  left.eventType === right.eventType &&
  left.category === right.category &&
  left.message === right.message &&
  left.playerId === right.playerId;

const sameActivityTimeline = (
  entries: readonly ActivityPresentationEntry[],
  effects: readonly ActivityPresentationEffect[]
): boolean =>
  entries.length === effects.length &&
  entries.every((entry, index) =>
    sameActivityEffect(entry.effect, effects[index]!)
  );

const remainingAfterHeadAcknowledgement = <
  Entry extends { readonly id: number },
>(
  entries: readonly Entry[],
  entryId: number
): readonly Entry[] | undefined =>
  entries[0]?.id === entryId ? entries.slice(1) : undefined;

/**
 * Local-only bounded state behind the presentation effect adapters. Each
 * channel publishes independently so an animation cannot rerender activity UI.
 */
export class PresentationRuntime {
  private readonly policy: PresentationRuntimePolicy;
  private readonly activityChannel = new StateChannel(EMPTY_ACTIVITY);
  private readonly accessibilityChannel = new StateChannel(EMPTY_ACCESSIBILITY);
  private readonly animationChannel = new StateChannel(EMPTY_ANIMATIONS);
  private nextEntryId = 1;
  private resetInProgress = false;
  private transientResetInProgress = false;
  private hasBoundIdentity = false;
  private boundIdentity?: string;
  private disposed = false;

  readonly activity: PresentationStateSource<ActivityPresentationSnapshot> =
    this.activityChannel;
  readonly accessibility: PresentationStateSource<AccessibilityPresentationSnapshot> =
    this.accessibilityChannel;
  readonly animation: PresentationStateSource<AnimationPresentationSnapshot> =
    this.animationChannel;

  readonly adapters: PresentationEffectAdapters = {
    appendActivity: (effect) => this.appendActivity(effect),
    announceAccessibility: (effect) => this.enqueueAccessibility(effect),
    presentAnimation: (effect) => this.enqueueAnimation(effect),
  };

  constructor(policy: Partial<PresentationRuntimePolicy> = {}) {
    this.policy = boundedPolicy(policy);
  }

  /** Retains state across remounts of one identity and clears across rooms. */
  bindIdentity = (identity: string | undefined): boolean => {
    if (this.disposed || this.resetInProgress) return false;
    if (this.hasBoundIdentity && identity === this.boundIdentity) return false;
    this.hasBoundIdentity = true;
    this.boundIdentity = identity;
    this.reset();
    return true;
  };

  /** Replaces replay activity as deterministic timeline state after seeking. */
  replaceActivity = (
    effects: readonly ActivityPresentationEffect[]
  ): boolean => {
    if (this.disposed || this.resetInProgress) return false;
    const boundedEffects =
      this.policy.maximumActivityEntries === 0
        ? []
        : effects.slice(-this.policy.maximumActivityEntries);
    const current = this.activityChannel.getSnapshot();
    if (sameActivityTimeline(current.entries, boundedEffects)) return false;
    const entries = boundedEffects.map((effect, index) => {
      const existing = current.entries[index];
      return existing && sameActivityEffect(existing.effect, effect)
        ? existing
        : this.createEntry(effect);
    });
    this.activityChannel.set({ entries });
    this.activityChannel.emit();
    return true;
  };

  clearActivity = (): boolean => {
    if (
      this.disposed ||
      this.resetInProgress ||
      this.activityChannel.getSnapshot().entries.length === 0
    )
      return false;
    this.activityChannel.set(EMPTY_ACTIVITY);
    this.activityChannel.emit();
    return true;
  };

  acknowledgeAccessibility = (entryId: number): boolean => {
    if (this.disposed || this.resetInProgress || this.transientResetInProgress)
      return false;
    const remaining = remainingAfterHeadAcknowledgement(
      this.accessibilityChannel.getSnapshot().announcements,
      entryId
    );
    if (!remaining) return false;
    this.accessibilityChannel.set({ announcements: remaining });
    this.accessibilityChannel.emit();
    return true;
  };

  acknowledgeAnimation = (entryId: number): boolean => {
    if (this.disposed || this.resetInProgress || this.transientResetInProgress)
      return false;
    const remaining = remainingAfterHeadAcknowledgement(
      this.animationChannel.getSnapshot().animations,
      entryId
    );
    if (!remaining) return false;
    this.animationChannel.set({ animations: remaining });
    this.animationChannel.emit();
    return true;
  };

  /** Cancels stale one-shot work when replay direction or mode changes. */
  clearTransientEffects = (): boolean => {
    if (this.disposed || this.resetInProgress || this.transientResetInProgress)
      return false;
    const accessibilityChanged =
      this.accessibilityChannel.getSnapshot().announcements.length > 0;
    const animationChanged =
      this.animationChannel.getSnapshot().animations.length > 0;
    if (!accessibilityChanged && !animationChanged) return false;

    this.transientResetInProgress = true;
    try {
      // Install both states before notifying either channel.
      if (accessibilityChanged)
        this.accessibilityChannel.set(EMPTY_ACCESSIBILITY);
      if (animationChanged) this.animationChannel.set(EMPTY_ANIMATIONS);
      if (accessibilityChanged) this.accessibilityChannel.emit();
      if (animationChanged) this.animationChannel.emit();
    } finally {
      this.transientResetInProgress = false;
    }
    return true;
  };

  /** Clears all room/viewer-local data while retaining monotonic entry IDs. */
  reset = (): boolean => {
    if (this.disposed || this.resetInProgress) return false;
    this.resetInProgress = true;
    try {
      return this.resetState();
    } finally {
      this.resetInProgress = false;
    }
  };

  dispose(): void {
    if (this.disposed) return;
    // Block listener-driven writes before publishing the final empty state.
    this.disposed = true;
    try {
      this.resetState();
    } finally {
      this.activityChannel.close();
      this.accessibilityChannel.close();
      this.animationChannel.close();
    }
  }

  private resetState(): boolean {
    const activityChanged =
      this.activityChannel.getSnapshot().entries.length > 0;
    const accessibilityChanged =
      this.accessibilityChannel.getSnapshot().announcements.length > 0;
    const animationChanged =
      this.animationChannel.getSnapshot().animations.length > 0;
    if (!activityChanged && !accessibilityChanged && !animationChanged)
      return false;

    if (activityChanged) this.activityChannel.set(EMPTY_ACTIVITY);
    if (accessibilityChanged)
      this.accessibilityChannel.set(EMPTY_ACCESSIBILITY);
    if (animationChanged) this.animationChannel.set(EMPTY_ANIMATIONS);
    if (activityChanged) this.activityChannel.emit();
    if (accessibilityChanged) this.accessibilityChannel.emit();
    if (animationChanged) this.animationChannel.emit();
    return true;
  }

  private appendActivity(effect: ActivityPresentationEffect): void {
    if (
      this.disposed ||
      this.resetInProgress ||
      this.policy.maximumActivityEntries === 0
    )
      return;
    const current = this.activityChannel.getSnapshot();
    this.activityChannel.set({
      entries: appendBounded(
        current.entries,
        this.createEntry(effect),
        this.policy.maximumActivityEntries
      ),
    });
    this.activityChannel.emit();
  }

  private enqueueAccessibility(effect: AccessibilityPresentationEffect): void {
    if (
      this.disposed ||
      this.resetInProgress ||
      this.transientResetInProgress ||
      this.policy.maximumAccessibilityAnnouncements === 0
    )
      return;
    const current = this.accessibilityChannel.getSnapshot();
    this.accessibilityChannel.set({
      announcements: appendBounded(
        current.announcements,
        this.createEntry(effect),
        this.policy.maximumAccessibilityAnnouncements
      ),
    });
    this.accessibilityChannel.emit();
  }

  private enqueueAnimation(effect: AnimationPresentationEffect): void {
    if (
      this.disposed ||
      this.resetInProgress ||
      this.transientResetInProgress ||
      this.policy.maximumQueuedAnimations === 0
    )
      return;
    const current = this.animationChannel.getSnapshot();
    this.animationChannel.set({
      animations: appendBounded(
        current.animations,
        this.createEntry(effect),
        this.policy.maximumQueuedAnimations
      ),
    });
    this.animationChannel.emit();
  }

  private createEntry<Effect>(
    effect: Effect
  ): PresentationRuntimeEntry<Effect> {
    const entry = { id: this.nextEntryId, effect };
    this.nextEntryId += 1;
    return entry;
  }
}
