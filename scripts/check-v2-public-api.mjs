import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

export const PUBLIC_API_SCHEMA = 'ptcgsim-public-api-v1';
export const PUBLIC_API_REPORT = 'docs/v2-rebuild/PUBLIC_API_SURFACE.json';

const normalizePath = (value) => value.split(sep).join('/');
const repoRelative = (repoRoot, value) =>
  normalizePath(relative(repoRoot, value));
const isInside = (candidate, parent) => {
  const child = relative(parent, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`));
};

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const workspaceRoots = async (repoRoot) => {
  const roots = [];
  for (const collection of ['apps', 'packages']) {
    const collectionRoot = join(repoRoot, collection);
    for (const entry of await readdir(collectionRoot, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const root = join(collectionRoot, entry.name);
      try {
        if (!(await stat(join(root, 'package.json'))).isFile()) continue;
      } catch {
        continue;
      }
      roots.push(root);
    }
  }
  return roots.sort();
};

const exportMappings = (manifest, manifestPath) => {
  if (manifest.exports === undefined) return [];
  if (
    typeof manifest.exports !== 'object' ||
    manifest.exports === null ||
    Array.isArray(manifest.exports)
  ) {
    throw new Error(`${manifestPath} has an unsupported exports declaration`);
  }
  const mappings = Object.entries(manifest.exports);
  if (mappings.some(([subpath]) => !subpath.startsWith('.'))) {
    throw new Error(`${manifestPath} exports must use explicit subpaths`);
  }
  return mappings.sort(([left], [right]) => left.localeCompare(right));
};

const sourceTarget = (declaration, label) => {
  if (typeof declaration === 'string') return declaration;
  if (
    typeof declaration !== 'object' ||
    declaration === null ||
    Array.isArray(declaration)
  ) {
    throw new Error(`${label} has an unsupported conditional export`);
  }
  const targets = Object.values(declaration);
  if (
    targets.length === 0 ||
    targets.some((target) => typeof target !== 'string')
  ) {
    throw new Error(`${label} export conditions must be string targets`);
  }
  const selected =
    declaration.types ?? declaration.import ?? declaration.default;
  if (typeof selected !== 'string') {
    throw new Error(`${label} has no types, import, or default source target`);
  }
  if (targets.some((target) => target !== selected)) {
    throw new Error(`${label} export conditions resolve to different sources`);
  }
  return selected;
};

const symbolKind = (checker, symbol) => {
  let target = symbol;
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    target = checker.getAliasedSymbol(symbol);
  }
  const isType = (target.flags & ts.SymbolFlags.Type) !== 0;
  const isValue = (target.flags & ts.SymbolFlags.Value) !== 0;
  if (isType && isValue) return 'type-value';
  if (isType) return 'type';
  if (isValue) return 'value';
  return 'namespace';
};

const compilerOptions = async (repoRoot) => {
  const configPath = join(repoRoot, 'tsconfig.base.json');
  const config = await readJson(configPath);
  const converted = ts.convertCompilerOptionsFromJson(
    config.compilerOptions ?? {},
    repoRoot,
    configPath
  );
  if (converted.errors.length > 0) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(converted.errors, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => repoRoot,
        getNewLine: () => '\n',
      })
    );
  }
  return {
    ...converted.options,
    composite: false,
    declaration: false,
    declarationMap: false,
    incremental: false,
    jsx: ts.JsxEmit.ReactJSX,
    noEmit: true,
  };
};

export const buildPublicApiReport = async (repoRoot) => {
  const packages = [];
  const entrypoints = [];
  for (const root of await workspaceRoots(repoRoot)) {
    const manifestPath = join(root, 'package.json');
    const manifest = await readJson(manifestPath);
    if (typeof manifest.name !== 'string') {
      throw new Error(`${repoRelative(repoRoot, manifestPath)} has no name`);
    }
    const mappings = exportMappings(
      manifest,
      repoRelative(repoRoot, manifestPath)
    );
    if (mappings.length === 0) continue;
    const packageEntryPoints = [];
    for (const [subpath, declaration] of mappings) {
      const label = `${manifest.name} ${subpath}`;
      const target = sourceTarget(declaration, label);
      if (!target.startsWith('./')) {
        throw new Error(`${label} target must be package-relative`);
      }
      const absolute = resolve(root, target);
      if (!isInside(absolute, root)) {
        throw new Error(`${label} target escapes its package`);
      }
      if (!/\.(?:[cm]?ts|tsx)$/u.test(absolute)) {
        throw new Error(`${label} target must be TypeScript source`);
      }
      try {
        if (!(await stat(absolute)).isFile()) throw new Error('not a file');
      } catch {
        throw new Error(`${label} target does not exist: ${target}`);
      }
      const entrypoint = {
        packageName: manifest.name,
        subpath,
        source: repoRelative(repoRoot, absolute),
        absolute,
      };
      entrypoints.push(entrypoint);
      packageEntryPoints.push(entrypoint);
    }
    packages.push({
      name: manifest.name,
      root: repoRelative(repoRoot, root),
      entrypoints: packageEntryPoints,
    });
  }

  const program = ts.createProgram({
    rootNames: entrypoints.map((entrypoint) => entrypoint.absolute),
    options: await compilerOptions(repoRoot),
  });
  const checker = program.getTypeChecker();
  const reportsBySource = new Map();
  for (const entrypoint of entrypoints) {
    const sourceFile = program.getSourceFile(entrypoint.absolute);
    if (!sourceFile) throw new Error(`Could not load ${entrypoint.source}`);
    const diagnostics = program.getSemanticDiagnostics(sourceFile);
    if (diagnostics.length > 0) {
      throw new Error(
        `Could not inspect ${entrypoint.source}:\n${ts.formatDiagnosticsWithColorAndContext(
          diagnostics,
          {
            getCanonicalFileName: (fileName) => fileName,
            getCurrentDirectory: () => repoRoot,
            getNewLine: () => '\n',
          }
        )}`
      );
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol)
      throw new Error(`Could not inspect ${entrypoint.source}`);
    const symbols = checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => ({
        name: symbol.getName(),
        kind: symbolKind(checker, symbol),
      }))
      .sort((left, right) =>
        left.name === right.name
          ? left.kind.localeCompare(right.kind)
          : left.name.localeCompare(right.name)
      );
    reportsBySource.set(entrypoint.absolute, symbols);
  }

  return {
    schema: PUBLIC_API_SCHEMA,
    packages: packages
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((workspacePackage) => ({
        package: workspacePackage.name,
        root: workspacePackage.root,
        entrypoints: workspacePackage.entrypoints.map((entrypoint) => ({
          subpath: entrypoint.subpath,
          source: entrypoint.source,
          symbols: reportsBySource.get(entrypoint.absolute) ?? [],
        })),
      })),
  };
};

const reportItems = (report) => {
  const items = new Set();
  for (const workspacePackage of report.packages ?? []) {
    for (const entrypoint of workspacePackage.entrypoints ?? []) {
      items.add(
        `entrypoint ${workspacePackage.package} ${entrypoint.subpath} ${entrypoint.source}`
      );
      for (const symbol of entrypoint.symbols ?? []) {
        items.add(
          `symbol ${workspacePackage.package} ${entrypoint.subpath} ${symbol.kind} ${symbol.name}`
        );
      }
    }
  }
  return items;
};

const driftMessage = (expected, actual) => {
  const expectedItems = reportItems(expected);
  const actualItems = reportItems(actual);
  const unexpected = [...actualItems]
    .filter((item) => !expectedItems.has(item))
    .sort();
  const missing = [...expectedItems]
    .filter((item) => !actualItems.has(item))
    .sort();
  const detail = [
    ...unexpected.map((item) => `  unexpected: ${item}`),
    ...missing.map((item) => `  missing: ${item}`),
  ];
  if (detail.length === 0) detail.push('  report metadata changed');
  return [
    'V2 public API surface drifted:',
    ...detail,
    'Run `node scripts/check-v2-public-api.mjs --write` only after reviewing the API change.',
  ].join('\n');
};

export const checkPublicApiSurface = async (
  repoRoot,
  reportPath = join(repoRoot, PUBLIC_API_REPORT)
) => {
  let expected;
  try {
    expected = await readJson(reportPath);
  } catch {
    throw new Error(
      `Missing or invalid public API report: ${PUBLIC_API_REPORT}`
    );
  }
  const actual = await buildPublicApiReport(repoRoot);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(driftMessage(expected, actual));
  }
  const symbolCount = actual.packages.reduce(
    (total, workspacePackage) =>
      total +
      workspacePackage.entrypoints.reduce(
        (entrypointTotal, entrypoint) =>
          entrypointTotal + entrypoint.symbols.length,
        0
      ),
    0
  );
  return { packageCount: actual.packages.length, symbolCount };
};

export const writePublicApiSurface = async (
  repoRoot,
  reportPath = join(repoRoot, PUBLIC_API_REPORT)
) => {
  const report = await buildPublicApiReport(repoRoot);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
};

const parseArguments = (arguments_) => {
  let report;
  let root;
  let write = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--write') {
      write = true;
      continue;
    }
    if (argument === '--root') {
      root = arguments_[index + 1];
      if (!root) throw new Error('--root requires a path');
      index += 1;
      continue;
    }
    if (argument === '--report') {
      report = arguments_[index + 1];
      if (!report) throw new Error('--report requires a path');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { report, root, write };
};

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const repoRoot = resolve(arguments_.root ?? defaultRoot);
    const reportPath = resolve(
      arguments_.report ?? join(repoRoot, PUBLIC_API_REPORT)
    );
    if (arguments_.write) {
      const report = await writePublicApiSurface(repoRoot, reportPath);
      process.stdout.write(
        `Wrote ${repoRelative(repoRoot, reportPath)} (${report.packages.length} packages).\n`
      );
    } else {
      const result = await checkPublicApiSurface(repoRoot, reportPath);
      process.stdout.write(
        `V2 public API surface passed (${result.packageCount} packages, ${result.symbolCount} symbols).\n`
      );
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
