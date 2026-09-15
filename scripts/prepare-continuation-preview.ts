import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

import {
  CONTINUATION_KEYRING_FORMAT,
  MAX_CONTINUATION_DECRYPT_KEYS,
  readContinuationKeyringConfiguration,
} from '../apps/server/src/continuation-keyring-schema.js';
import { CONTINUATION_HTTP_ACTIVATION_VALUE } from '../apps/server/src/continuation-http-activation.js';
import {
  CONTINUATION_QUOTA_CONFIGURATION_FORMAT,
  readContinuationQuotaConfiguration,
} from '../apps/server/src/continuation-quota-configuration.js';

export const CONTINUATION_PREVIEW_BUNDLE_FORMAT =
  'ptcgsim-continuation-preview-bundle-v1' as const;
export const CONTINUATION_PREVIEW_PRIVATE_DIRECTORY = join(
  '.private',
  'continuation-preview'
);
export const CONTINUATION_PREVIEW_CREDENTIALS_FILE =
  'continuation-credentials.json';
export const CONTINUATION_PREVIEW_ACTIVATION_FILE =
  'continuation-activate.json';
export const CONTINUATION_PREVIEW_DEACTIVATION_FILE =
  'continuation-deactivate.json';
export const CONTINUATION_PREVIEW_CONFIG_FILE = 'wrangler.json';
export const CONTINUATION_PREVIEW_MANIFEST_FILE = 'manifest.json';

const PRODUCTION_WORKER_NAME = 'ptcgsim-v2';
const EXPECTED_SOURCE_CONFIG_KEYS = Object.freeze([
  '$schema',
  'assets',
  'compatibility_date',
  'compatibility_flags',
  'durable_objects',
  'exports',
  'main',
  'name',
  'observability',
  'ratelimits',
  'vars',
]);
const EXPECTED_RATE_LIMIT_BINDINGS = Object.freeze([
  'ROOM_CREATION_RATE_LIMITER',
  'CONTINUATION_CREATION_RATE_LIMITER',
  'CONTINUATION_RESTORE_RATE_LIMITER',
  'CONTINUATION_REVOCATION_RATE_LIMITER',
]);
const MAXIMUM_PREVIOUS_CREDENTIAL_BYTES = 8 * 1024;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const WORKER_NAME_PATTERN =
  /^ptcgsim-v2-continuation-preview(?:-[a-z0-9](?:[a-z0-9-]{0,29}[a-z0-9])?)?$/u;
const BUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;

interface EncodedContinuationKey {
  readonly id: string;
  readonly material: string;
}

interface EncodedContinuationKeyring {
  readonly format: typeof CONTINUATION_KEYRING_FORMAT;
  readonly activeKeyId: string;
  readonly keys: readonly EncodedContinuationKey[];
}

interface ContinuationPreviewArguments {
  readonly output: string;
  readonly workerName: string;
  readonly buildId: string;
  readonly keyId: string;
  readonly quotaShards: number;
  readonly quotaLeasesPerShard: number;
  readonly rateNamespaceBase: number;
  readonly previousCredentials?: string;
}

export interface PrepareContinuationPreviewOptions extends ContinuationPreviewArguments {
  readonly repositoryRoot: string;
  readonly sourceConfig?: string;
  readonly generateKeyBytes?: () => Uint8Array;
}

interface PreviewRateLimitNamespace {
  readonly binding: string;
  readonly namespaceId: string;
}

export interface ContinuationPreviewManifest {
  readonly format: typeof CONTINUATION_PREVIEW_BUNDLE_FORMAT;
  readonly workerName: string;
  readonly buildId: string;
  readonly sourceConfig: string;
  readonly activeKeyId: string;
  readonly retainedDecryptKeyIds: readonly string[];
  readonly quota: {
    readonly shardCount: number;
    readonly maximumActiveLeasesPerShard: number;
    readonly maximumActiveLeases: number;
  };
  readonly rateLimitNamespaces: readonly PreviewRateLimitNamespace[];
  readonly files: {
    readonly wranglerConfig: typeof CONTINUATION_PREVIEW_CONFIG_FILE;
    readonly credentials: typeof CONTINUATION_PREVIEW_CREDENTIALS_FILE;
    readonly activation: typeof CONTINUATION_PREVIEW_ACTIVATION_FILE;
    readonly deactivation: typeof CONTINUATION_PREVIEW_DEACTIVATION_FILE;
  };
  readonly safety: {
    readonly productionWorkerRejected: true;
    readonly productionRoutesCopied: false;
    readonly activationAbsentFromWranglerConfig: true;
    readonly generatedFilesMode: '0600';
  };
}

export interface ContinuationPreviewBundle {
  readonly outputDirectory: string;
  readonly manifest: ContinuationPreviewManifest;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const exactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.every((key) => typeof key === 'string') &&
    JSON.stringify((keys as string[]).sort(compareStrings)) ===
      JSON.stringify([...expected].sort(compareStrings))
  );
};

const objectRecord = (
  value: unknown,
  label: string
): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const cloneJson = <Value>(value: Value): Value =>
  JSON.parse(JSON.stringify(value)) as Value;

const isInside = (candidate: string, parent: string): boolean => {
  const child = relative(parent, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`));
};

export const assertContinuationPreviewPrivateLocation = (
  outputDirectory: string,
  repositoryRoot: string
): void => {
  const output = resolve(outputDirectory);
  const repository = resolve(repositoryRoot);
  const privateRoot = join(repository, CONTINUATION_PREVIEW_PRIVATE_DIRECTORY);
  if (
    isInside(output, repository) &&
    (!isInside(output, privateRoot) || output === privateRoot)
  ) {
    throw new Error(
      'In-repository output must be a child of .private/continuation-preview'
    );
  }
};

const assertExistingPathHasNoSymbolicLinks = async (
  target: string
): Promise<void> => {
  const absolute = resolve(target);
  const root = isAbsolute(absolute) ? sep : '';
  const components = absolute.split(sep).filter(Boolean);
  let cursor = root;
  for (const component of components) {
    cursor = cursor === sep ? `${sep}${component}` : join(cursor, component);
    let metadata;
    try {
      metadata = await lstat(cursor);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        Reflect.get(error, 'code') === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      throw new Error('Preview bundle paths cannot contain symbolic links');
    }
    if (!metadata.isDirectory() && cursor !== absolute) {
      throw new Error('Preview bundle parent paths must be directories');
    }
  }
};

const parsePositiveInteger = (value: string, label: string): number => {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    throw new Error(`${label} must be a positive decimal integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return parsed;
};

const validateArguments = (
  arguments_: ContinuationPreviewArguments
): ContinuationPreviewArguments => {
  if (
    arguments_.workerName === PRODUCTION_WORKER_NAME ||
    !WORKER_NAME_PATTERN.test(arguments_.workerName)
  ) {
    throw new Error(
      '--worker-name must name an isolated ptcgsim-v2-continuation-preview Worker'
    );
  }
  if (!BUILD_ID_PATTERN.test(arguments_.buildId)) {
    throw new Error('--build-id is not a safe health/telemetry build ID');
  }
  if (!KEY_ID_PATTERN.test(arguments_.keyId)) {
    throw new Error('--key-id must contain 1-64 base64url-safe characters');
  }
  if (
    !Number.isSafeInteger(arguments_.quotaShards) ||
    arguments_.quotaShards <= 0 ||
    !Number.isSafeInteger(arguments_.quotaLeasesPerShard) ||
    arguments_.quotaLeasesPerShard <= 0
  ) {
    throw new Error('Quota values must be positive safe integers');
  }
  if (
    !Number.isSafeInteger(arguments_.rateNamespaceBase) ||
    arguments_.rateNamespaceBase <= 0 ||
    arguments_.rateNamespaceBase > Number.MAX_SAFE_INTEGER - 3
  ) {
    throw new Error('--rate-namespace-base cannot allocate four safe IDs');
  }
  return arguments_;
};

export const parseContinuationPreviewArguments = (
  arguments_: readonly string[]
): ContinuationPreviewArguments => {
  const values = new Map<string, string>();
  const supported = new Set([
    '--output',
    '--worker-name',
    '--build-id',
    '--key-id',
    '--quota-shards',
    '--quota-leases-per-shard',
    '--rate-namespace-base',
    '--previous-credentials',
  ]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === '--' && index === 0) continue;
    if (!supported.has(argument))
      throw new Error(`Unknown argument: ${argument}`);
    if (values.has(argument))
      throw new Error(`${argument} may be provided once`);
    const value = arguments_[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    values.set(argument, value);
    index += 1;
  }

  const required = (name: string): string => {
    const value = values.get(name);
    if (value === undefined) throw new Error(`${name} is required`);
    return value;
  };

  return validateArguments({
    output: required('--output'),
    workerName: required('--worker-name'),
    buildId: required('--build-id'),
    keyId: required('--key-id'),
    quotaShards: parsePositiveInteger(
      required('--quota-shards'),
      '--quota-shards'
    ),
    quotaLeasesPerShard: parsePositiveInteger(
      required('--quota-leases-per-shard'),
      '--quota-leases-per-shard'
    ),
    rateNamespaceBase: parsePositiveInteger(
      required('--rate-namespace-base'),
      '--rate-namespace-base'
    ),
    ...(values.has('--previous-credentials')
      ? { previousCredentials: values.get('--previous-credentials')! }
      : {}),
  });
};

const readBoundedPrivateFile = async (path: string): Promise<string> => {
  const absolute = resolve(path);
  await assertExistingPathHasNoSymbolicLinks(absolute);
  const metadata = await lstat(absolute);
  if (!metadata.isFile())
    throw new Error('Previous credentials must be a file');
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error('Previous credentials must not be group/world accessible');
  }
  if (
    !Number.isSafeInteger(metadata.size) ||
    metadata.size > MAXIMUM_PREVIOUS_CREDENTIAL_BYTES
  ) {
    throw new Error(
      `Previous credentials cannot exceed ${MAXIMUM_PREVIOUS_CREDENTIAL_BYTES} bytes`
    );
  }
  const handle = await open(
    absolute,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const bytes = await handle.readFile();
    if (bytes.byteLength !== metadata.size) {
      bytes.fill(0);
      throw new Error('Previous credentials changed while being read');
    }
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('Previous credentials must contain valid UTF-8');
    } finally {
      bytes.fill(0);
    }
    return decoded;
  } finally {
    await handle.close();
  }
};

const parsePreviousKeyring = async (
  path: string
): Promise<EncodedContinuationKeyring> => {
  let outer: unknown;
  try {
    outer = JSON.parse(await readBoundedPrivateFile(path)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Previous credentials are not valid JSON', {
        cause: error,
      });
    }
    throw error;
  }
  if (
    typeof outer !== 'object' ||
    outer === null ||
    !exactKeys(outer, [
      'CONTINUATION_KEYRING',
      'CONTINUATION_QUOTA_CONFIGURATION',
    ])
  ) {
    throw new Error('Previous credentials have an unexpected schema');
  }
  const encodedKeyring = Reflect.get(outer, 'CONTINUATION_KEYRING');
  const encodedQuota = Reflect.get(outer, 'CONTINUATION_QUOTA_CONFIGURATION');
  if (typeof encodedKeyring !== 'string' || typeof encodedQuota !== 'string') {
    throw new Error('Previous credentials have an unexpected schema');
  }
  readContinuationKeyringConfiguration(encodedKeyring);
  readContinuationQuotaConfiguration(encodedQuota);
  const keyring = objectRecord(
    JSON.parse(encodedKeyring) as unknown,
    'Previous continuation keyring'
  );
  return keyring as unknown as EncodedContinuationKeyring;
};

const readSourceWranglerConfig = async (
  sourceConfig: string
): Promise<Record<string, unknown>> => {
  const source = await readFile(sourceConfig, 'utf8');
  const parsed = ts.parseConfigFileTextToJson(sourceConfig, source);
  if (parsed.error !== undefined) {
    throw new Error('Checked-in Wrangler configuration is invalid');
  }
  const config = objectRecord(
    parsed.config,
    'Checked-in Wrangler configuration'
  );
  if (!exactKeys(config, EXPECTED_SOURCE_CONFIG_KEYS)) {
    throw new Error(
      'Checked-in Wrangler topology changed; preview generator review is required'
    );
  }
  if (config.name !== PRODUCTION_WORKER_NAME) {
    throw new Error('Checked-in Wrangler production Worker name changed');
  }
  const variables = objectRecord(config.vars, 'Checked-in Wrangler vars');
  if (!exactKeys(variables, ['BUILD_ID'])) {
    throw new Error(
      'Checked-in Wrangler vars changed; preview review is required'
    );
  }
  return config;
};

const positiveNamespaceId = (value: unknown, label: string): number => {
  if (typeof value !== 'string') throw new Error(`${label} is invalid`);
  return parsePositiveInteger(value, label);
};

const buildPreviewWranglerConfig = (
  source: Record<string, unknown>,
  sourceConfig: string,
  arguments_: ContinuationPreviewArguments
): {
  readonly config: Record<string, unknown>;
  readonly rateLimitNamespaces: readonly PreviewRateLimitNamespace[];
} => {
  const sourceRateLimits = source.ratelimits;
  if (!Array.isArray(sourceRateLimits) || sourceRateLimits.length !== 4) {
    throw new Error('Checked-in Wrangler rate-limit topology changed');
  }
  const sourceNamespaceIds = new Set<number>();
  const byBinding = new Map<string, Record<string, unknown>>();
  for (const entry of sourceRateLimits) {
    const limiter = objectRecord(entry, 'Checked-in Wrangler rate limiter');
    if (!exactKeys(limiter, ['name', 'namespace_id', 'simple'])) {
      throw new Error('Checked-in Wrangler rate-limit topology changed');
    }
    if (typeof limiter.name !== 'string') {
      throw new Error('Checked-in Wrangler rate-limit binding is invalid');
    }
    const namespaceId = positiveNamespaceId(
      limiter.namespace_id,
      'Checked-in Wrangler rate-limit namespace'
    );
    if (sourceNamespaceIds.has(namespaceId) || byBinding.has(limiter.name)) {
      throw new Error(
        'Checked-in Wrangler rate-limit bindings are not distinct'
      );
    }
    sourceNamespaceIds.add(namespaceId);
    byBinding.set(limiter.name, limiter);
  }
  if (
    [...byBinding.keys()].sort(compareStrings).join('\u0000') !==
    [...EXPECTED_RATE_LIMIT_BINDINGS].sort(compareStrings).join('\u0000')
  ) {
    throw new Error('Checked-in Wrangler rate-limit bindings changed');
  }

  const rateLimitNamespaces = EXPECTED_RATE_LIMIT_BINDINGS.map(
    (binding, index): PreviewRateLimitNamespace => ({
      binding,
      namespaceId: String(arguments_.rateNamespaceBase + index),
    })
  );
  if (
    rateLimitNamespaces.some(({ namespaceId }) =>
      sourceNamespaceIds.has(Number(namespaceId))
    )
  ) {
    throw new Error(
      'Preview rate-limit namespaces must not overlap checked-in production namespaces'
    );
  }

  const sourceDirectory = dirname(resolve(sourceConfig));
  const main = source.main;
  if (typeof main !== 'string')
    throw new Error('Checked-in Wrangler main is invalid');
  const assets = objectRecord(source.assets, 'Checked-in Wrangler assets');
  if (typeof assets.directory !== 'string') {
    throw new Error('Checked-in Wrangler asset directory is invalid');
  }

  const ratelimits = rateLimitNamespaces.map(({ binding, namespaceId }) => {
    const sourceLimiter = byBinding.get(binding)!;
    return {
      name: binding,
      namespace_id: namespaceId,
      simple: cloneJson(sourceLimiter.simple),
    };
  });
  return {
    config: {
      name: arguments_.workerName,
      main: resolve(sourceDirectory, main),
      compatibility_date: cloneJson(source.compatibility_date),
      compatibility_flags: cloneJson(source.compatibility_flags),
      workers_dev: true,
      vars: { BUILD_ID: arguments_.buildId },
      assets: {
        ...cloneJson(assets),
        directory: resolve(sourceDirectory, assets.directory),
      },
      durable_objects: cloneJson(source.durable_objects),
      ratelimits,
      exports: cloneJson(source.exports),
      observability: cloneJson(source.observability),
    },
    rateLimitNamespaces,
  };
};

const serializeJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

const writePrivateFile = async (
  path: string,
  contents: string
): Promise<void> => {
  const handle = await open(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(contents, 'utf8');
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
};

const sourceConfigLabel = (
  sourceConfig: string,
  repositoryRoot: string
): string => {
  const path = resolve(sourceConfig);
  const repository = resolve(repositoryRoot);
  return isInside(path, repository) ? relative(repository, path) : path;
};

export const prepareContinuationPreview = async (
  options: PrepareContinuationPreviewOptions
): Promise<ContinuationPreviewBundle> => {
  const arguments_ = validateArguments(options);
  const repositoryRoot = resolve(options.repositoryRoot);
  const outputDirectory = resolve(options.output);
  const sourceConfig = resolve(
    options.sourceConfig ?? join(repositoryRoot, 'apps/server/wrangler.jsonc')
  );
  assertContinuationPreviewPrivateLocation(outputDirectory, repositoryRoot);
  await assertExistingPathHasNoSymbolicLinks(dirname(outputDirectory));

  const source = await readSourceWranglerConfig(sourceConfig);
  const { config, rateLimitNamespaces } = buildPreviewWranglerConfig(
    source,
    sourceConfig,
    arguments_
  );
  const previous =
    options.previousCredentials === undefined
      ? undefined
      : await parsePreviousKeyring(options.previousCredentials);
  if (previous?.keys.some(({ id }) => id === arguments_.keyId)) {
    throw new Error('--key-id must be new when rotating a keyring');
  }
  if ((previous?.keys.length ?? 0) >= MAX_CONTINUATION_DECRYPT_KEYS) {
    throw new Error(
      'Keyring is full; retire an eligible expired key before adding another'
    );
  }

  const sourceKeyBytes = (
    options.generateKeyBytes ?? (() => randomBytes(32))
  )();
  if (!(sourceKeyBytes instanceof Uint8Array)) {
    throw new Error('Key generator must return a byte array');
  }
  if (sourceKeyBytes.byteLength !== 32) {
    sourceKeyBytes.fill(0);
    throw new Error('Key generator must return exactly 32 bytes');
  }
  const generated = Uint8Array.from(sourceKeyBytes);
  sourceKeyBytes.fill(0);
  let material: string;
  try {
    material = Buffer.from(
      generated.buffer,
      generated.byteOffset,
      generated.byteLength
    ).toString('base64url');
  } finally {
    generated.fill(0);
  }
  if (previous?.keys.some((key) => key.material === material)) {
    throw new Error('Generated key material duplicates a retained key');
  }

  const keyring: EncodedContinuationKeyring = {
    format: CONTINUATION_KEYRING_FORMAT,
    activeKeyId: arguments_.keyId,
    keys: [{ id: arguments_.keyId, material }, ...(previous?.keys ?? [])],
  };
  const encodedKeyring = JSON.stringify(keyring);
  readContinuationKeyringConfiguration(encodedKeyring);

  const encodedQuota = JSON.stringify({
    format: CONTINUATION_QUOTA_CONFIGURATION_FORMAT,
    shardCount: arguments_.quotaShards,
    maximumActiveLeasesPerShard: arguments_.quotaLeasesPerShard,
  });
  const quota = readContinuationQuotaConfiguration(encodedQuota);
  const credentials = {
    CONTINUATION_KEYRING: encodedKeyring,
    CONTINUATION_QUOTA_CONFIGURATION: encodedQuota,
  };
  const activation = {
    CONTINUATION_HTTP_ACTIVATION: CONTINUATION_HTTP_ACTIVATION_VALUE,
  };
  const deactivation = { CONTINUATION_HTTP_ACTIVATION: null };
  const manifest: ContinuationPreviewManifest = {
    format: CONTINUATION_PREVIEW_BUNDLE_FORMAT,
    workerName: arguments_.workerName,
    buildId: arguments_.buildId,
    sourceConfig: sourceConfigLabel(sourceConfig, repositoryRoot),
    activeKeyId: arguments_.keyId,
    retainedDecryptKeyIds: (previous?.keys ?? []).map(({ id }) => id),
    quota: {
      shardCount: quota.shardCount,
      maximumActiveLeasesPerShard: quota.maximumActiveLeasesPerShard,
      maximumActiveLeases: quota.maximumActiveLeases,
    },
    rateLimitNamespaces,
    files: {
      wranglerConfig: CONTINUATION_PREVIEW_CONFIG_FILE,
      credentials: CONTINUATION_PREVIEW_CREDENTIALS_FILE,
      activation: CONTINUATION_PREVIEW_ACTIVATION_FILE,
      deactivation: CONTINUATION_PREVIEW_DEACTIVATION_FILE,
    },
    safety: {
      productionWorkerRejected: true,
      productionRoutesCopied: false,
      activationAbsentFromWranglerConfig: true,
      generatedFilesMode: '0600',
    },
  };

  let createdOutput = false;
  try {
    await mkdir(dirname(outputDirectory), { recursive: true, mode: 0o700 });
    await assertExistingPathHasNoSymbolicLinks(dirname(outputDirectory));
    await mkdir(outputDirectory, { mode: 0o700 });
    createdOutput = true;
    await chmod(outputDirectory, 0o700);
    await writePrivateFile(
      join(outputDirectory, CONTINUATION_PREVIEW_CONFIG_FILE),
      serializeJson(config)
    );
    await writePrivateFile(
      join(outputDirectory, CONTINUATION_PREVIEW_MANIFEST_FILE),
      serializeJson(manifest)
    );
    await writePrivateFile(
      join(outputDirectory, CONTINUATION_PREVIEW_CREDENTIALS_FILE),
      serializeJson(credentials)
    );
    await writePrivateFile(
      join(outputDirectory, CONTINUATION_PREVIEW_ACTIVATION_FILE),
      serializeJson(activation)
    );
    await writePrivateFile(
      join(outputDirectory, CONTINUATION_PREVIEW_DEACTIVATION_FILE),
      serializeJson(deactivation)
    );
  } catch (error) {
    if (createdOutput) await rm(outputDirectory, { recursive: true });
    throw error;
  }
  return { outputDirectory, manifest };
};

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    const arguments_ = parseContinuationPreviewArguments(process.argv.slice(2));
    const repositoryRoot = resolve(
      fileURLToPath(new URL('.', import.meta.url)),
      '..'
    );
    const result = await prepareContinuationPreview({
      ...arguments_,
      repositoryRoot,
    });
    const outputLabel = isInside(result.outputDirectory, repositoryRoot)
      ? relative(repositoryRoot, result.outputDirectory)
      : result.outputDirectory;
    process.stdout.write(
      `Prepared default-off continuation preview bundle for ${result.manifest.workerName} in ${outputLabel}.\n` +
        'No Cloudflare command was run and no secret value was printed.\n'
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
