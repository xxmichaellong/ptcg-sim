import { MATCH_STATE_SCHEMA_VERSION } from '@ptcgsim/game-core';
import { PROTOCOL_VERSION } from '@ptcgsim/protocol';
import { AUTHORITY_SNAPSHOT_SCHEMA_VERSION } from '@ptcgsim/room-authority';

import { browserJsonResponse as json } from './browser-json-http.js';
import { safeTelemetryBuildId } from './server-telemetry.js';

export const handleServerHealthRequest = (
  request: Request,
  buildId: string
): Response => {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  if (new URL(request.url).search) {
    return json({ error: 'invalid_request' }, 400);
  }
  return json(
    {
      status: 'ok',
      buildId: safeTelemetryBuildId(buildId),
      protocolVersion: PROTOCOL_VERSION,
      authoritySchemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      matchStateSchemaVersion: MATCH_STATE_SCHEMA_VERSION,
    },
    200
  );
};
