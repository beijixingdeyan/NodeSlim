'use strict';
const fs = require('fs');
const path = require('path');

function buildReport(scanResult, opts = {}) {
  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      version: require('../../package.json').version,
      root: scanResult.root,
      packageManager: scanResult.packageManager,
    },
    summary: {
      totalPackages: scanResult.totalPackages,
      totalSize: scanResult.totalSize,
      totalFiles: scanResult.totalFiles,
      duplicateCount: scanResult.duplicates?.length || 0,
      bloatCount: scanResult.bloat?.length || 0,
      optimizableSize: scanResult.optimizableSize || 0,
      wastedSize: scanResult.wastedSize || 0,
      // 透传本地/估算标记，保持导入文件夹与服务端切换一致
      isEstimated: scanResult.summary?.isEstimated ?? scanResult.isEstimated ?? false,
      isLocalFolder: scanResult.isLocalFolder ?? scanResult.summary?.isLocalFolder ?? false,
      note: scanResult.summary?.note ?? scanResult.note ?? null,
    },
    packages: scanResult.packages || [],
    duplicates: scanResult.duplicates || [],
    bloat: scanResult.bloat || [],
    issues: scanResult.issues || [],
    suggestions: scanResult.suggestions || [],
    security: scanResult.security || [],
    bundle: scanResult.bundle || null,
    // 新增：统一审计与建议的数据源，避免“建议里的未使用”与“审计里的幽灵”对不上
    usage: scanResult.usage || null,
    prod: scanResult.prod || null,
    platform: scanResult.platform || null,
    whitelist: scanResult.whitelist || null,
  };
  return report;
}

async function saveJsonReport(scanResult, opts = {}) {
  const outputDir = opts.outputDir || path.join(scanResult.root, '.nodeslim/reports');
  fs.mkdirSync(outputDir, { recursive: true });
  const report = buildReport(scanResult, opts);
  const filename = opts.filename || `report-${new Date().toISOString().slice(0, 10)}-${Date.now()}.json`;
  const full = path.join(outputDir, filename);
  fs.writeFileSync(full, JSON.stringify(report, null, 2), 'utf-8');
  // also write latest.json
  fs.writeFileSync(path.join(outputDir, 'latest.json'), JSON.stringify(report, null, 2), 'utf-8');
  // keep history
  const keep = opts.keepHistory ?? 10;
  pruneHistory(outputDir, keep);
  return { path: full, report, latestPath: path.join(outputDir, 'latest.json') };
}

function pruneHistory(dir, keep) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('report-') && f.endsWith('.json'))
      .map(f => ({ f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length > keep) {
      for (const old of files.slice(keep)) {
        try { fs.unlinkSync(old.full); } catch {}
      }
    }
  } catch {}
}

module.exports = { buildReport, saveJsonReport };
