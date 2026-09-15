/** Exact opt-in value; absence and every other value keep both routes hidden. */
export const CONTINUATION_HTTP_ACTIVATION_VALUE =
  'ptcgsim-continuation-http-v1:enabled';

export const continuationHttpIsActive = (value: unknown): boolean =>
  value === CONTINUATION_HTTP_ACTIVATION_VALUE;
