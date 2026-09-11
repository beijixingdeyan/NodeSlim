'use strict';
const { formatBytes } = require('../utils/format');

function findBloat(enrichedPackages, opts = {}) {
  const maxPackageSizeMB = opts.maxPackageSizeMB ?? 10;
  const maxBytes = maxPackageSizeMB * 1024 * 1024;

  const totalSize = enrichedPackages.reduce((s, p) => s + p.size, 0);

  const bloated = enrichedPackages
    .filter(p => p.size > maxBytes)
    .map(p => ({
      name: p.name,
      version: p.version,
      size: p.size,
      sizeFormatted: formatBytes(p.size),
      fileCount: p.fileCount,
      ratio: totalSize ? (p.size / totalSize) : 0,
      category: p.category,
      reason: p.size > 50 * 1024 * 1024 ? '巨型包 (>50MB)，建议检查是否包含二进制或冗余文件' :
              p.size > 20 * 1024 * 1024 ? '大型包 (>20MB)，可能包含冗余资源' :
              `超过阈值 ${maxPackageSizeMB}MB`,
      severity: p.size > 50 * 1024 * 1024 ? 'critical' : p.size > 20 * 1024 * 1024 ? 'warning' : 'info',
    }))
    .sort((a, b) => b.size - a.size);

  // Also find packages with disproportionately many files (possible bloat)
  const manyFiles = enrichedPackages
    .filter(p => p.fileCount > 500 && !bloated.find(b => b.name === p.name))
    .map(p => ({
      name: p.name,
      version: p.version,
      size: p.size,
      sizeFormatted: formatBytes(p.size),
      fileCount: p.fileCount,
      ratio: totalSize ? p.size / totalSize : 0,
      category: p.category,
      reason: `文件数过多 (${p.fileCount} files)，可能包含测试/文档/示例`,
      severity: 'info',
    }))
    .sort((a, b) => b.fileCount - a.fileCount)
    .slice(0, 5);

  return [...bloated, ...manyFiles];
}

function detectIssues(enrichedPackages, duplicates, bloat) {
  const issues = [];

  for (const d of duplicates) {
    issues.push({
      type: 'DUPLICATE',
      severity: d.severity === 'high' ? 'WARNING' : 'INFO',
      packageName: d.packageName,
      message: `${d.packageName} 安装了 ${d.count} 次，版本: ${d.versions.join(', ')}`,
      suggestion: `使用 overrides/resolutions 统一版本，或迁移到 pnpm 天然去重`,
      autoFixable: false,
      wastedSize: d.wastedSize,
    });
  }

  for (const b of bloat) {
    issues.push({
      type: 'BLOAT',
      severity: b.severity === 'critical' ? 'ERROR' : b.severity === 'warning' ? 'WARNING' : 'INFO',
      packageName: b.name,
      message: `${b.name}@${b.version} 体积 ${b.sizeFormatted} (${(b.ratio*100).toFixed(1)}%) — ${b.reason}`,
      suggestion: b.category === 'types' ? '生产部署可删除 @types/*' : '检查是否可替换为更轻量替代或按需引入',
      autoFixable: false,
    });
  }

  return issues;
}

module.exports = { findBloat, detectIssues };
