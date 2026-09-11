'use strict';
const fs = require('fs');
const path = require('path');

/**
 * High-performance directory walker.
 * Returns array of { path, size, isDir, depth }
 */
async function walk(root, opts = {}) {
  const { maxDepth = Infinity, exclude = [], onProgress } = opts;
  const entries = [];
  let fileCount = 0;

  const excludeSet = new Set(exclude);
  const shouldExclude = (p) => {
    const rel = path.relative(root, p).replace(/\\/g, '/');
    for (const pat of exclude) {
      if (rel.includes(pat)) return true;
    }
    return false;
  };

  async function walkRec(current, depth) {
    if (depth > maxDepth) return;
    if (shouldExclude(current)) return;
    let stat;
    try {
      stat = await fs.promises.lstat(current);
    } catch {
      return;
    }
    // skip symlinks to avoid cycles (pnpm uses symlinks heavily)
    if (stat.isSymbolicLink()) {
      // count symlink target size as 0, but record it
      entries.push({ path: current, size: 0, isDir: false, isSymlink: true, depth });
      return;
    }
    if (stat.isDirectory()) {
      entries.push({ path: current, size: 0, isDir: true, depth });
      let children;
      try {
        children = await fs.promises.readdir(current);
      } catch {
        return;
      }
      // parallelize with Promise.all but limit concurrency naturally via async
      await Promise.all(children.map(child => walkRec(path.join(current, child), depth + 1)));
    } else if (stat.isFile()) {
      entries.push({ path: current, size: stat.size, isDir: false, depth });
      fileCount++;
      if (onProgress && fileCount % 500 === 0) onProgress(fileCount);
    }
  }

  await walkRec(path.resolve(root), 0);
  return entries;
}

function walkSync(root, opts = {}) {
  const { maxDepth = Infinity, exclude = [] } = opts;
  const entries = [];

  const shouldExclude = (p) => {
    const rel = path.relative(root, p).replace(/\\/g, '/');
    for (const pat of exclude) {
      if (rel.includes(pat)) return true;
    }
    return false;
  };

  function rec(current, depth) {
    if (depth > maxDepth) return;
    if (shouldExclude(current)) return;
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch { return; }
    if (stat.isSymbolicLink()) {
      entries.push({ path: current, size: 0, isDir: false, isSymlink: true, depth });
      return;
    }
    if (stat.isDirectory()) {
      entries.push({ path: current, size: 0, isDir: true, depth });
      let children;
      try { children = fs.readdirSync(current); } catch { return; }
      for (const c of children) rec(path.join(current, c), depth + 1);
    } else if (stat.isFile()) {
      entries.push({ path: current, size: stat.size, isDir: false, depth });
    }
  }
  rec(path.resolve(root), 0);
  return entries;
}

module.exports = { walk, walkSync };
