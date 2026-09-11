'use strict';
const fs = require('fs');
const path = require('path');
const { formatBytes } = require('../utils/format');

function analyzeBundle(projectRoot) {
  const root = path.resolve(projectRoot);
  const candidates = [
    path.join(root, 'dist'),
    path.join(root, 'build'),
    path.join(root, '.next'),
    path.join(root, 'out'),
  ];

  const results = [];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const files = collectFiles(dir);
    const jsFiles = files.filter(f => f.endsWith('.js'));
    const cssFiles = files.filter(f => f.endsWith('.css'));
    const mapFiles = files.filter(f => f.endsWith('.map'));

    let total = 0;
    const details = [];
    for (const f of [...jsFiles, ...cssFiles]) {
      try {
        const stat = fs.statSync(f);
        total += stat.size;
        details.push({ file: path.relative(root, f), size: stat.size, type: f.endsWith('.js') ? 'js' : 'css' });
      } catch {}
    }
    details.sort((a, b) => b.size - a.size);
    results.push({
      dir: path.relative(root, dir),
      exists: true,
      totalSize: total,
      totalFormatted: formatBytes(total),
      fileCount: files.length,
      jsCount: jsFiles.length,
      cssCount: cssFiles.length,
      mapCount: mapFiles.length,
      largestFiles: details.slice(0, 10),
      suggestion: total > 5 * 1024 * 1024 ? '打包产物过大，建议开启 code splitting / tree-shaking / compression' :
                  jsFiles.length > 20 ? 'JS 文件较多，考虑合并或懒加载' : '产物正常',
    });
  }

  if (results.length === 0) {
    return {
      found: false,
      message: '未发现常见打包目录 (dist/build/.next/out)，若为前端项目请先执行构建',
      suggestion: '运行 npm run build 后再分析，或指定自定义目录',
    };
  }

  return {
    found: true,
    outputs: results,
  };
}

function collectFiles(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(p, out);
    else out.push(p);
  }
  return out;
}

module.exports = { analyzeBundle };
