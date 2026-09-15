import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { promisify } from 'node:util';

import {
  CONTINUATION_HTTP_ACTIVATION_VALUE,
  CONTINUATION_HTTP_DRAIN_VALUE,
} from '../apps/server/src/continuation-http-activation.js';
import { readContinuationKeyringConfiguration } from '../apps/server/src/continuation-keyring-schema.js';
import { readContinuationQuotaConfiguration } from '../apps/server/src/continuation-quota-configuration.js';
import {
  CONTINUATION_PREVIEW_ACTIVATION_FILE,
  CONTINUATION_PREVIEW_BUNDLE_FORMAT,
  CONTINUATION_PREVIEW_CONFIG_FILE,
  CONTINUATION_PREVIEW_CREDENTIALS_FILE,
  CONTINUATION_PREVIEW_DEACTIVATION_FILE,
  CONTINUATION_PREVIEW_DRAIN_FILE,
  CONTINUATION_PREVIEW_MANIFEST_FILE,
  assertContinuationPreviewPrivateLocation,
  parseContinuationPreviewArguments,
  prepareContinuationPreview,
} from './prepare-continuation-preview.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const repositoryRoot = resolve('.');
const sourceConfig = resolve('apps/server/wrangler.jsonc');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true }))
  );
});

const temporaryDirectory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), 'ptcgsim-continuation-preview-'));
  temporaryDirectories.push(path);
  return path;
};

const byteGenerator =
  (byte: number): (() => Uint8Array) =>
  () =>
    new Uint8Array(32).fill(byte);

const baseOptions = (output: string, byte = 7) => ({
  repositoryRoot,
  sourceConfig,
  output,
  workerName: 'ptcgsim-v2-continuation-preview-rehearsal',
  buildId: 'preview-abcdef0',
  keyId: 'preview-key-1',
  quotaShards: 4,
  quotaLeasesPerShard: 4,
  rateNamespaceBase: 260_904_101,
  generateKeyBytes: byteGenerator(byte),
});

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;

describe('continuation managed-preview provisioner', () => {
  it('parses an exact, explicit CLI contract', () => {
    assert.deepEqual(
      parseContinuationPreviewArguments([
        '--',
        '--output',
        '.private/continuation-preview/rehearsal',
        '--worker-name',
        'ptcgsim-v2-continuation-preview-rehearsal',
        '--build-id',
        'preview-abcdef0',
        '--key-id',
        'preview-key-1',
        '--quota-shards',
        '4',
        '--quota-leases-per-shard',
        '8',
        '--rate-namespace-base',
        '260904101',
        '--previous-credentials',
        '/secure/previous.json',
      ]),
      {
        output: '.private/continuation-preview/rehearsal',
        workerName: 'ptcgsim-v2-continuation-preview-rehearsal',
        buildId: 'preview-abcdef0',
        keyId: 'preview-key-1',
        quotaShards: 4,
        quotaLeasesPerShard: 8,
        rateNamespaceBase: 260_904_101,
        previousCredentials: '/secure/previous.json',
      }
    );
    assert.throws(
      () =>
        parseContinuationPreviewArguments([
          '--output',
          'one',
          '--output',
          'two',
        ]),
      /--output may be provided once/u
    );
    assert.throws(
      () => parseContinuationPreviewArguments(['--output', 'one']),
      /--worker-name is required/u
    );
    assert.throws(
      () =>
        parseContinuationPreviewArguments([
          '--output',
          'one',
          '--worker-name',
          'ptcgsim-v2',
          '--build-id',
          'build',
          '--key-id',
          'key',
          '--quota-shards',
          '1',
          '--quota-leases-per-shard',
          '1',
          '--rate-namespace-base',
          '1',
        ]),
      /isolated .*preview Worker/u
    );
  });

  it('allows only a child of the ignored private root inside the repository', () => {
    assert.doesNotThrow(() =>
      assertContinuationPreviewPrivateLocation(
        join(repositoryRoot, '.private', 'continuation-preview', 'rehearsal'),
        repositoryRoot
      )
    );
    assert.throws(
      () =>
        assertContinuationPreviewPrivateLocation(
          join(repositoryRoot, 'artifacts', 'preview-secret'),
          repositoryRoot
        ),
      /must be a child of \.private\/continuation-preview/u
    );
    assert.throws(
      () =>
        assertContinuationPreviewPrivateLocation(
          join(repositoryRoot, '.private', 'continuation-preview'),
          repositoryRoot
        ),
      /must be a child/u
    );
  });

  it('writes a private default-off bundle validated by the runtime loaders', async () => {
    const parent = await temporaryDirectory();
    const output = join(parent, 'bundle');
    const sourceKeyBytes = new Uint8Array(32).fill(7);
    const result = await prepareContinuationPreview({
      ...baseOptions(output),
      generateKeyBytes: () => sourceKeyBytes,
    });

    assert.equal(result.manifest.format, CONTINUATION_PREVIEW_BUNDLE_FORMAT);
    assert.equal(
      sourceKeyBytes.every((byte) => byte === 0),
      true
    );
    assert.equal(result.manifest.quota.maximumActiveLeases, 16);
    assert.deepEqual(result.manifest.files, {
      wranglerConfig: CONTINUATION_PREVIEW_CONFIG_FILE,
      credentials: CONTINUATION_PREVIEW_CREDENTIALS_FILE,
      activation: CONTINUATION_PREVIEW_ACTIVATION_FILE,
      drain: CONTINUATION_PREVIEW_DRAIN_FILE,
      deactivation: CONTINUATION_PREVIEW_DEACTIVATION_FILE,
    });
    assert.deepEqual(
      result.manifest.rateLimitNamespaces.map(({ namespaceId }) => namespaceId),
      ['260904101', '260904102', '260904103', '260904104']
    );
    assert.deepEqual(
      (
        await Promise.all(
          [
            CONTINUATION_PREVIEW_CONFIG_FILE,
            CONTINUATION_PREVIEW_MANIFEST_FILE,
            CONTINUATION_PREVIEW_CREDENTIALS_FILE,
            CONTINUATION_PREVIEW_ACTIVATION_FILE,
            CONTINUATION_PREVIEW_DRAIN_FILE,
            CONTINUATION_PREVIEW_DEACTIVATION_FILE,
          ].map(async (file) => [
            (await stat(join(output, file))).mode & 0o777,
            file,
          ])
        )
      ).map(([mode]) => mode),
      [0o600, 0o600, 0o600, 0o600, 0o600, 0o600]
    );
    assert.equal((await stat(output)).mode & 0o777, 0o700);

    const config = await readJson(
      join(output, CONTINUATION_PREVIEW_CONFIG_FILE)
    );
    assert.equal(config.name, result.manifest.workerName);
    assert.equal(config.workers_dev, true);
    assert.equal('routes' in config, false);
    assert.equal('CONTINUATION_HTTP_ACTIVATION' in config, false);
    assert.deepEqual(config.vars, { BUILD_ID: 'preview-abcdef0' });
    assert.equal(
      (config.main as string).endsWith('/apps/server/src/worker.ts'),
      true
    );
    assert.equal(
      (config.assets as { directory: string }).directory.endsWith(
        '/apps/web/dist'
      ),
      true
    );

    const credentials = await readJson(
      join(output, CONTINUATION_PREVIEW_CREDENTIALS_FILE)
    );
    assert.doesNotThrow(() =>
      readContinuationKeyringConfiguration(credentials.CONTINUATION_KEYRING)
    );
    const quota = readContinuationQuotaConfiguration(
      credentials.CONTINUATION_QUOTA_CONFIGURATION
    );
    assert.equal(quota.maximumActiveLeases, 16);
    assert.deepEqual(
      await readJson(join(output, CONTINUATION_PREVIEW_ACTIVATION_FILE)),
      { CONTINUATION_HTTP_ACTIVATION: CONTINUATION_HTTP_ACTIVATION_VALUE }
    );
    assert.deepEqual(
      await readJson(join(output, CONTINUATION_PREVIEW_DRAIN_FILE)),
      { CONTINUATION_HTTP_ACTIVATION: CONTINUATION_HTTP_DRAIN_VALUE }
    );
    assert.deepEqual(
      await readJson(join(output, CONTINUATION_PREVIEW_DEACTIVATION_FILE)),
      { CONTINUATION_HTTP_ACTIVATION: null }
    );

    const serializedManifest = JSON.stringify(result.manifest);
    const parsedKeyring = JSON.parse(
      credentials.CONTINUATION_KEYRING as string
    ) as { keys: { material: string }[] };
    assert.equal(
      serializedManifest.includes(parsedKeyring.keys[0]!.material),
      false
    );
    assert.equal(serializedManifest.includes('CONTINUATION_KEYRING'), false);
  });

  it('refuses existing outputs and symbolic-link parents without modifying them', async () => {
    const parent = await temporaryDirectory();
    const existing = join(parent, 'existing');
    await mkdir(existing);
    await writeFile(join(existing, 'sentinel'), 'keep');
    await assert.rejects(
      prepareContinuationPreview(baseOptions(existing)),
      /EEXIST/u
    );
    assert.equal(await readFile(join(existing, 'sentinel'), 'utf8'), 'keep');

    const actual = join(parent, 'actual');
    const linked = join(parent, 'linked');
    await mkdir(actual);
    await symlink(actual, linked);
    await assert.rejects(
      prepareContinuationPreview(baseOptions(join(linked, 'bundle'))),
      /cannot contain symbolic links/u
    );
  });

  it('rotates by retaining every previous decrypt key without exposing material', async () => {
    const parent = await temporaryDirectory();
    const firstOutput = join(parent, 'first');
    await prepareContinuationPreview(baseOptions(firstOutput, 1));
    const firstCredentials = join(
      firstOutput,
      CONTINUATION_PREVIEW_CREDENTIALS_FILE
    );
    const secondOutput = join(parent, 'second');
    const second = await prepareContinuationPreview({
      ...baseOptions(secondOutput, 2),
      keyId: 'preview-key-2',
      previousCredentials: firstCredentials,
    });

    assert.deepEqual(second.manifest.retainedDecryptKeyIds, ['preview-key-1']);
    const first = await readJson(firstCredentials);
    const rotated = await readJson(
      join(secondOutput, CONTINUATION_PREVIEW_CREDENTIALS_FILE)
    );
    const firstKeyring = JSON.parse(first.CONTINUATION_KEYRING as string) as {
      keys: { id: string; material: string }[];
    };
    const rotatedKeyring = JSON.parse(
      rotated.CONTINUATION_KEYRING as string
    ) as {
      activeKeyId: string;
      keys: { id: string; material: string }[];
    };
    assert.equal(rotatedKeyring.activeKeyId, 'preview-key-2');
    assert.deepEqual(
      rotatedKeyring.keys.map(({ id }) => id),
      ['preview-key-2', 'preview-key-1']
    );
    assert.equal(
      rotatedKeyring.keys[1]!.material,
      firstKeyring.keys[0]!.material
    );
    assert.doesNotThrow(() =>
      readContinuationKeyringConfiguration(rotated.CONTINUATION_KEYRING)
    );
  });

  it('rejects insecure prior credentials, duplicate keys, and a full keyring', async () => {
    const parent = await temporaryDirectory();
    let previousOutput = join(parent, 'key-1');
    await prepareContinuationPreview(baseOptions(previousOutput, 1));
    let previousCredentials = join(
      previousOutput,
      CONTINUATION_PREVIEW_CREDENTIALS_FILE
    );
    await chmod(previousCredentials, 0o644);
    await assert.rejects(
      prepareContinuationPreview({
        ...baseOptions(join(parent, 'insecure'), 2),
        keyId: 'preview-key-2',
        previousCredentials,
      }),
      /must not be group\/world accessible/u
    );
    await chmod(previousCredentials, 0o600);
    await assert.rejects(
      prepareContinuationPreview({
        ...baseOptions(join(parent, 'duplicate-id'), 2),
        previousCredentials,
      }),
      /--key-id must be new/u
    );
    await assert.rejects(
      prepareContinuationPreview({
        ...baseOptions(join(parent, 'duplicate-material'), 1),
        keyId: 'preview-key-2',
        previousCredentials,
      }),
      /duplicates a retained key/u
    );

    for (let key = 2; key <= 4; key += 1) {
      const nextOutput = join(parent, `key-${key}`);
      await prepareContinuationPreview({
        ...baseOptions(nextOutput, key),
        keyId: `preview-key-${key}`,
        previousCredentials,
      });
      previousOutput = nextOutput;
      previousCredentials = join(
        previousOutput,
        CONTINUATION_PREVIEW_CREDENTIALS_FILE
      );
    }
    await assert.rejects(
      prepareContinuationPreview({
        ...baseOptions(join(parent, 'key-5'), 5),
        keyId: 'preview-key-5',
        previousCredentials,
      }),
      /Keyring is full/u
    );
  });

  it('uses runtime bounds and rejects source topology or namespace drift', async () => {
    const parent = await temporaryDirectory();
    await assert.rejects(
      prepareContinuationPreview({
        ...baseOptions(join(parent, 'bad-quota')),
        quotaShards: 4_097,
      }),
      /quota configuration is invalid/iu
    );
    await assert.rejects(
      prepareContinuationPreview({
        ...baseOptions(join(parent, 'overlap')),
        rateNamespaceBase: 260_903_001,
      }),
      /must not overlap/u
    );

    const driftedConfig = join(parent, 'wrangler-drifted.jsonc');
    const checkedIn = await readFile(sourceConfig, 'utf8');
    await writeFile(
      driftedConfig,
      checkedIn.replace(
        '"observability": {',
        '"routes": ["production.example/*"],\n  "observability": {'
      )
    );
    await assert.rejects(
      prepareContinuationPreview({
        ...baseOptions(join(parent, 'drifted')),
        sourceConfig: driftedConfig,
      }),
      /topology changed/u
    );
  });

  it('runs as a no-network CLI without printing generated credentials', async () => {
    const parent = await temporaryDirectory();
    const output = join(parent, 'cli-bundle');
    const executable = resolve('node_modules/.bin/tsx');
    const script = resolve('scripts/prepare-continuation-preview.ts');
    const result = await execFileAsync(
      executable,
      [
        script,
        '--',
        '--output',
        output,
        '--worker-name',
        'ptcgsim-v2-continuation-preview-cli',
        '--build-id',
        'preview-cli',
        '--key-id',
        'preview-cli-key',
        '--quota-shards',
        '2',
        '--quota-leases-per-shard',
        '3',
        '--rate-namespace-base',
        '260905101',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /Prepared default-off continuation preview/u);
    assert.match(result.stdout, /No Cloudflare command was run/u);
    assert.equal(result.stdout.includes('CONTINUATION_KEYRING'), false);
    const credentials = await readJson(
      join(output, CONTINUATION_PREVIEW_CREDENTIALS_FILE)
    );
    const keyring = JSON.parse(credentials.CONTINUATION_KEYRING as string) as {
      keys: { material: string }[];
    };
    assert.equal(result.stdout.includes(keyring.keys[0]!.material), false);
  });
});
