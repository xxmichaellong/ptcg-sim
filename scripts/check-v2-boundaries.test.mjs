import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  checkBundleProvenance,
  checkForTestFixtureLeaks,
  checkSourceBoundaries,
} from './check-v2-boundaries.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

const temporaryRepo = async () => {
  const root = await mkdtemp(join(tmpdir(), 'ptcgsim-boundaries-'));
  temporaryRoots.push(root);
  await Promise.all([mkdir(join(root, 'apps')), mkdir(join(root, 'packages'))]);
  return root;
};

const addWorkspace = async (root, collection, directory, manifest, source) => {
  const workspaceRoot = join(root, collection, directory);
  await mkdir(join(workspaceRoot, 'src'), { recursive: true });
  await writeFile(
    join(workspaceRoot, 'package.json'),
    JSON.stringify({ private: true, ...manifest })
  );
  await writeFile(join(workspaceRoot, 'src/index.ts'), source);
  return workspaceRoot;
};

test('rejects production imports into the frozen legacy roots', async () => {
  const root = await temporaryRepo();
  await addWorkspace(
    root,
    'apps',
    'web',
    { name: '@ptcgsim/web' },
    "import '../../../client/legacy.js';"
  );
  await assert.rejects(checkSourceBoundaries(root), /imports legacy source/u);
});

test('rejects computed dynamic imports that cannot be boundary-resolved', async () => {
  const root = await temporaryRepo();
  await addWorkspace(
    root,
    'apps',
    'web',
    { name: '@ptcgsim/web' },
    "const target = '../../../client/legacy.js'; void import(target);"
  );
  await assert.rejects(checkSourceBoundaries(root), /computed dynamic import/u);
});

test('rejects workspace deep imports even when the dependency is declared', async () => {
  const root = await temporaryRepo();
  await addWorkspace(
    root,
    'apps',
    'web',
    {
      name: '@ptcgsim/web',
      dependencies: { '@ptcgsim/core': 'workspace:*' },
    },
    "import '@ptcgsim/core/src/private.js';"
  );
  await addWorkspace(
    root,
    'packages',
    'core',
    { name: '@ptcgsim/core' },
    'export const value = 1;'
  );
  await assert.rejects(checkSourceBoundaries(root), /deep-imports/u);
});

test('rejects every runtime dependency path to the quarantined legacy importer', async () => {
  for (const dependencySection of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const root = await temporaryRepo();
    await addWorkspace(
      root,
      'apps',
      'web',
      {
        name: '@ptcgsim/web',
        [dependencySection]: { '@ptcgsim/legacy-import': 'workspace:*' },
      },
      'export const productionRouteRemainsClosed = true;'
    );
    await addWorkspace(
      root,
      'packages',
      'legacy-import',
      { name: '@ptcgsim/legacy-import' },
      'export const convert = () => undefined;'
    );

    await assert.rejects(
      checkSourceBoundaries(root),
      new RegExp(
        `@ptcgsim/web declares quarantined runtime dependency @ptcgsim/legacy-import in ${dependencySection}`,
        'u'
      )
    );
  }
});

test('allows dev-only dependency declarations for isolated importer tests', async () => {
  const root = await temporaryRepo();
  await addWorkspace(
    root,
    'apps',
    'web',
    {
      name: '@ptcgsim/web',
      devDependencies: { '@ptcgsim/legacy-import': 'workspace:*' },
    },
    'export const productionRouteRemainsClosed = true;'
  );
  await addWorkspace(
    root,
    'packages',
    'legacy-import',
    { name: '@ptcgsim/legacy-import' },
    'export const convert = () => undefined;'
  );

  await assert.doesNotReject(checkSourceBoundaries(root));
});

test('rejects cycles in the imported workspace graph', async () => {
  const root = await temporaryRepo();
  await addWorkspace(
    root,
    'packages',
    'alpha',
    {
      name: '@ptcgsim/alpha',
      dependencies: { '@ptcgsim/beta': 'workspace:*' },
    },
    "import '@ptcgsim/beta';"
  );
  await addWorkspace(
    root,
    'packages',
    'beta',
    {
      name: '@ptcgsim/beta',
      dependencies: { '@ptcgsim/alpha': 'workspace:*' },
    },
    "import '@ptcgsim/alpha';"
  );
  await assert.rejects(checkSourceBoundaries(root), /workspace source cycle/u);
});

test('rejects server-authority provenance in a web source map', async () => {
  const root = await temporaryRepo();
  const dist = join(root, 'apps/web/dist');
  await mkdir(dist, { recursive: true });
  await writeFile(
    join(dist, 'chunk.js.map'),
    JSON.stringify({
      version: 3,
      sources: ['../../../packages/room-authority/src/coordinator.ts'],
      mappings: '',
    })
  );
  await assert.rejects(
    checkBundleProvenance(root, 'web', dist),
    /packages\/room-authority/u
  );
});

test('rejects developer-only modules in a production web source map', async () => {
  const root = await temporaryRepo();
  const dist = join(root, 'apps/web/dist');
  await mkdir(dist, { recursive: true });
  await writeFile(
    join(dist, 'chunk.js.map'),
    JSON.stringify({
      version: 3,
      sources: ['../../../apps/web/src/dev/DevRoomHost.tsx'],
      mappings: '',
    })
  );
  await assert.rejects(
    checkBundleProvenance(root, 'web', dist),
    /apps\/web\/src\/dev/u
  );
});

test('rejects quarantined legacy-import provenance from production bundles', async () => {
  for (const kind of ['web', 'server']) {
    const root = await temporaryRepo();
    const dist = join(root, `apps/${kind}/dist`);
    await mkdir(dist, { recursive: true });
    await writeFile(
      join(dist, 'chunk.js.map'),
      JSON.stringify({
        version: 3,
        sources: ['../../../packages/legacy-import/src/index.ts'],
        mappings: '',
      })
    );
    await assert.rejects(
      checkBundleProvenance(root, kind, dist),
      /packages\/legacy-import\/src\/index\.ts/u
    );
  }
});

test('fails closed when a bundle has no source maps', async () => {
  const root = await temporaryRepo();
  const dist = join(root, 'apps/web/dist');
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'chunk.js'), 'export {};');
  await assert.rejects(
    checkBundleProvenance(root, 'web', dist),
    /has no source maps/u
  );
});

test('rejects an unmapped executable chunk beside otherwise valid maps', async () => {
  const root = await temporaryRepo();
  const dist = join(root, 'apps/web/dist');
  await mkdir(dist, { recursive: true });
  await writeFile(
    join(dist, 'allowed.js.map'),
    JSON.stringify({
      version: 3,
      sources: ['../../../apps/web/src/main.ts'],
      mappings: '',
    })
  );
  await writeFile(
    join(dist, 'unmapped-malicious.js'),
    'globalThis.leaked = true;'
  );
  await assert.rejects(
    checkBundleProvenance(root, 'web', dist),
    /unmapped-malicious\.js has no source map/u
  );
});

test('rejects an unmapped facade that imports code outside the build', async () => {
  const root = await temporaryRepo();
  const dist = join(root, 'apps/web/dist');
  await mkdir(dist, { recursive: true });
  await writeFile(
    join(dist, 'allowed.js.map'),
    JSON.stringify({
      version: 3,
      sources: ['../../../apps/web/src/main.ts'],
      mappings: '',
    })
  );
  await writeFile(
    join(dist, 'unmapped-remote.js'),
    "import 'https://example.invalid/payload.js';"
  );
  await assert.rejects(
    checkBundleProvenance(root, 'web', dist),
    /unmapped-remote\.js has no source map/u
  );
});

test('rejects same-repository file URLs with forbidden web provenance', async () => {
  const root = await temporaryRepo();
  const dist = join(root, 'apps/web/dist');
  await mkdir(dist, { recursive: true });
  const authoritySource = join(
    root,
    'packages/room-authority/src/coordinator.ts'
  );
  await writeFile(
    join(dist, 'chunk.js.map'),
    JSON.stringify({
      version: 3,
      sources: [
        '../../../apps/web/src/main.ts',
        pathToFileURL(authoritySource).href,
      ],
      mappings: '',
    })
  );
  await assert.rejects(
    checkBundleProvenance(root, 'web', dist),
    /packages\/room-authority/u
  );
});

test('rejects forbidden fixture markers in binary output paths', async () => {
  const root = await temporaryRepo();
  const fixtureDirectory = join(root, 'apps/web/dist/__ptcgsim-test-assets__');
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(join(fixtureDirectory, 'secret.png'), Buffer.from([0, 1, 2]));
  await assert.rejects(
    checkForTestFixtureLeaks(root),
    /__ptcgsim-test-assets__.*output path/u
  );
});
