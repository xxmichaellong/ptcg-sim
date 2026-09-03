import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MARKER = 'PTCGSIM_PERFORMANCE_REPORT=';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(serverRoot, '../..');
const outputArgumentIndex = process.argv.indexOf('--output');
const outputPath = path.resolve(
  repositoryRoot,
  outputArgumentIndex === -1
    ? 'artifacts/performance/server-local.json'
    : (process.argv[outputArgumentIndex + 1] ?? '')
);

if (outputArgumentIndex !== -1 && !process.argv[outputArgumentIndex + 1]) {
  throw new Error('--output requires a path');
}

const run = spawnSync(
  'corepack',
  ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.measure.config.ts'],
  {
    cwd: serverRoot,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    maxBuffer: 16 * 1024 * 1024,
  }
);

process.stdout.write(run.stdout ?? '');
process.stderr.write(run.stderr ?? '');
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status ?? 1);

const markerIndex = run.stdout.lastIndexOf(MARKER);
if (markerIndex === -1) {
  throw new Error('Vitest completed without a performance report marker');
}
const jsonStart = markerIndex + MARKER.length;
const jsonEnd = run.stdout.indexOf('\n', jsonStart);
const runtimeReport = JSON.parse(
  run.stdout.slice(jsonStart, jsonEnd === -1 ? undefined : jsonEnd)
);
if (runtimeReport.schema !== 'ptcgsim-runtime-performance-v1') {
  throw new Error('Runtime performance report has an unsupported schema');
}

const cpus = os.cpus();
const packageVersion = async (manifestPath, packageName) => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.name !== packageName || typeof manifest.version !== 'string') {
    throw new Error(`${packageName} does not expose a valid package version`);
  }
  return manifest.version;
};
const artifact = {
  ...runtimeReport,
  recordedAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    cpuModel: cpus[0]?.model ?? 'unknown',
    logicalCpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
  },
  tooling: {
    vitest: await packageVersion(
      path.join(repositoryRoot, 'node_modules/vitest/package.json'),
      'vitest'
    ),
    cloudflareVitestPlugin: await packageVersion(
      path.join(
        serverRoot,
        'node_modules/@cloudflare/vitest-plugin/package.json'
      ),
      '@cloudflare/vitest-plugin'
    ),
    wrangler: await packageVersion(
      path.join(serverRoot, 'node_modules/wrangler/package.json'),
      'wrangler'
    ),
  },
};

await mkdir(path.dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`);
await rename(temporaryPath, outputPath);
console.log(
  `Performance artifact: ${path.relative(repositoryRoot, outputPath)}`
);
