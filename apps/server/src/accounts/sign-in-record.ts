/**
 * Which account a provider's id belongs to (ADR-052): one record per
 * `<provider>:<id>`, in its own Durable Object, the way a room code's record
 * points at its room (ADR-047). Claiming it is the one place two sign-ins
 * at once can race, and the first claim wins: an id belongs to one account.
 */

export interface SignInRecord {
  readonly accountId: string;
  readonly claimedAt: number;
}

export interface SignInRecordStorage {
  readonly get: () => Promise<SignInRecord | undefined>;
  readonly put: (record: SignInRecord) => Promise<void>;
  readonly delete: () => Promise<void>;
}

export const signInRecordName = (provider: string, subject: string): string =>
  `${provider}:${subject}`;

export class SignInRecordCustody {
  constructor(private readonly storage: SignInRecordStorage) {}

  async resolve(): Promise<string | null> {
    return (await this.storage.get())?.accountId ?? null;
  }

  /** The account the id belongs to: `accountId`, unless another has it. */
  async claim(accountId: string, now: number): Promise<string> {
    const existing = await this.storage.get();
    if (existing) return existing.accountId;
    await this.storage.put({ accountId, claimedAt: now });
    return accountId;
  }

  /** Gives the id up, if `accountId` holds it. */
  async release(accountId: string): Promise<void> {
    const existing = await this.storage.get();
    if (existing?.accountId === accountId) await this.storage.delete();
  }
}
