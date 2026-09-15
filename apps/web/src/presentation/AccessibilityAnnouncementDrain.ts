import type {
  AccessibilityPresentationAnnouncement,
  AccessibilityPresentationSnapshot,
  PresentationStateSource,
} from './PresentationRuntime.js';
import { SerialPresentationConsumer } from './SerialPresentationConsumer.js';

export type AccessibilityAnnouncementHandler = (
  announcement: AccessibilityPresentationAnnouncement,
  signal: AbortSignal
) => void | PromiseLike<void>;

export type AccessibilityAnnouncementFailureReporter = (
  error: unknown,
  announcement: AccessibilityPresentationAnnouncement
) => void;

export interface AccessibilityAnnouncementDrainOptions {
  readonly source: PresentationStateSource<AccessibilityPresentationSnapshot>;
  readonly acknowledge: (entryId: number) => boolean;
  readonly announce: AccessibilityAnnouncementHandler;
  readonly reportFailure?: AccessibilityAnnouncementFailureReporter;
}

/** Delivers polite announcements one at a time and acknowledges on settlement. */
export class AccessibilityAnnouncementDrain {
  private readonly consumer: SerialPresentationConsumer<
    AccessibilityPresentationSnapshot,
    AccessibilityPresentationAnnouncement
  >;

  constructor({
    source,
    acknowledge,
    announce,
    reportFailure = (error, announcement) =>
      console.error('Accessibility announcement failed', announcement, error),
  }: AccessibilityAnnouncementDrainOptions) {
    this.consumer = new SerialPresentationConsumer({
      source,
      selectEntries: (snapshot) => snapshot.announcements,
      consume: announce,
      acknowledge,
      reportFailure,
    });
    this.consumer.start();
  }

  dispose(): void {
    this.consumer.dispose();
  }
}
