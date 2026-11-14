export const MAXIMUM_CONTINUATION_QUOTA_SHARDS = 4_096;
export const MAXIMUM_CONTINUATION_QUOTA_LEASES_PER_SHARD = 512;

export interface ContinuationQuotaShardPolicy {
  readonly maximumActiveLeases: number;
}
