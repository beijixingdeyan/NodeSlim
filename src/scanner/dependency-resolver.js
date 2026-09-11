'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function parsePackageJson(projectRoot) {
  const p = path.join(path.resolve(projectRoot), 'package.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function parseLockfile(projectRoot) {
  const root = path.resolve(projectRoot);
  // package-lock.json
  const pkgLock = path.join(root, 'package-lock.json');
  if (fs.existsSync(pkgLock)) {
    try {
      const j = JSON.parse(fs.readFileSync(pkgLock, 'utf-8'));
      return { type: 'npm', data: j, path: pkgLock };
    } catch {}
  }
  // pnpm-lock.yaml
  const pnpmLock = path.join(root, 'pnpm-lock.yaml');
  if (fs.existsSync(pnpmLock)) {
    try {
      const raw = fs.readFileSync(pnpmLock, 'utf-8');
      const y = yaml.load(raw);
      return { type: 'pnpm', data: y, path: pnpmLock };
    } catch {}
  }
  // yarn.lock
  const yarnLock = path.join(root, 'yarn.lock');
  if (fs.existsSync(yarnLock)) {
    try {
      const raw = fs.readFileSync(yarnLock, 'utf-8');
      return { type: 'yarn', data: raw, path: yarnLock };
    } catch {}
  }
  // bun.lockb (binary) -> not parsed, just detect
  const bunLock = path.join(root, 'bun.lockb');
  if (fs.existsSync(bunLock)) {
    return { type: 'bun', data: null, path: bunLock };
  }
  return null;
}

function buildDependencyTree(projectRoot, enrichedPackages) {
  const pkgJson = parsePackageJson(projectRoot);
  const lock = parseLockfile(projectRoot);

  const directDeps = new Set([
    ...Object.keys(pkgJson?.dependencies || {}),
    ...Object.keys(pkgJson?.peerDependencies || {}),
  ]);
  const devDeps = new Set(Object.keys(pkgJson?.devDependencies || {}));
  const optionalDeps = new Set(Object.keys(pkgJson?.optionalDependencies || {}));

  // map name -> versions present
  const versionMap = new Map();
  for (const pkg of enrichedPackages) {
    if (!versionMap.has(pkg.name)) versionMap.set(pkg.name, new Set());
    versionMap.get(pkg.name).add(pkg.version);
  }

  // build tree nodes
  const nodes = enrichedPackages.map(pkg => ({
    ...pkg,
    isDirectDependency: directDeps.has(pkg.name),
    isDevDependency: devDeps.has(pkg.name) && !directDeps.has(pkg.name),
    isOptionalDependency: optionalDeps.has(pkg.name),
    isDuplicate: versionMap.get(pkg.name).size > 1 || pkg.installCount > 1,
    depth: 0, // will be computed if lockfile available
  }));

  // Try to infer depth from node_modules structure: packages inside node_modules/<pkg>/node_modules are deeper
  for (const n of nodes) {
    // count nested node_modules in installPaths
    const maxDepth = Math.max(...n.installPaths.map(p => (p.match(/node_modules/g) || []).length), 1);
    n.depth = maxDepth;
  }

  // Sort by size descending
  nodes.sort((a, b) => b.size - a.size);

  return {
    pkgJson,
    lock,
    nodes,
    totalDirect: directDeps.size,
    totalDev: devDeps.size,
    detectedPackageManager: lock ? lock.type : (fs.existsSync(path.join(projectRoot, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm'),
  };
}

function detectPackageManager(projectRoot) {
  const root = path.resolve(projectRoot);
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

function getInstalledVersions(projectRoot, enrichedPackages) {
  // Already have installPaths, but we can list all physical locations of each package
  const fsWalk = require('./fs-walker');
  // This is a simpler alternative: use enriched data
  return enrichedPackages.map(p => ({
    name: p.name,
    version: p.version,
    installCount: p.installCount,
    paths: p.installPaths,
  }));
}

module.exports = {
  parsePackageJson,
  parseLockfile,
  buildDependencyTree,
  detectPackageManager,
  getInstalledVersions,
};
