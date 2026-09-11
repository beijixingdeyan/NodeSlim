'use strict';
const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

const DEFAULT_CLEAN_PATTERNS = [
  '**/test',
  '**/tests',
  '**/__tests__',
  '**/docs',
  '**/doc',
  '**/*.md',
  '**/*.map',
  '**/.github',
  '**/.travis.yml',
  '**/.circleci',
  '**/appveyor.yml',
  '**/CHANGELOG*',
  '**/HISTORY*',
  '**/example',
  '**/examples',
];

function loadCleanRules() {
  try {
    const p = path.join(__dirname, '../../rules/clean-rules.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const patterns = [];
    for (const r of j.rules || []) {
      patterns.push(...(r.patterns || []));
    }
    return [...new Set([...patterns, ...DEFAULT_CLEAN_PATTERNS])];
  } catch {
    return DEFAULT_CLEAN_PATTERNS;
  }
}

async function previewClean(projectRoot, opts = {}) {
  const root = path.resolve(projectRoot);
  const nmPath = path.join(root, 'node_modules');
  if (!fs.existsSync(nmPath)) throw new Error('node_modules not found');

  const patterns = opts.patterns || loadCleanRules();
  const excludePackages = opts.excludePackages || [];

  const hits = [];
  let totalSize = 0;

  for (const pat of patterns) {
    const fullPat = path.join(nmPath, pat).replace(/\\/g, '/');
    // Use globSync for sync preview
    let files = [];
    try {
      files = globSync(fullPat, { absolute: true, dot: true });
    } catch {}
    for (const f of files) {
      // check excludePackages
      const rel = path.relative(nmPath, f).replace(/\\/g, '/');
      const topPkg = rel.split('/')[0].startsWith('@') ? rel.split('/').slice(0, 2).join('/') : rel.split('/')[0];
      if (excludePackages.some(ex => {
        if (ex.endsWith('/*')) return topPkg.startsWith(ex.slice(0, -2));
        return topPkg === ex;
      })) continue;

      let size = 0;
      try {
        const stat = fs.statSync(f);
        if (stat.isFile()) size = stat.size;
        else if (stat.isDirectory()) size = dirSizeSync(f);
      } catch { size = 0; }
      hits.push({ path: f, relative: path.relative(root, f), pattern: pat, size, isDir: fs.statSync(f).isDirectory?.() || false });
      totalSize += size;
    }
  }

  // Deduplicate by path
  const uniq = new Map();
  for (const h of hits) uniq.set(h.path, h);
  const uniqueHits = Array.from(uniq.values()).sort((a, b) => b.size - a.size);

  const total = uniqueHits.reduce((s, h) => s + h.size, 0);

  // Group by pattern
  const byPattern = {};
  for (const h of uniqueHits) {
    byPattern[h.pattern] = byPattern[h.pattern] || { count: 0, size: 0 };
    byPattern[h.pattern].count += 1;
    byPattern[h.pattern].size += h.size;
  }

  return {
    nodeModulesPath: nmPath,
    patterns,
    hits: uniqueHits,
    totalHits: uniqueHits.length,
    totalSize: total,
    byPattern,
  };
}

function dirSizeSync(dir) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += dirSizeSync(p);
      else if (e.isFile()) total += fs.statSync(p).size;
      else if (e.isSymbolicLink()) {} // skip
    } catch {}
  }
  return total;
}

async function executeClean(projectRoot, opts = {}) {
  const preview = await previewClean(projectRoot, opts);
  const dryRun = opts.dryRun;

  let removed = 0;
  let failed = 0;
  const errors = [];

  if (!dryRun) {
    for (const h of preview.hits) {
      try {
        fs.rmSync(h.path, { recursive: true, force: true });
        removed++;
      } catch (e) {
        failed++;
        errors.push({ path: h.path, error: e.message });
      }
    }
  }

  return {
    ...preview,
    dryRun,
    removed: dryRun ? 0 : removed,
    failed: dryRun ? 0 : failed,
    errors,
  };
}

module.exports = { previewClean, executeClean, loadCleanRules, DEFAULT_CLEAN_PATTERNS };
