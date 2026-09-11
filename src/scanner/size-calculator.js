'use strict';
const fs = require('fs');
const path = require('path');

function extractPackageName(filePath) {
  // Normalize
  const normalized = filePath.replace(/\\/g, '/');
  const marker = 'node_modules/';
  const idx = normalized.lastIndexOf(marker);
  if (idx === -1) return null;
  const after = normalized.slice(idx + marker.length);
  if (!after) return null;
  const parts = after.split('/');
  const first = parts[0];
  if (!first) return null;
  // 忽略 .bin/.vite/.pnpm/.cache 等隐藏目录（非真实包）
  if (first.startsWith('.')) return null;
  if (first.startsWith('@')) {
    // scoped: @scope/name
    if (parts.length >= 2) {
      // 第二段也可能是 . 开头的隐藏目录，排除
      if (parts[1].startsWith('.')) return null;
      return `${parts[0]}/${parts[1]}`;
    }
    return first;
  }
  return first;
}

function calculateByPackage(entries) {
  const map = new Map(); // name -> { size, fileCount, paths: Set }
  for (const e of entries) {
    if (e.isDir || e.isSymlink) continue;
    const pkg = extractPackageName(e.path);
    if (!pkg) continue;
    if (!map.has(pkg)) map.set(pkg, { name: pkg, size: 0, fileCount: 0, paths: new Set() });
    const info = map.get(pkg);
    info.size += e.size;
    info.fileCount += 1;
    // track unique installation paths (for duplicate detection)
    const nmIdx = e.path.replace(/\\/g, '/').lastIndexOf('node_modules/');
    const instPath = e.path.slice(0, nmIdx + ('node_modules/' + pkg).length).replace(/\\/g, '/');
    info.paths.add(instPath);
  }
  // convert to array
  return Array.from(map.values()).map(v => ({
    name: v.name,
    size: v.size,
    fileCount: v.fileCount,
    installPaths: Array.from(v.paths),
    installCount: v.paths.size,
  }));
}

function getPackageVersion(pkgName, installPaths) {
  for (const p of installPaths) {
    const pj = path.join(p, 'package.json');
    try {
      const raw = fs.readFileSync(pj, 'utf-8');
      const json = JSON.parse(raw);
      if (json.version) return { version: json.version, pkgJson: json };
    } catch {}
  }
  // fallback: try first install path
  return { version: 'unknown', pkgJson: null };
}

function enrichPackages(pkgSizes) {
  return pkgSizes.map(pkg => {
    const { version, pkgJson } = getPackageVersion(pkg.name, pkg.installPaths);
    return {
      ...pkg,
      version,
      description: pkgJson?.description || '',
      license: pkgJson?.license || pkgJson?.licenses || '',
      dependencies: pkgJson?.dependencies ? Object.keys(pkgJson.dependencies) : [],
      isScoped: pkg.name.startsWith('@'),
      category: categorize(pkg.name, pkgJson),
    };
  });
}

function categorize(name, pkgJson) {
  if (!pkgJson) return 'unknown';
  const kw = pkgJson.keywords;
  const keywords = (Array.isArray(kw) ? kw.join(' ') : (kw || '')).toLowerCase();
  const desc = (pkgJson.description || '').toLowerCase();
  const combined = `${name} ${keywords} ${desc}`;
  if (/react|vue|angular|svelte|solid/.test(combined)) return 'framework';
  if (/babel|webpack|vite|rollup|esbuild|typescript|eslint|prettier|jest|vitest/.test(combined)) return 'build-tool';
  if (/lodash|underscore|ramda|moment|dayjs|axios|request/.test(combined)) return 'utility';
  if (name.startsWith('@types/')) return 'types';
  if (/test|jest|mocha|chai|cypress|playwright/.test(combined)) return 'testing';
  return 'library';
}

function getTotalSize(packages) {
  return packages.reduce((sum, p) => sum + p.size, 0);
}

module.exports = {
  extractPackageName,
  calculateByPackage,
  getPackageVersion,
  enrichPackages,
  categorize,
  getTotalSize,
};
