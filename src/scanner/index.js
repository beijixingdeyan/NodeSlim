'use strict';
const fs = require('fs');
const path = require('path');
const { walk } = require('./fs-walker');
const { calculateByPackage, enrichPackages, getTotalSize } = require('./size-calculator');
const { buildDependencyTree, detectPackageManager, parseLockfile, parsePackageJson } = require('./dependency-resolver');

async function scanProject(projectRoot, opts = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const nmPath = path.join(root, 'node_modules');

  const config = opts.config || {};
  const maxDepth = opts.maxDepth ?? config.scan?.maxDepth ?? 20;
  const exclude = opts.exclude ?? config.scan?.exclude ?? [];

  if (!fs.existsSync(nmPath)) {
    const pkgJsonExists = fs.existsSync(path.join(root, 'package.json'));
    if (!pkgJsonExists) {
      throw new Error(`No node_modules found at ${nmPath} and no package.json at ${root}. Is this a Node.js project?`);
    }
    // Scan without node_modules: just analyze package.json for suggestions
    const analyzer = require('../analyzer');
    const pkgJson = parsePackageJson(root);
    const lock = parseLockfile(root);
    return {
      root,
      nodeModulesPath: null,
      exists: false,
      packages: [],
      totalSize: 0,
      totalPackages: 0,
      totalFiles: 0,
      tree: null,
      duplicates: [],
      bloat: [],
      suggestions: analyzer.getSuggestions([]),
      packageManager: detectPackageManager(root),
      pkgJson,
      lock,
      warning: 'node_modules not found — run npm/pnpm/yarn install first. Showing package.json analysis only.',
    };
  }

  // Walk filesystem
  const entries = await walk(nmPath, { maxDepth, exclude, onProgress: opts.onProgress });
  const pkgSizes = calculateByPackage(entries);
  const enriched = enrichPackages(pkgSizes);
  const totalSize = getTotalSize(enriched);
  const totalFiles = entries.filter(e => !e.isDir && !e.isSymlink).length;

  const tree = buildDependencyTree(root, enriched);
  const analyzer = require('../analyzer');
  const duplicates = analyzer.findDuplicates(enriched);
  const bloat = analyzer.findBloat(enriched, { maxPackageSizeMB: config.thresholds?.maxPackageSizeMB || 10 });
  const issues = analyzer.detectIssues(enriched, duplicates, bloat);
  const suggestions = analyzer.getSuggestions(enriched);

  const wastedSize = duplicates.reduce((sum, d) => sum + (d.wastedSize || 0), 0);
  const optimizableSize = bloat.reduce((s, b) => s + b.size, 0) * 0.3 + wastedSize; // heuristic

  return {
    root,
    nodeModulesPath: nmPath,
    exists: true,
    packages: enriched,
    totalSize,
    totalPackages: enriched.length,
    totalFiles,
    entriesCount: entries.length,
    tree,
    duplicates,
    bloat,
    issues,
    suggestions,
    wastedSize,
    optimizableSize: Math.min(optimizableSize, totalSize * 0.5),
    packageManager: detectPackageManager(root),
    pkgJson: tree.pkgJson,
    lock: tree.lock,
    scannedAt: new Date().toISOString(),
  };
}

module.exports = { scanProject };
