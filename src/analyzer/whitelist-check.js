'use strict';
const fs = require('fs');
const path = require('path');

function checkWhitelist(projectRoot, opts = {}) {
  const pjPath = path.join(projectRoot, 'package.json');
  let pj = {};
  try { pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8')); } catch {}

  const issues = [];
  // .npmrc engine-strict
  const npmrcPath = path.join(projectRoot, '.npmrc');
  let npmrc = '';
  try { npmrc = fs.readFileSync(npmrcPath, 'utf-8'); } catch {}
  if (!npmrc.includes('engine-strict')) {
    issues.push({ type: 'whitelist', severity: 'INFO', message: '.npmrc 缺少 engine-strict=true，建议启用以强制引擎校验', suggestion: 'echo "engine-strict=true" >> .npmrc' });
  }
  // engines
  if (!pj.engines || !pj.engines.node) {
    issues.push({ type: 'whitelist', severity: 'INFO', message: 'package.json 缺少 engines.node 字段', suggestion: '"engines": { "node": ">=20.0.0" }' });
  }
  if (!pj.packageManager) {
    issues.push({ type: 'whitelist', severity: 'INFO', message: '未声明 packageManager 字段，团队可能混用 npm/yarn/pnpm', suggestion: '"packageManager": "pnpm@9.0.0" 并启用 corepack' });
  } else {
    issues.push({ type: 'whitelist', severity: 'INFO', message: `已声明 packageManager: ${pj.packageManager} ✅`, suggestion: '保持团队统一' });
  }

  // husky / lint-staged check
  const hasHusky = !!pj.husky || !!pj['lint-staged'] || fs.existsSync(path.join(projectRoot, '.husky'));
  if (!hasHusky) {
    issues.push({ type: 'governance', severity: 'INFO', message: '未配置 husky/lint-staged 提交前检查', suggestion: '添加 pre-commit 钩子运行 depcheck 与体积检查' });
  }

  // check-bundle-size script
  const hasCheckScript = pj.scripts && (pj.scripts['check:size'] || pj.scripts['check-deps']);
  if (!hasCheckScript) {
    issues.push({ type: 'governance', severity: 'INFO', message: '缺少体积/依赖检查脚本', suggestion: '添加 "check:size": "nodeslim scan --output json" 到 scripts' });
  }

  return { issues, pj, npmrc: npmrc.slice(0, 500) };
}

module.exports = { checkWhitelist };
