/** Exact opt-in value for the complete create, restore, and revoke surface. */
export const CONTINUATION_HTTP_ACTIVATION_VALUE =
  'ptcgsim-continuation-http-v1:enabled';

/** Exact rollout drain value: hide create/restore while retaining revoke. */
export const CONTINUATION_HTTP_DRAIN_VALUE =
  'ptcgsim-continuation-http-v1:revoke-only';

export type ContinuationHttpMode = 'closed' | 'enabled' | 'draining';

/** Absence, malformed input, and every unrecognized value fail closed. */
export const continuationHttpMode = (value: unknown): ContinuationHttpMode => {
  if (value === CONTINUATION_HTTP_ACTIVATION_VALUE) return 'enabled';
  if (value === CONTINUATION_HTTP_DRAIN_VALUE) return 'draining';
  return 'closed';
};
