import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { parseContinuationHandoffText } from '../packages/protocol/src/index.js';

export const CONTINUATION_ROTATION_ARTIFACT_FORMAT =
  'ptcgsim-continuation-rotation-artifact-v1' as const;
export const CONTINUATION_ROTATION_PRIVATE_DIRECTORY = join(
  '.private',
  'continuation-rotation'
);
export const CONTINUATION_ROTATION_HANDOFF_FILE =
  'continuation-handoff.ptcgsave';
export const CONTINUATION_ROTATION_CHECKPOINT_FILE = 'checkpoint.json';

const MAXIMUM_HANDOFF_BYTES = 4 * 1024;
const MAXIMUM_CHECKPOINT_BYTES = 4 * 1024;
const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const REVISION_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

export interface ContinuationRotationCheckpoint {
  readonly matchId: string;
  readonly revision: string;
}

export interface ContinuationRotationArtifactManifest {
  readonly format: typeof CONTINUATION_ROTATION_ARTIFACT_FORMAT;
  readonly origin: string;
  readonly saveId: string;
  readonly savedAt: number;
  readonly expiresAt: number;
  readonly checkpoint: ContinuationRotationCheckpoint;
}

export interface ContinuationRotationArtifact {
  readonly directory: string;
  readonly handoffText: string;
  readonly manifest: ContinuationRotationArtifactManifest;
}

export interface WriteContinuationRotationArtifactOptions {
  readonly directory: string;
  readonly repositoryRoot: string;
  readonly origin: string;
  readonly handoffText: string;
  readonly checkpoint: ContinuationRotationCheckpoint;
  readonly savedAt?: number;
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

const isInside = (candidate: string, parent: string): boolean => {
  const child = relative(parent, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`));
};

export const assertContinuationRotationPrivateLocation = (
  directory: string,
  repositoryRoot: string
): void => {
  const output = resolve(directory);
  const repository = resolve(repositoryRoot);
  const privateRoot = join(repository, CONTINUATION_ROTATION_PRIVATE_DIRECTORY);
  if (
    isInside(output, repository) &&
    (!isInside(output, privateRoot) || output === privateRoot)
  ) {
    throw new Error(
      'In-repository rotation artifacts must be a child of .private/continuation-rotation'
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
      throw new Error('Rotation artifact paths cannot contain symbolic links');
    }
    if (!metadata.isDirectory() && cursor !== absolute) {
      throw new Error('Rotation artifact parent paths must be directories');
    }
  }
};

const canonicalOrigin = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Rotation preview URL must be an absolute HTTP(S) origin');
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new Error('Rotation preview URL must be an absolute HTTP(S) origin');
  }
  return url.origin;
};

const validCheckpoint = (
  value: unknown
): value is ContinuationRotationCheckpoint => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value, ['matchId', 'revision'])
  ) {
    return false;
  }
  const matchId = Reflect.get(value, 'matchId');
  const revision = Reflect.get(value, 'revision');
  return (
    typeof matchId === 'string' &&
    MATCH_ID_PATTERN.test(matchId) &&
    typeof revision === 'string' &&
    REVISION_PATTERN.test(revision) &&
    Number.isSafeInteger(Number(revision))
  );
};

const validTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const parseManifest = (
  value: unknown
): ContinuationRotationArtifactManifest => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value, [
      'checkpoint',
      'expiresAt',
      'format',
      'origin',
      'saveId',
      'savedAt',
    ]) ||
    Reflect.get(value, 'format') !== CONTINUATION_ROTATION_ARTIFACT_FORMAT ||
    typeof Reflect.get(value, 'origin') !== 'string' ||
    canonicalOrigin(Reflect.get(value, 'origin') as string) !==
      Reflect.get(value, 'origin') ||
    typeof Reflect.get(value, 'saveId') !== 'string' ||
    !/^[A-Za-z0-9_-]{22}$/u.test(Reflect.get(value, 'saveId') as string) ||
    !validTimestamp(Reflect.get(value, 'savedAt')) ||
    !validTimestamp(Reflect.get(value, 'expiresAt')) ||
    (Reflect.get(value, 'expiresAt') as number) <=
      (Reflect.get(value, 'savedAt') as number) ||
    !validCheckpoint(Reflect.get(value, 'checkpoint'))
  ) {
    throw new Error('Rotation checkpoint manifest is invalid');
  }
  return value as ContinuationRotationArtifactManifest;
};

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
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
};

const readPrivateFile = async (
  path: string,
  maximumBytes: number
): Promise<string> => {
  await assertExistingPathHasNoSymbolicLinks(path);
  const metadata = await lstat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error('Rotation artifact files must be private regular files');
  }
  if (metadata.size > maximumBytes) {
    throw new Error('Rotation artifact file exceeds its byte bound');
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = await handle.readFile();
    if (bytes.byteLength !== metadata.size) {
      bytes.fill(0);
      throw new Error('Rotation artifact changed while being read');
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('Rotation artifact must contain valid UTF-8');
    } finally {
      bytes.fill(0);
    }
  } finally {
    await handle.close();
  }
};

export const prepareContinuationRotationArtifactDirectory = async (
  directory: string,
  repositoryRoot: string
): Promise<string> => {
  const output = resolve(directory);
  assertContinuationRotationPrivateLocation(output, repositoryRoot);
  await assertExistingPathHasNoSymbolicLinks(dirname(output));
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await assertExistingPathHasNoSymbolicLinks(dirname(output));
  await mkdir(output, { mode: 0o700 });
  await chmod(output, 0o700);
  return output;
};

export const writeContinuationRotationArtifact = async (
  options: WriteContinuationRotationArtifactOptions
): Promise<ContinuationRotationArtifact> => {
  const directory = resolve(options.directory);
  assertContinuationRotationPrivateLocation(directory, options.repositoryRoot);
  await assertExistingPathHasNoSymbolicLinks(directory);
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0) {
    throw new Error('Rotation artifact directory must be private');
  }
  if ((await readdir(directory)).length !== 0) {
    throw new Error('Prepared rotation artifact directory must be empty');
  }

  const handoff = parseContinuationHandoffText(options.handoffText);
  const savedAt = options.savedAt ?? Date.now();
  if (
    !handoff.ok ||
    !validTimestamp(savedAt) ||
    handoff.value.expiresAt <= savedAt ||
    !validCheckpoint(options.checkpoint)
  ) {
    throw new Error('Rotation handoff or checkpoint is invalid');
  }
  const manifest = parseManifest({
    format: CONTINUATION_ROTATION_ARTIFACT_FORMAT,
    origin: canonicalOrigin(options.origin),
    saveId: handoff.value.saveId,
    savedAt,
    expiresAt: handoff.value.expiresAt,
    checkpoint: options.checkpoint,
  });
  const temporaryHandoff = join(directory, '.continuation-handoff.tmp');
  const temporaryCheckpoint = join(directory, '.checkpoint.tmp');
  await writePrivateFile(temporaryHandoff, options.handoffText);
  await writePrivateFile(
    temporaryCheckpoint,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  await rename(
    temporaryHandoff,
    join(directory, CONTINUATION_ROTATION_HANDOFF_FILE)
  );
  await rename(
    temporaryCheckpoint,
    join(directory, CONTINUATION_ROTATION_CHECKPOINT_FILE)
  );
  return { directory, handoffText: options.handoffText, manifest };
};

export const readContinuationRotationArtifact = async (
  directory: string,
  repositoryRoot: string,
  expectedOrigin: string,
  now = Date.now()
): Promise<ContinuationRotationArtifact> => {
  const input = resolve(directory);
  assertContinuationRotationPrivateLocation(input, repositoryRoot);
  await assertExistingPathHasNoSymbolicLinks(input);
  const metadata = await lstat(input);
  if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0) {
    throw new Error('Rotation artifact directory must be private');
  }
  const names = (await readdir(input)).sort(compareStrings);
  if (
    JSON.stringify(names) !==
    JSON.stringify(
      [
        CONTINUATION_ROTATION_CHECKPOINT_FILE,
        CONTINUATION_ROTATION_HANDOFF_FILE,
      ].sort(compareStrings)
    )
  ) {
    throw new Error('Rotation artifact directory is incomplete');
  }
  const [handoffText, checkpointText] = await Promise.all([
    readPrivateFile(
      join(input, CONTINUATION_ROTATION_HANDOFF_FILE),
      MAXIMUM_HANDOFF_BYTES
    ),
    readPrivateFile(
      join(input, CONTINUATION_ROTATION_CHECKPOINT_FILE),
      MAXIMUM_CHECKPOINT_BYTES
    ),
  ]);
  const handoff = parseContinuationHandoffText(handoffText);
  let decodedManifest: unknown;
  try {
    decodedManifest = JSON.parse(checkpointText) as unknown;
  } catch {
    throw new Error('Rotation checkpoint manifest is invalid');
  }
  const manifest = parseManifest(decodedManifest);
  if (
    !handoff.ok ||
    handoff.value.saveId !== manifest.saveId ||
    handoff.value.expiresAt !== manifest.expiresAt
  ) {
    throw new Error('Rotation handoff does not match its checkpoint');
  }
  if (manifest.origin !== canonicalOrigin(expectedOrigin)) {
    throw new Error('Rotation artifact belongs to a different preview origin');
  }
  if (!validTimestamp(now) || now >= manifest.expiresAt) {
    throw new Error('Rotation artifact has expired');
  }
  return { directory: input, handoffText, manifest };
};
