import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { afterEach } from 'node:test';

import {
  PUBLIC_API_REPORT,
  buildPublicApiReport,
  checkPublicApiSurface,
} from './check-v2-public-api.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

const writeFixture = async (root, path, contents) => {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
};

const temporaryRepo = async () => {
  const root = await mkdtemp(join(tmpdir(), 'ptcgsim-public-api-'));
  temporaryRoots.push(root);
  await writeFixture(
    root,
    'tsconfig.base.json',
    JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        target: 'ES2023',
      },
    })
  );
  await mkdir(join(root, 'apps'), { recursive: true });
  await writeFixture(
    root,
    'packages/example/package.json',
    JSON.stringify({
      name: '@ptcgsim/example',
      exports: {
        '.': { types: './src/index.ts', import: './src/index.ts' },
      },
    })
  );
  await writeFixture(
    root,
    'packages/example/src/index.ts',
    "export const alpha = 1; export interface Beta { readonly id: string; } export * from './View.js';\n"
  );
  await writeFixture(
    root,
    'packages/example/src/View.tsx',
    'export const View = () => null;\n'
  );
  const report = await buildPublicApiReport(root);
  await writeFixture(root, PUBLIC_API_REPORT, JSON.stringify(report, null, 2));
  return root;
};

test('accepts the exact reviewed workspace entrypoint surface', async () => {
  const root = await temporaryRepo();
  assert.deepEqual(await checkPublicApiSurface(root), {
    packageCount: 1,
    symbolCount: 3,
  });
  const report = JSON.parse(
    await readFile(join(root, PUBLIC_API_REPORT), 'utf8')
  );
  assert.deepEqual(report.packages[0].entrypoints[0].symbols, [
    { name: 'alpha', kind: 'value' },
    { name: 'Beta', kind: 'type' },
    { name: 'View', kind: 'value' },
  ]);
});

test('rejects an unexpected public symbol', async () => {
  const root = await temporaryRepo();
  await writeFixture(
    root,
    'packages/example/src/index.ts',
    'export const alpha = 1; export interface Beta { readonly id: string; } export const gamma = 3;\n'
  );
  await assert.rejects(
    checkPublicApiSurface(root),
    /unexpected: symbol @ptcgsim\/example \. value gamma/u
  );
});

test('rejects removal or kind changes from the reviewed surface', async () => {
  const root = await temporaryRepo();
  await writeFixture(
    root,
    'packages/example/src/index.ts',
    'export class Beta { readonly id = "changed"; }\n'
  );
  await assert.rejects(checkPublicApiSurface(root), (error) => {
    assert.match(
      error.message,
      /missing: symbol @ptcgsim\/example \. value alpha/u
    );
    assert.match(
      error.message,
      /missing: symbol @ptcgsim\/example \. type Beta/u
    );
    assert.match(
      error.message,
      /unexpected: symbol @ptcgsim\/example \. type-value Beta/u
    );
    return true;
  });
});

test('rejects a newly exposed workspace package', async () => {
  const root = await temporaryRepo();
  await writeFixture(
    root,
    'apps/new-public/package.json',
    JSON.stringify({
      name: '@ptcgsim/new-public',
      exports: { '.': './src/index.ts' },
    })
  );
  await writeFixture(
    root,
    'apps/new-public/src/index.ts',
    'export const exposed = true;\n'
  );
  await assert.rejects(
    checkPublicApiSurface(root),
    /unexpected: entrypoint @ptcgsim\/new-public \. apps\/new-public\/src\/index\.ts/u
  );
});

test('rejects ambiguous, missing, and escaping entrypoint targets', async () => {
  const root = await temporaryRepo();
  const manifestPath = join(root, 'packages/example/package.json');
  const writeManifest = (exports) =>
    writeFile(
      manifestPath,
      JSON.stringify({ name: '@ptcgsim/example', exports })
    );

  await writeManifest({
    '.': { types: './src/index.ts', import: './src/runtime.ts' },
  });
  await assert.rejects(
    buildPublicApiReport(root),
    /export conditions resolve to different sources/u
  );

  await writeManifest({ '.': './src/missing.ts' });
  await assert.rejects(buildPublicApiReport(root), /target does not exist/u);

  await writeManifest({ '.': './src/index.ts' });
  await writeFixture(
    root,
    'packages/example/src/index.ts',
    "export * from './missing-module.js';\n"
  );
  await assert.rejects(
    buildPublicApiReport(root),
    /Could not inspect packages\/example\/src\/index\.ts/u
  );

  await writeManifest({ '.': './../../outside.ts' });
  await assert.rejects(
    buildPublicApiReport(root),
    /target escapes its package/u
  );
});
