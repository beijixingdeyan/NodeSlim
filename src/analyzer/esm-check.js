'use strict';
const fs = require('fs');
const path = require('path');

function checkEsm(projectRoot, usageInfo) {
  const pjPath = path.join(projectRoot, 'package.json');
  let pj = {};
  try { pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8')); } catch {}
  const isEsmPkg = pj.type === 'module';
  const hasEsmExports = !!(pj.exports || pj.module);
  const issues = [];

  if (!isEsmPkg) {
    issues.push({
      type: 'ESM',
      severity: 'INFO',
      packageName: null,
      message: '项目未启用 ESM (package.json 缺少 "type": "module")',
      suggestion: '添加 "type": "module" 以启用原生 ESM，获得更好 tree-shaking',
    });
  }
  if (!hasEsmExports && !isEsmPkg) {
    issues.push({
      type: 'ESM',
      severity: 'INFO',
      packageName: null,
      message: '未配置 exports/module 字段，发布包时可能影响 tree-shaking',
      suggestion: '在 package.json 添加 "exports": { ".": { "import": "./dist/index.mjs", "require": "./dist/index.cjs" } }',
    });
  }

  if (usageInfo && usageInfo.cjsUsages && usageInfo.cjsUsages.length > 0) {
    const count = usageInfo.cjsUsages.length;
    issues.push({
      type: 'ESM',
      severity: count > 10 ? 'WARNING' : 'INFO',
      packageName: null,
      message: `检测到 ${count} 处 CJS 用法 (require/module.exports)，可能阻碍 tree-shaking`,
      suggestion: `逐步迁移到 ESM: import { x } from 'y' 替代 require；统计见 analyze --esm 详情`,
      sample: usageInfo.cjsUsages.slice(0, 3),
    });
  }

  if (usageInfo && usageInfo.onDemandIssues) {
    const heavy = usageInfo.onDemandIssues.filter(x => x.pkg === 'lodash' || x.pkg === 'moment');
    if (heavy.length) {
      issues.push({
        type: 'ESM',
        severity: 'WARNING',
        packageName: null,
        message: `检测到 ${heavy.length} 处可优化的导入（全量 lodash/moment）`,
        suggestion: '使用 lodash-es 或 es-toolkit 替代 lodash，dayjs 替代 moment，均为 ESM tree-shakeable',
      });
    }
  }

  // Check source files for mix of import/require
  let hasMixed = false;
  try {
    const files = usageInfo ? [] : [];
    // No-op, already handled via cjsUsages
  } catch {}

  return {
    isEsmPkg,
    hasEsmExports,
    issues,
    recommendation: issues.length === 0 ? 'ESM 配置良好，已具备最佳 tree-shaking 条件' : `发现 ${issues.length} 项 ESM 相关优化点`,
  };
}

module.exports = { checkEsm };
