/** Test-only capacity policy; production has no checked-in quota default. */
export const continuationTestQuotaConfiguration = JSON.stringify({
  format: 'ptcgsim-continuation-quota-configuration-v1',
  shardCount: 4,
  maximumActiveLeasesPerShard: 4,
});
