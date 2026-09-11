'use strict';
const fs = require('fs');
const path = require('path');
const { formatBytes } = require('../utils/format');

let replaceRules = null;
function loadReplaceRules() {
  if (replaceRules) return replaceRules;
  try {
    const p = path.join(__dirname, '../../rules/replace-rules.json');
    replaceRules = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    replaceRules = { replacements: [] };
  }
  return replaceRules;
}

function getSuggestions(enrichedPackages, opts = {}) {
  const suggestions = [];
  const pkgNames = new Set(enrichedPackages.map(p => p.name));
  const usage = opts.usage || null;

  // Replacement suggestions
  const rules = loadReplaceRules();
  for (const rule of rules.replacements || []) {
    if (pkgNames.has(rule.from)) {
      const pkg = enrichedPackages.find(p => p.name === rule.from);
      suggestions.push({
        type: 'REPLACE',
        severity: 'INFO',
        packageName: rule.from,
        message: `${rule.from} → ${rule.to}: ${rule.reason}`,
        suggestion: `考虑替换为 ${rule.to} (兼容度 ${rule.api_compat}, 迁移成本 ${rule.migration_effort})`,
        estimatedSavings: rule.estimated_savings,
        currentSize: pkg ? formatBytes(pkg.size) : '-',
        from: rule.from,
        to: rule.to,
        migrationEffort: rule.migration_effort,
        autoFixable: false,
      });
    }
  }

  // pnpm migration suggestion
  if (enrichedPackages.length > 50) {
    suggestions.push({
      type: 'MIGRATION',
      severity: 'INFO',
      packageName: null,
      message: `检测到 ${enrichedPackages.length} 个包，使用 pnpm 可节省 70%+ 磁盘并提升安装速度`,
      suggestion: '运行 nodeslim optimize --migrate pnpm 一键迁移 (自动备份 lockfile)',
      estimatedSavings: '70% disk',
      autoFixable: true,
    });
  }

  // Production pruning suggestion
  const typesCount = enrichedPackages.filter(p => p.category === 'types' || p.name.startsWith('@types/')).length;
  if (typesCount > 5) {
    const typesSize = enrichedPackages.filter(p => p.name.startsWith('@types/')).reduce((s, p) => s + p.size, 0);
    suggestions.push({
      type: 'CLEAN',
      severity: 'INFO',
      packageName: '@types/*',
      message: `发现 ${typesCount} 个 @types/* 包 (${formatBytes(typesSize)})，生产环境可忽略`,
      suggestion: '部署时使用 npm ci --production 或 pnpm install --prod 过滤 dev 依赖',
      estimatedSavings: formatBytes(typesSize),
      autoFixable: true,
    });
  }

  // Heavy utility suggestion
  const lodashPkg = enrichedPackages.find(p => p.name === 'lodash');
  if (lodashPkg) {
    suggestions.push({
      type: 'TREE_SHAKING',
      severity: 'INFO',
      packageName: 'lodash',
      message: `lodash 全量引入 (${formatBytes(lodashPkg.size)})，支持按需导入可大幅减少打包体积`,
      suggestion: "改为 import debounce from 'lodash/debounce' 或迁移到 es-toolkit (tree-shakeable)",
      estimatedSavings: '50KB+ (bundle)',
      autoFixable: false,
    });
  }

  // Clean redundant files suggestion
  suggestions.push({
    type: 'CLEAN',
    severity: 'INFO',
    packageName: '*',
    message: `包内冗余文件 (test/docs/*.md/*.map/.github) 通常占 20-30% 体积`,
    suggestion: '运行 nodeslim optimize --clean --dry-run 预览清理，或 --clean 执行',
    estimatedSavings: '20-30%',
    autoFixable: true,
  });

  // Real unused / ghost from usage-scanner (when available) — ensures 建议 与 审计 一致
  if (usage) {
    const unused = usage.unused || [];
    const ghost = usage.ghost || [];
    for (const u of unused.slice(0, 5)) {
      suggestions.push({
        type: 'UNUSED',
        severity: 'WARNING',
        packageName: u.name,
        message: `${u.name}@${u.version} 已声明但源码中未检测到 import/require（${u.reason}）`,
        suggestion: u.suggestion || '确认是否仍需依赖',
        estimatedSavings: '-',
        autoFixable: false,
        source: 'usage-scanner',
      });
    }
    for (const g of ghost.slice(0, 5)) {
      suggestions.push({
        type: 'GHOST',
        severity: 'WARNING',
        packageName: g.name,
        message: `${g.name} 在源码中使用但未在 package.json 声明（幽灵依赖）`,
        suggestion: g.suggestion,
        estimatedSavings: '-',
        autoFixable: false,
        source: 'usage-scanner',
      });
    }
    // 如果有真实扫描结果，就不再使用 heuristic 兜底，避免重复
    if (unused.length || ghost.length) {
      return suggestions;
    }
  }

  // Fallback heuristic: flag big indirect packages when no real usage data
  const bigUnusedCandidates = enrichedPackages
    .filter(p => !p.isDirectDependency && !p.isDevDependency && p.size > 5 * 1024 * 1024)
    .slice(0, 3);
  for (const p of bigUnusedCandidates) {
    suggestions.push({
      type: 'UNUSED',
      severity: 'WARNING',
      packageName: p.name,
      message: `${p.name}@${p.version} (${formatBytes(p.size)}) 可能是间接依赖，可检查是否可移除`,
      suggestion: '使用 depcheck 或检查 package.json 是否显式依赖该包',
      estimatedSavings: formatBytes(p.size),
      autoFixable: false,
      source: 'heuristic',
    });
  }

  return suggestions;
}

module.exports = { getSuggestions };
