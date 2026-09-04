import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const CARD_BACK = Object.freeze({
  relativePath: 'v2/assets/cardback.png',
  bytes: 1_065_955,
  sha256: '44a5ffdcd9df23d3322250da733099c2c29c984362260efc5914a5a8745fa327',
  width: 736,
  height: 1024,
  bitDepth: 8,
  colorType: 6,
  interlace: 0,
});

const WEB_ALLOWED_GAME_CORE_SOURCES = new Set([
  'packages/game-core/src/ids.ts',
  'packages/game-core/src/stable-hash.ts',
]);

const SOURCE_FREE_WEB_RUNTIME_DIGESTS = new Set([
  // Vite 8/Rolldown emits this source-free interop helper without a source map.
  // Any toolchain change must be audited before its replacement is admitted.
  'bbf7c5086ae414dc3f33777e3eebf16ea8631325b8bb4690d25091c03567f31a',
]);

const normalizePath = (value) => value.split(sep).join('/');
const repoRelative = (repoRoot, value) =>
  normalizePath(relative(repoRoot, value));
const isInside = (candidate, parent) => {
  const child = relative(parent, candidate);
  return (
    child === '' || (!child.startsWith('..') && !child.includes(`..${sep}`))
  );
};

const walkFiles = async (root) => {
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  return files.sort();
};

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const workspacePackages = async (repoRoot) => {
  const packages = [];
  for (const collection of ['apps', 'packages']) {
    const collectionRoot = join(repoRoot, collection);
    for (const entry of await readdir(collectionRoot, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const root = join(collectionRoot, entry.name);
      const manifest = await readJson(join(root, 'package.json'));
      if (typeof manifest.name !== 'string') {
        throw new Error(`${repoRelative(repoRoot, root)} has no package name`);
      }
      packages.push({
        name: manifest.name,
        root,
        dependencies: new Set(Object.keys(manifest.dependencies ?? {})),
      });
    }
  }
  return packages;
};

const importedSpecifiers = (path, sourceText) => {
  const scriptKind = path.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
  const imports = [];
  let computedDynamicImports = 0;
  const addStringLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) imports.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument))
        imports.push(argument.text);
      else computedDynamicImports += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { imports, computedDynamicImports };
};

const cycleInGraph = (graph) => {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const visit = (name) => {
    if (visiting.has(name)) {
      const start = stack.indexOf(name);
      return [...stack.slice(start), name];
    }
    if (visited.has(name)) return undefined;
    visiting.add(name);
    stack.push(name);
    for (const dependency of graph.get(name) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(name);
    visited.add(name);
    return undefined;
  };
  for (const name of graph.keys()) {
    const cycle = visit(name);
    if (cycle) return cycle;
  }
  return undefined;
};

export const checkSourceBoundaries = async (repoRoot) => {
  const workspaces = await workspacePackages(repoRoot);
  const byName = new Map(
    workspaces.map((workspace) => [workspace.name, workspace])
  );
  const graph = new Map(
    workspaces.map((workspace) => [workspace.name, new Set()])
  );
  const legacyRoots = [join(repoRoot, 'client'), join(repoRoot, 'server')];
  const failures = [];

  for (const workspace of workspaces) {
    const sourceRoot = join(workspace.root, 'src');
    const files = (await walkFiles(sourceRoot)).filter(
      (path) => /\.tsx?$/u.test(path) && !/\.(?:test|spec)\.tsx?$/u.test(path)
    );
    for (const file of files) {
      const importer = repoRelative(repoRoot, file);
      const parsedImports = importedSpecifiers(
        file,
        await readFile(file, 'utf8')
      );
      if (parsedImports.computedDynamicImports > 0) {
        failures.push(
          `${importer} contains ${parsedImports.computedDynamicImports} computed dynamic import(s)`
        );
      }
      for (const specifier of parsedImports.imports) {
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);
          if (legacyRoots.some((legacyRoot) => isInside(target, legacyRoot))) {
            failures.push(`${importer} imports legacy source ${specifier}`);
          }
          const targetWorkspace = workspaces.find((candidate) =>
            isInside(target, candidate.root)
          );
          if (targetWorkspace && targetWorkspace !== workspace) {
            failures.push(
              `${importer} bypasses ${targetWorkspace.name}'s public export with ${specifier}`
            );
          }
          continue;
        }
        if (/^(?:client|server)(?:\/|$)/u.test(specifier)) {
          failures.push(`${importer} imports legacy source ${specifier}`);
          continue;
        }
        const dependencyName = [...byName.keys()].find(
          (name) => specifier === name || specifier.startsWith(`${name}/`)
        );
        if (!dependencyName) continue;
        if (specifier !== dependencyName) {
          failures.push(
            `${importer} deep-imports ${specifier}; use ${dependencyName}'s public export`
          );
        }
        if (dependencyName === workspace.name) continue;
        if (!workspace.dependencies.has(dependencyName)) {
          failures.push(
            `${importer} imports undeclared workspace dependency ${dependencyName}`
          );
        }
        graph.get(workspace.name)?.add(dependencyName);
      }
    }
  }

  const cycle = cycleInGraph(graph);
  if (cycle) failures.push(`workspace source cycle: ${cycle.join(' -> ')}`);
  if (failures.length > 0) {
    throw new Error(
      `V2 source boundary check failed:\n- ${failures.join('\n- ')}`
    );
  }
  return {
    files: workspaces.length,
    edges: [...graph.values()].reduce((n, edges) => n + edges.size, 0),
  };
};

const internalSourcePath = (repoRoot, mapPath, sourceRoot, source) => {
  if (/^[a-z][a-z+.-]*:/iu.test(source)) {
    const sourceUrl = new URL(source);
    if (sourceUrl.protocol !== 'file:') return undefined;
    const resolved = fileURLToPath(sourceUrl);
    return isInside(resolved, repoRoot)
      ? repoRelative(repoRoot, resolved)
      : undefined;
  }
  if (/^[a-z][a-z+.-]*:/iu.test(sourceRoot)) {
    const sourceRootUrl = new URL(
      sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`,
      pathToFileURL(`${dirname(mapPath)}${sep}`)
    );
    const sourceUrl = new URL(source, sourceRootUrl);
    if (sourceUrl.protocol !== 'file:') return undefined;
    const resolved = fileURLToPath(sourceUrl);
    return isInside(resolved, repoRoot)
      ? repoRelative(repoRoot, resolved)
      : undefined;
  }
  const mapDirectory = dirname(mapPath);
  const normalizedSourceRoot = normalizePath(sourceRoot).replace(/\/$/u, '');
  const normalizedMapDirectory = repoRelative(repoRoot, mapDirectory);
  const sourceRootAlreadyApplied =
    normalizedSourceRoot !== '' &&
    (normalizedMapDirectory === normalizedSourceRoot ||
      normalizedMapDirectory.endsWith(`/${normalizedSourceRoot}`));
  const combined =
    normalizedSourceRoot && !sourceRootAlreadyApplied
      ? join(normalizedSourceRoot, source)
      : source;
  const resolved = resolve(mapDirectory, combined);
  if (!isInside(resolved, repoRoot)) return undefined;
  const path = repoRelative(repoRoot, resolved);
  if (path.startsWith('node_modules/')) return undefined;
  return path;
};

const allowedBundleSource = (kind, source) => {
  if (source.startsWith('client/') || source.startsWith('server/'))
    return false;
  if (kind === 'web') {
    return (
      source.startsWith('apps/web/src/') ||
      source.startsWith('packages/client-session/src/') ||
      source.startsWith('packages/protocol/src/') ||
      source.startsWith('packages/renderer-contract/src/') ||
      source.startsWith('packages/renderer-dom/src/') ||
      source.startsWith('packages/renderer-pixi/src/') ||
      WEB_ALLOWED_GAME_CORE_SOURCES.has(source)
    );
  }
  return (
    source.startsWith('apps/server/src/') ||
    source.startsWith('packages/game-core/src/') ||
    source.startsWith('packages/protocol/src/') ||
    source.startsWith('packages/room-authority/src/')
  );
};

const isSourceFreeModuleFacade = (path, sourceText, emittedFiles) => {
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  if ((sourceFile.parseDiagnostics ?? []).length > 0) return false;
  return sourceFile.statements.every((statement) => {
    if (
      !ts.isImportDeclaration(statement) &&
      !ts.isExportDeclaration(statement)
    ) {
      return false;
    }
    if (!statement.moduleSpecifier) return ts.isExportDeclaration(statement);
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) return false;
    const specifier = statement.moduleSpecifier.text;
    return (
      specifier.startsWith('.') &&
      emittedFiles.has(resolve(dirname(path), specifier))
    );
  });
};

const checkJavaScriptSourceMaps = async (repoRoot, kind, files, failures) => {
  const emittedFiles = new Set(files);
  for (const path of files.filter((candidate) => candidate.endsWith('.js'))) {
    try {
      const sourceMap = await stat(`${path}.map`);
      if (sourceMap.isFile()) continue;
    } catch {
      // Vite emits source-free facade chunks and one audited Rolldown runtime
      // helper without maps. They contain no repository-authored provenance.
    }
    const bytes = await readFile(path);
    const sourceText = bytes.toString('utf8');
    const sourceFreeFacade =
      kind === 'web' &&
      isSourceFreeModuleFacade(path, sourceText, emittedFiles);
    const sourceFreeRuntime =
      kind === 'web' &&
      basename(path).startsWith('rolldown-runtime-') &&
      SOURCE_FREE_WEB_RUNTIME_DIGESTS.has(
        createHash('sha256').update(bytes).digest('hex')
      );
    if (!sourceFreeFacade && !sourceFreeRuntime) {
      failures.push(`${repoRelative(repoRoot, path)} has no source map`);
    }
  }
};

export const checkBundleProvenance = async (repoRoot, kind, distRoot) => {
  let files;
  try {
    files = await walkFiles(distRoot);
  } catch (error) {
    throw new Error(
      `${kind} bundle directory is missing: ${repoRelative(repoRoot, distRoot)}`,
      {
        cause: error,
      }
    );
  }
  const maps = files.filter((path) => path.endsWith('.map'));
  if (maps.length === 0) throw new Error(`${kind} bundle has no source maps`);
  const failures = [];
  await checkJavaScriptSourceMaps(repoRoot, kind, files, failures);
  let internalSources = 0;
  for (const mapPath of maps) {
    let sourceMap;
    try {
      sourceMap = await readJson(mapPath);
    } catch (error) {
      failures.push(
        `${repoRelative(repoRoot, mapPath)} is not valid JSON: ${String(error)}`
      );
      continue;
    }
    if (sourceMap.version !== 3 || !Array.isArray(sourceMap.sources)) {
      failures.push(
        `${repoRelative(repoRoot, mapPath)} is not a version 3 source map`
      );
      continue;
    }
    for (const source of sourceMap.sources) {
      if (typeof source !== 'string') {
        failures.push(
          `${repoRelative(repoRoot, mapPath)} has a non-string source`
        );
        continue;
      }
      const internal = internalSourcePath(
        repoRoot,
        mapPath,
        typeof sourceMap.sourceRoot === 'string' ? sourceMap.sourceRoot : '',
        source
      );
      if (!internal) continue;
      internalSources += 1;
      if (!allowedBundleSource(kind, internal)) {
        failures.push(
          `${repoRelative(repoRoot, mapPath)} contains ${internal}`
        );
      }
    }
  }
  if (internalSources === 0)
    failures.push(`${kind} source maps contain no repository sources`);
  if (failures.length > 0) {
    throw new Error(
      `${kind} bundle provenance check failed:\n- ${failures.join('\n- ')}`
    );
  }
  return { maps: maps.length, internalSources };
};

const assertCardBack = (path, bytes) => {
  const digest = createHash('sha256').update(bytes).digest('hex');
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    bytes.length !== CARD_BACK.bytes ||
    digest !== CARD_BACK.sha256 ||
    !bytes.subarray(0, 8).equals(pngSignature) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR' ||
    bytes.readUInt32BE(16) !== CARD_BACK.width ||
    bytes.readUInt32BE(20) !== CARD_BACK.height ||
    bytes[24] !== CARD_BACK.bitDepth ||
    bytes[25] !== CARD_BACK.colorType ||
    bytes[28] !== CARD_BACK.interlace
  ) {
    throw new Error(`${path} does not match the canonical card-back asset`);
  }
};

export const checkCardBackAssets = async (repoRoot, includeDist = false) => {
  const canonicalPath = join(repoRoot, 'client/src/assets/cardback.png');
  const publicPath = join(repoRoot, 'apps/web/public', CARD_BACK.relativePath);
  const canonical = await readFile(canonicalPath);
  const published = await readFile(publicPath);
  assertCardBack(repoRelative(repoRoot, canonicalPath), canonical);
  assertCardBack(repoRelative(repoRoot, publicPath), published);
  if (!canonical.equals(published)) {
    throw new Error(
      'The v2 card-back asset differs from the canonical legacy asset'
    );
  }
  if (includeDist) {
    const distPath = join(repoRoot, 'apps/web/dist', CARD_BACK.relativePath);
    const emitted = await readFile(distPath);
    assertCardBack(repoRelative(repoRoot, distPath), emitted);
    if (!canonical.equals(emitted)) {
      throw new Error(
        'The built v2 card-back asset differs from its canonical source'
      );
    }
  }
};

export const checkForTestFixtureLeaks = async (repoRoot) => {
  const distRoot = join(repoRoot, 'apps/web/dist');
  const forbidden = ['__ptcgsim-test-assets__', 'ptcgsim-renderer-cache-v1'];
  const failures = [];
  for (const path of await walkFiles(distRoot)) {
    const outputPath = repoRelative(repoRoot, path);
    for (const marker of forbidden) {
      if (outputPath.includes(marker)) {
        failures.push(`${outputPath} contains ${marker} in its output path`);
      }
    }
    if (!/\.(?:css|html|js|json|map)$/u.test(path)) continue;
    const text = await readFile(path, 'utf8');
    for (const marker of forbidden) {
      if (text.includes(marker)) {
        failures.push(`${outputPath} contains ${marker}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `V2 test fixture leaked into the production build:\n- ${failures.join('\n- ')}`
    );
  }
};

export const runSourceChecks = async (repoRoot) => {
  const graph = await checkSourceBoundaries(repoRoot);
  await checkCardBackAssets(repoRoot);
  return graph;
};

export const runBundleChecks = async (repoRoot) => {
  await stat(join(repoRoot, 'apps/web/dist/index.html'));
  const web = await checkBundleProvenance(
    repoRoot,
    'web',
    join(repoRoot, 'apps/web/dist')
  );
  const server = await checkBundleProvenance(
    repoRoot,
    'server',
    join(repoRoot, 'apps/server/dist')
  );
  await checkCardBackAssets(repoRoot, true);
  await checkForTestFixtureLeaks(repoRoot);
  return { web, server };
};

const currentPath = fileURLToPath(import.meta.url);
if (process.argv[1] && currentPath === resolve(process.argv[1])) {
  const repoRoot = resolve(dirname(currentPath), '..');
  const mode = process.argv[2];
  if (mode === '--source') {
    const result = await runSourceChecks(repoRoot);
    process.stdout.write(
      `V2 source boundaries passed (${result.files} workspaces, ${result.edges} edges).\n`
    );
  } else if (mode === '--bundles') {
    const result = await runBundleChecks(repoRoot);
    process.stdout.write(
      `V2 bundle boundaries passed (${result.web.maps} web maps, ${result.server.maps} server maps).\n`
    );
  } else {
    throw new Error(
      'Usage: node scripts/check-v2-boundaries.mjs --source|--bundles'
    );
  }
}
