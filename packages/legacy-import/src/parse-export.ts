export const LEGACY_EXPORT_FORMAT = 'ptcgsim-v1-action-export' as const;

export const SUPPORTED_LEGACY_EXPORT_VERSIONS = ['1.5', '1.5.1'] as const;
export type LegacyExportVersion =
  (typeof SUPPORTED_LEGACY_EXPORT_VERSIONS)[number];

export const LEGACY_SYNCHRONIZED_ACTION_NAMES = [
  'exchangeData',
  'loadDeckData',
  'changeCardBack',
  'reset',
  'setup',
  'takeTurn',
  'draw',
  'moveCardBundle',
  'shuffleIntoDeck',
  'moveToDeckTop',
  'switchWithDeckTop',
  'viewDeck',
  'shuffleAll',
  'shuffleBottom',
  'discardAll',
  'lostZoneAll',
  'handAll',
  'leaveAll',
  'discardAndDraw',
  'shuffleAndDraw',
  'shuffleBottomAndDraw',
  'shufflePrizesToDeckBottom',
  'shuffleZone',
  'useAbility',
  'removeAbilityCounter',
  'addDamageCounter',
  'updateDamageCounter',
  'removeDamageCounter',
  'addSpecialCondition',
  'updateSpecialCondition',
  'removeSpecialCondition',
  'discardBoard',
  'handBoard',
  'shuffleBoard',
  'lostZoneBoard',
  'lookAtCards',
  'stopLookingAtCards',
  'revealCards',
  'hideCards',
  'revealShortcut',
  'hideShortcut',
  'lookShortcut',
  'stopLookingShortcut',
  'playRandomCardFaceDown',
  'rotateCard',
  'changeType',
  'attack',
  'pass',
  'VSTARGXFunction',
  'undo',
] as const;

export type LegacySynchronizedActionName =
  (typeof LEGACY_SYNCHRONIZED_ACTION_NAMES)[number];
export type LegacyExportUser = 'self' | 'opp';

export const MAX_LEGACY_EXPORT_CODE_UNITS = 4 * 1024 * 1024;
export const MAX_LEGACY_EXPORT_ACTIONS = 10_000;
export const MAX_LEGACY_ACTION_PARAMETERS = 64;
export const MAX_LEGACY_JSON_DEPTH = 16;
export const MAX_LEGACY_JSON_COLLECTION_ITEMS = 10_000;
export const MAX_LEGACY_JSON_STRING_CODE_UNITS = 16_384;
export const MAX_LEGACY_DECK_ROWS = 200;

export type LegacyJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly LegacyJsonValue[]
  | { readonly [key: string]: LegacyJsonValue };

export type LegacyDeckRow = readonly [
  quantity: string,
  name: string,
  category: string,
  imageUrl: string,
];

export type LegacyDeckData = '' | readonly LegacyDeckRow[];

export interface LegacyActionRecord {
  readonly user: LegacyExportUser;
  readonly emit: true;
  readonly action: LegacySynchronizedActionName;
  readonly parameters: readonly LegacyJsonValue[];
}

export interface ParsedLegacyExport {
  readonly format: typeof LEGACY_EXPORT_FORMAT;
  readonly version: LegacyExportVersion;
  readonly selfDeck: LegacyDeckData;
  readonly opponentDeck: LegacyDeckData;
  readonly actions: readonly LegacyActionRecord[];
}

export type LegacyExportParseIssueCode =
  | 'empty_input'
  | 'payload_too_large'
  | 'invalid_json'
  | 'invalid_root'
  | 'too_many_actions'
  | 'invalid_version_record'
  | 'unsupported_version'
  | 'invalid_action_record'
  | 'unknown_action'
  | 'invalid_parameters'
  | 'invalid_bootstrap'
  | 'invalid_deck'
  | 'structure_too_deep'
  | 'collection_too_large'
  | 'string_too_large'
  | 'invalid_number';

export interface LegacyExportParseIssue {
  readonly code: LegacyExportParseIssueCode;
  readonly path: string;
  readonly message: string;
}

export type LegacyExportParseResult =
  | { readonly ok: true; readonly value: ParsedLegacyExport }
  | { readonly ok: false; readonly issues: readonly LegacyExportParseIssue[] };

const actionNames = new Set<string>(LEGACY_SYNCHRONIZED_ACTION_NAMES);
const versions = new Set<string>(SUPPORTED_LEGACY_EXPORT_VERSIONS);

const issue = (
  code: LegacyExportParseIssueCode,
  path: string,
  message: string
): LegacyExportParseResult => ({
  ok: false,
  issues: [{ code, path, message }],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const inspectJsonValue = (
  value: unknown,
  path: string,
  depth: number
): LegacyExportParseIssue | null => {
  if (depth > MAX_LEGACY_JSON_DEPTH) {
    return {
      code: 'structure_too_deep',
      path,
      message: `Legacy JSON nesting exceeds ${MAX_LEGACY_JSON_DEPTH}`,
    };
  }
  if (value === null || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? null
      : {
          code: 'invalid_number',
          path,
          message: 'Legacy JSON numbers must be finite',
        };
  }
  if (typeof value === 'string') {
    return value.length <= MAX_LEGACY_JSON_STRING_CODE_UNITS
      ? null
      : {
          code: 'string_too_large',
          path,
          message: `Legacy JSON strings cannot exceed ${MAX_LEGACY_JSON_STRING_CODE_UNITS} code units`,
        };
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_LEGACY_JSON_COLLECTION_ITEMS) {
      return {
        code: 'collection_too_large',
        path,
        message: `Legacy JSON arrays cannot exceed ${MAX_LEGACY_JSON_COLLECTION_ITEMS} items`,
      };
    }
    for (let index = 0; index < value.length; index += 1) {
      const problem = inspectJsonValue(
        value[index],
        `${path}[${index}]`,
        depth + 1
      );
      if (problem) return problem;
    }
    return null;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_LEGACY_JSON_COLLECTION_ITEMS) {
      return {
        code: 'collection_too_large',
        path,
        message: `Legacy JSON objects cannot exceed ${MAX_LEGACY_JSON_COLLECTION_ITEMS} fields`,
      };
    }
    for (const [key, entry] of entries) {
      if (key.length > MAX_LEGACY_JSON_STRING_CODE_UNITS) {
        return {
          code: 'string_too_large',
          path,
          message: 'Legacy JSON field name is too large',
        };
      }
      const problem = inspectJsonValue(entry, `${path}.${key}`, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  return {
    code: 'invalid_parameters',
    path,
    message: 'Legacy parameters must contain JSON values only',
  };
};

const parseAction = (
  value: unknown,
  index: number
): LegacyActionRecord | LegacyExportParseIssue => {
  const path = `$[${index}]`;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['user', 'emit', 'action', 'parameters']) ||
    (value.user !== 'self' && value.user !== 'opp') ||
    value.emit !== true ||
    typeof value.action !== 'string' ||
    !Array.isArray(value.parameters)
  ) {
    return {
      code: 'invalid_action_record',
      path,
      message:
        'Legacy actions require only user, emit, action, and parameters fields',
    };
  }
  if (!actionNames.has(value.action)) {
    return {
      code: 'unknown_action',
      path: `${path}.action`,
      message: 'Unsupported legacy action name',
    };
  }
  if (value.parameters.length > MAX_LEGACY_ACTION_PARAMETERS) {
    return {
      code: 'invalid_parameters',
      path: `${path}.parameters`,
      message: `Legacy actions cannot have more than ${MAX_LEGACY_ACTION_PARAMETERS} parameters`,
    };
  }
  const parametersProblem = inspectJsonValue(
    value.parameters,
    `${path}.parameters`,
    0
  );
  if (parametersProblem) return parametersProblem;
  return {
    user: value.user,
    emit: value.emit,
    action: value.action as LegacySynchronizedActionName,
    parameters: value.parameters as LegacyJsonValue[],
  };
};

const parseDeck = (
  value: LegacyJsonValue,
  path: string
): LegacyDeckData | LegacyExportParseIssue => {
  if (value === '') return '';
  if (!Array.isArray(value) || value.length > MAX_LEGACY_DECK_ROWS) {
    return {
      code: 'invalid_deck',
      path,
      message: `Legacy deck data must be empty or contain at most ${MAX_LEGACY_DECK_ROWS} rows`,
    };
  }
  const rows: LegacyDeckRow[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index];
    if (
      !Array.isArray(row) ||
      row.length !== 4 ||
      !row.every((field) => typeof field === 'string')
    ) {
      return {
        code: 'invalid_deck',
        path: `${path}[${index}]`,
        message:
          'Legacy deck rows must be [quantity, name, category, imageUrl] strings',
      };
    }
    rows.push(row as unknown as LegacyDeckRow);
  }
  return rows;
};

const isIssue = (
  value: LegacyActionRecord | LegacyDeckData | LegacyExportParseIssue
): value is LegacyExportParseIssue =>
  isRecord(value) && typeof value.code === 'string';

/**
 * Parses only the frozen v1 action-export envelope. It never imports or invokes
 * a legacy module, dynamically resolves an action name, or partially converts
 * a match. Positional action semantics belong to versioned interpreters built
 * on top of this boundary.
 */
export const parseLegacyExportJson = (
  source: string
): LegacyExportParseResult => {
  if (typeof source !== 'string' || source.length === 0) {
    return issue('empty_input', '$', 'Legacy export JSON is empty');
  }
  if (source.length > MAX_LEGACY_EXPORT_CODE_UNITS) {
    return issue(
      'payload_too_large',
      '$',
      `Legacy export JSON cannot exceed ${MAX_LEGACY_EXPORT_CODE_UNITS} code units`
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(source) as unknown;
  } catch {
    return issue('invalid_json', '$', 'Legacy export is not valid JSON');
  }
  if (!Array.isArray(decoded) || decoded.length < 3) {
    return issue(
      'invalid_root',
      '$',
      'Legacy export must contain a version and two deck bootstrap actions'
    );
  }
  if (decoded.length - 1 > MAX_LEGACY_EXPORT_ACTIONS) {
    return issue(
      'too_many_actions',
      '$',
      `Legacy export cannot exceed ${MAX_LEGACY_EXPORT_ACTIONS} actions`
    );
  }

  const versionRecord = decoded[0];
  if (
    !isRecord(versionRecord) ||
    !hasExactKeys(versionRecord, ['version']) ||
    typeof versionRecord.version !== 'string'
  ) {
    return issue(
      'invalid_version_record',
      '$[0]',
      'Legacy export must begin with exactly one string version field'
    );
  }
  if (!versions.has(versionRecord.version)) {
    return issue(
      'unsupported_version',
      '$[0].version',
      'Unsupported legacy export version'
    );
  }

  const actions: LegacyActionRecord[] = [];
  for (let index = 1; index < decoded.length; index += 1) {
    const action = parseAction(decoded[index], index);
    if (isIssue(action)) return { ok: false, issues: [action] };
    actions.push(action);
  }

  const selfBootstrap = actions[0];
  const opponentBootstrap = actions[1];
  if (
    !selfBootstrap ||
    selfBootstrap.user !== 'self' ||
    selfBootstrap.emit !== true ||
    selfBootstrap.action !== 'loadDeckData' ||
    selfBootstrap.parameters.length !== 1 ||
    !opponentBootstrap ||
    opponentBootstrap.user !== 'opp' ||
    opponentBootstrap.emit !== true ||
    opponentBootstrap.action !== 'loadDeckData' ||
    opponentBootstrap.parameters.length !== 1
  ) {
    return issue(
      'invalid_bootstrap',
      '$[1..2]',
      'Legacy export must begin with self then opponent loadDeckData actions'
    );
  }
  const selfDeck = parseDeck(
    selfBootstrap.parameters[0]!,
    '$[1].parameters[0]'
  );
  if (isIssue(selfDeck)) return { ok: false, issues: [selfDeck] };
  const opponentDeck = parseDeck(
    opponentBootstrap.parameters[0]!,
    '$[2].parameters[0]'
  );
  if (isIssue(opponentDeck)) return { ok: false, issues: [opponentDeck] };

  return {
    ok: true,
    value: {
      format: LEGACY_EXPORT_FORMAT,
      version: versionRecord.version as LegacyExportVersion,
      selfDeck,
      opponentDeck,
      actions,
    },
  };
};
