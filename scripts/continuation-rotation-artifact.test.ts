import assert from 'node:assert/strict';
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

import { serializeContinuationHandoffText } from '../packages/protocol/src/index.js';
import {
  CONTINUATION_ROTATION_ARTIFACT_FORMAT,
  CONTINUATION_ROTATION_CHECKPOINT_FILE,
  CONTINUATION_ROTATION_HANDOFF_FILE,
  assertContinuationRotationPrivateLocation,
  prepareContinuationRotationArtifactDirectory,
  readContinuationRotationArtifact,
  writeContinuationRotationArtifact,
} from './continuation-rotation-artifact.js';

const temporaryDirectories: string[] = [];
const repositoryRoot = resolve('.');
const origin = 'https://continuation-preview.example';
const saveId = 'A'.repeat(22);
const handoffText = serializeContinuationHandoffText({
  format: 'ptcgsim-continuation-handoff-v1',
  saveId,
  capability: `ptcgsave.v1.${saveId}.${'B'.repeat(43)}`,
  expiresAt: 2_000_000_100_000,
});
const checkpoint = { matchId: 'MATCHCODE123', revision: '7' } as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true }))
  );
});

const temporaryDirectory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), 'ptcgsim-continuation-rotation-'));
  temporaryDirectories.push(path);
  return path;
};

const createArtifact = async (directory: string) => {
  await prepareContinuationRotationArtifactDirectory(directory, repositoryRoot);
  return writeContinuationRotationArtifact({
    directory,
    repositoryRoot,
    origin,
    handoffText,
    checkpoint,
    savedAt: 2_000_000_000_000,
  });
};

describe('continuation rotation artifacts', () => {
  it('allows only the ignored private rotation root inside the repository', () => {
    assert.doesNotThrow(() =>
      assertContinuationRotationPrivateLocation(
        join(repositoryRoot, '.private', 'continuation-rotation', 'old-key'),
        repositoryRoot
      )
    );
    assert.throws(
      () =>
        assertContinuationRotationPrivateLocation(
          join(repositoryRoot, 'artifacts', 'rotation'),
          repositoryRoot
        ),
      /must be a child of \.private\/continuation-rotation/u
    );
    assert.throws(
      () =>
        assertContinuationRotationPrivateLocation(
          join(repositoryRoot, '.private', 'continuation-rotation'),
          repositoryRoot
        ),
      /must be a child/u
    );
  });

  it('writes and reads an exact private origin-bound artifact', async () => {
    const parent = await temporaryDirectory();
    const directory = join(parent, 'artifact');
    const written = await createArtifact(directory);

    assert.equal(
      written.manifest.format,
      CONTINUATION_ROTATION_ARTIFACT_FORMAT
    );
    assert.deepEqual(written.manifest.checkpoint, checkpoint);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal(
      (await stat(join(directory, CONTINUATION_ROTATION_HANDOFF_FILE))).mode &
        0o777,
      0o600
    );
    assert.equal(
      (await stat(join(directory, CONTINUATION_ROTATION_CHECKPOINT_FILE)))
        .mode & 0o777,
      0o600
    );
    const manifestText = await readFile(
      join(directory, CONTINUATION_ROTATION_CHECKPOINT_FILE),
      'utf8'
    );
    assert.equal(manifestText.includes('ptcgsave.v1'), false);
    assert.equal(manifestText.includes('BBBBBBBB'), false);

    const read = await readContinuationRotationArtifact(
      directory,
      repositoryRoot,
      `${origin}/`,
      2_000_000_050_000
    );
    assert.equal(read.handoffText, handoffText);
    assert.deepEqual(read.manifest, written.manifest);
  });

  it('refuses overwrite, incomplete directories, and symbolic-link paths', async () => {
    const parent = await temporaryDirectory();
    const directory = join(parent, 'artifact');
    await createArtifact(directory);
    await assert.rejects(
      prepareContinuationRotationArtifactDirectory(directory, repositoryRoot),
      /EEXIST/u
    );

    const incomplete = join(parent, 'incomplete');
    await mkdir(incomplete, { mode: 0o700 });
    await assert.rejects(
      readContinuationRotationArtifact(
        incomplete,
        repositoryRoot,
        origin,
        2_000_000_050_000
      ),
      /incomplete/u
    );

    const real = join(parent, 'real');
    const linked = join(parent, 'linked');
    await mkdir(real, { mode: 0o700 });
    await symlink(real, linked);
    await assert.rejects(
      prepareContinuationRotationArtifactDirectory(
        join(linked, 'artifact'),
        repositoryRoot
      ),
      /symbolic links/u
    );
  });

  it('rejects public permissions, origin changes, and expiry', async () => {
    const parent = await temporaryDirectory();
    const directory = join(parent, 'artifact');
    await createArtifact(directory);

    await assert.rejects(
      readContinuationRotationArtifact(
        directory,
        repositoryRoot,
        'https://other-preview.example',
        2_000_000_050_000
      ),
      /different preview origin/u
    );
    await assert.rejects(
      readContinuationRotationArtifact(
        directory,
        repositoryRoot,
        origin,
        2_000_000_100_000
      ),
      /expired/u
    );

    await chmod(join(directory, CONTINUATION_ROTATION_HANDOFF_FILE), 0o644);
    await assert.rejects(
      readContinuationRotationArtifact(
        directory,
        repositoryRoot,
        origin,
        2_000_000_050_000
      ),
      /private regular files/u
    );
  });

  it('rejects manifest and handoff drift without exposing bearer values', async () => {
    const parent = await temporaryDirectory();
    const directory = join(parent, 'artifact');
    await createArtifact(directory);
    const manifestPath = join(directory, CONTINUATION_ROTATION_CHECKPOINT_FILE);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >;
    manifest['saveId'] = 'C'.repeat(22);
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, {
      mode: 0o600,
    });
    await chmod(manifestPath, 0o600);

    let message = '';
    try {
      await readContinuationRotationArtifact(
        directory,
        repositoryRoot,
        origin,
        2_000_000_050_000
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.match(message, /does not match/u);
    assert.equal(message.includes('BBBBBBBB'), false);
    assert.equal(message.includes('ptcgsave.v1'), false);
  });
});
