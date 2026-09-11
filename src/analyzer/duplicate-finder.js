'use strict';

function findDuplicates(enrichedPackages) {
  // Group by package name
  const groups = new Map();
  for (const pkg of enrichedPackages) {
    if (!groups.has(pkg.name)) groups.set(pkg.name, []);
    groups.get(pkg.name).push(pkg);
  }

  const duplicates = [];
  for (const [name, pkgs] of groups.entries()) {
    // A package is duplicate if it has multiple install paths or multiple entries (our walker dedups by name, but installCount reveals)
    // Also check versions: if same package appears with different versions in different paths, that's duplicate
    const pkg = pkgs[0]; // we have one entry per name, but installCount tells multiplicity
    if (pkg.installCount > 1) {
      // Need to enumerate versions per path
      const versions = collectVersions(pkg);
      duplicates.push({
        packageName: name,
        count: pkg.installCount,
        versions: versions.length ? versions : [pkg.version],
        paths: pkg.installPaths,
        totalSize: pkg.size,
        wastedSize: Math.max(0, pkg.size - (pkg.size / pkg.installCount)), // heuristic
        severity: pkg.installCount > 3 ? 'high' : pkg.installCount > 1 ? 'medium' : 'low',
      });
    }
  }

  // Also detect same-name with different actual versions by scanning physical paths more precisely
  // For now use installCount heuristic; if not enough, attempt deeper scan lazy
  duplicates.sort((a, b) => b.wastedSize - a.wastedSize);
  return duplicates;
}

function collectVersions(pkg) {
  const fs = require('fs');
  const path = require('path');
  const versions = new Set();
  for (const p of pkg.installPaths) {
    try {
      const raw = fs.readFileSync(path.join(p, 'package.json'), 'utf-8');
      const j = JSON.parse(raw);
      if (j.version) versions.add(j.version);
    } catch {}
    // Also scan nested node_modules for this same package name (rare)
  }
  // If installPaths are deduped to 1 but we still want to detect duplicates via nested installs,
  // we would need full scan; fallback to pkg.version
  if (versions.size === 0 && pkg.version) versions.add(pkg.version);
  return Array.from(versions);
}

module.exports = { findDuplicates };
