import type { RoomAuthoritySnapshot } from '@ptcgsim/room-authority';
import { PROTOCOL_VERSION, type ServerMessage } from '@ptcgsim/protocol';

import type { RoomRateLimitPort } from './room-rate-limit.js';
import type { ServerTelemetryPort } from './server-telemetry.js';

const MAX_RECENT_MESSAGE_IDS = 256;
const CONNECTION_BURST_MAXIMUM = 8;
const CONNECTION_BURST_WINDOW_MS = 5_000;

interface BurstBucket {
  readonly windowStartedAt: number;
  readonly attempts: number;
}

type ChatMessage = Extract<ServerMessage, { type: 'ChatMessage' }>;
type ChatNotice = Extract<ServerMessage, { type: 'ServerNotice' }>;

export type RoomChatPreparation =
  | { readonly accepted: true; readonly message: ChatMessage }
  | { readonly accepted: false; readonly notice: ChatNotice };

export interface RoomChatDependencies {
  readonly rateLimits: RoomRateLimitPort;
  readonly telemetry: ServerTelemetryPort;
  readonly now: () => number;
  readonly nextMessageIdCandidate: () => string;
}

const notice = (code: string, message: string): ChatNotice => ({
  type: 'ServerNotice',
  protocolVersion: PROTOCOL_VERSION,
  code,
  message,
  // Ephemeral chat has no client idempotency key and is never auto-retried.
  retryable: false,
});

/**
 * Validates and attributes ephemeral room chat without seeing sockets or game
 * delivery. Only its bounded rate metadata survives Durable Object eviction.
 */
export class RoomChatService {
  private readonly burstBuckets = new Map<string, BurstBucket>();
  private readonly recentMessageIds = new Set<string>();
  private readonly recentMessageIdOrder: string[] = [];

  constructor(private readonly dependencies: RoomChatDependencies) {}

  releaseConnection(connectionId: string): void {
    this.burstBuckets.delete(connectionId);
  }

  async prepareDelivery(input: {
    readonly snapshot: RoomAuthoritySnapshot;
    readonly sessionId: string;
    readonly connectionId: string;
    readonly message: string;
  }): Promise<RoomChatPreparation> {
    const session = input.snapshot.sessions[input.sessionId];
    if (!session?.active) {
      return {
        accepted: false,
        notice: notice('session_superseded', 'Session is no longer active'),
      };
    }
    const normalizedMessage = input.message.trim();
    if (normalizedMessage.length === 0) {
      return {
        accepted: false,
        notice: notice('invalid_message', 'Chat message cannot be empty'),
      };
    }

    try {
      const now = this.dependencies.now();
      const burst = this.reserveBurst(input.connectionId, now);
      if (!burst.allowed) {
        this.dependencies.telemetry.roomRateLimit({
          operation: 'chat',
          allowed: false,
          retryAfterSeconds: burst.retryAfterSeconds,
        });
        return {
          accepted: false,
          notice: notice(
            'rate_limited',
            `Too many chat messages; retry in ${burst.retryAfterSeconds} seconds`
          ),
        };
      }
      const roomBudget = await this.dependencies.rateLimits.attempt(
        'chat',
        now
      );
      this.dependencies.telemetry.roomRateLimit({
        operation: 'chat',
        allowed: roomBudget.allowed,
        ...(!roomBudget.allowed
          ? { retryAfterSeconds: roomBudget.retryAfterSeconds }
          : {}),
      });
      if (!roomBudget.allowed) {
        return {
          accepted: false,
          notice: notice(
            'rate_limited',
            `Too many room chat messages; retry in ${roomBudget.retryAfterSeconds} seconds`
          ),
        };
      }

      const playerId =
        session.viewer.kind === 'player' ? session.viewer.playerId : undefined;
      const displayName = playerId
        ? input.snapshot.state.players[playerId]?.displayName
        : (session.displayName ?? 'Spectator');
      if (!displayName) {
        throw new Error('Chat session has no presentation identity');
      }
      return {
        accepted: true,
        message: {
          type: 'ChatMessage',
          protocolVersion: PROTOCOL_VERSION,
          messageId: this.nextMessageId(),
          ...(playerId ? { playerId } : {}),
          displayName,
          message: normalizedMessage,
          createdAtMs: now,
        },
      };
    } catch {
      this.dependencies.telemetry.failure({
        subsystem: 'chat_processing',
        retryable: false,
      });
      return {
        accepted: false,
        notice: notice(
          'internal_retryable',
          'The chat message could not be delivered'
        ),
      };
    }
  }

  private reserveBurst(
    connectionId: string,
    now: number
  ):
    | { readonly allowed: true }
    | { readonly allowed: false; readonly retryAfterSeconds: number } {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('Chat burst timestamp is invalid');
    }
    const windowStartedAt = now - (now % CONNECTION_BURST_WINDOW_MS);
    const previous = this.burstBuckets.get(connectionId);
    const attempts =
      previous?.windowStartedAt === windowStartedAt ? previous.attempts : 0;
    if (attempts >= CONNECTION_BURST_MAXIMUM) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (windowStartedAt + CONNECTION_BURST_WINDOW_MS - now) / 1_000
          )
        ),
      };
    }
    this.burstBuckets.set(connectionId, {
      windowStartedAt,
      attempts: attempts + 1,
    });
    return { allowed: true };
  }

  private nextMessageId(): string {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate = this.dependencies.nextMessageIdCandidate();
      if (
        candidate.length < 1 ||
        candidate.length > 128 ||
        this.recentMessageIds.has(candidate)
      ) {
        continue;
      }
      this.recentMessageIds.add(candidate);
      this.recentMessageIdOrder.push(candidate);
      while (this.recentMessageIdOrder.length > MAX_RECENT_MESSAGE_IDS) {
        this.recentMessageIds.delete(this.recentMessageIdOrder.shift()!);
      }
      return candidate;
    }
    throw new Error('Chat message ID source failed to produce a unique ID');
  }
}
