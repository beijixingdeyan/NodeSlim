'use strict';
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const { scanProject } = require('../scanner');
const { loadConfig } = require('../utils/config');
const { terminal } = require('../reporter');
const { scanSecurity } = require('../analyzer/security-scanner');
const { analyzeBundle } = require('../analyzer/bundle-analyzer');
const { formatBytes } = require('../utils/format');

async function analyzeAction(opts) {
  const target = path.resolve(opts.target || process.cwd());
  const { config } = loadConfig(target);
  const spinner = ora('正在深度分析依赖关系...').start();

  let result;
  try {
    result = await scanProject(target, { config });
    result.security = scanSecurity(result.packages || []);
    result.bundle = analyzeBundle(target);
    // enrich additional analyses
    try {
      const { scanSourceUsage } = require('../analyzer/usage-scanner');
      result.usage = scanSourceUsage(target, result.packages || []);
      const { analyzeProdVsDev } = require('../analyzer/prod-analyzer');
      result.prod = analyzeProdVsDev(target, result.packages || []);
      const { checkEsm } = require('../analyzer/esm-check');
      result.esm = checkEsm(target, result.usage);
      const { checkPlatformBinaries } = require('../analyzer/platform-check');
      result.platform = checkPlatformBinaries(result.packages || []);
    } catch (e) { if (process.env.DEBUG) console.error(e); }
    spinner.succeed('分析完成');

    const onlyDuplicates = opts.duplicates;
    const onlyBloat = opts.bloat;
    const onlySecurity = opts.security;
    const onlyUnused = opts.unused;
    const onlyOnDemand = opts.onDemand;
    const onlyEsm = opts.esm;
    const onlyPlatform = opts.platform;
    const onlyProd = opts.prod;

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (onlyDuplicates) { console.log(chalk.bold.cyan('\n♻️  重复依赖分析')); terminal.printDuplicates(result); return; }
    if (onlyBloat) { console.log(chalk.bold.cyan('\n🐘 膨胀包分析')); terminal.printBloat(result); terminal.printSuggestions(result); return; }
    if (onlySecurity) { console.log(chalk.bold.cyan('\n🔒 安全扫描')); terminal.printSecurity(result); return; }
    if (onlyUnused) {
      console.log(chalk.bold.cyan('\n🧹 未使用 / 幽灵依赖'));
      const u = result.usage;
      if (!u) { console.log(chalk.yellow('  源码扫描暂不可用')); return; }
      console.log(`  扫描文件: ${u.scannedFiles} 个`);
      if (!u.unused.length && !u.ghost.length) console.log(chalk.green('  ✅ 无未使用依赖'));
      if (u.unused.length) { console.log(chalk.yellow(`\n  未使用 (${u.unused.length}):`)); u.unused.forEach(x=>console.log(`   - ${chalk.cyan(x.name)}@${x.version} — ${x.reason}`)); }
      if (u.ghost.length) { console.log(chalk.red(`\n  幽灵依赖 (${u.ghost.length}):`)); u.ghost.forEach(g=>console.log(`   - ${chalk.cyan(g.name)} used in ${g.usedIn.join(', ')}`)); }
      return;
    }
    if (onlyOnDemand) {
      console.log(chalk.bold.cyan('\n⚡ 按需加载检测'));
      const issues = result.usage?.onDemandIssues || [];
      if (!issues.length) console.log(chalk.green('  ✅ 未发现全量 lodash/moment'));
      else issues.forEach(o=>console.log(`  ⚠️  ${o.message} — ${o.suggestion}`));
      return;
    }
    if (onlyEsm) {
      console.log(chalk.bold.cyan('\n📦 ESM / Tree-shaking 检测'));
      const esm = result.esm;
      if (!esm) { console.log(chalk.yellow('  暂无数据')); return; }
      console.log(`  是否 ESM 包: ${esm.isEsmPkg ? chalk.green('是') : chalk.yellow('否')}`);
      esm.issues.forEach(i=>console.log(`  ${chalk.dim('→')} ${i.message}\n     ${chalk.dim(i.suggestion)}`));
      if (!esm.issues.length) console.log(chalk.green('  ✅ ESM 良好'));
      return;
    }
    if (onlyPlatform) {
      console.log(chalk.bold.cyan('\n🖥️ 平台二进制检测'));
      const p = result.platform;
      console.log(`  当前平台: ${p.currentPlatform} — 浪费 ${p.wastedFormatted} (${p.wastedCount} 个)`);
      p.hits.filter(h=>!h.isCurrentPlatform).forEach(h=>console.log(`   - ${h.name} ${h.sizeFormatted} (${h.platform})`));
      return;
    }
    if (onlyProd) {
      console.log(chalk.bold.cyan('\n🏗️ 生产 vs 开发依赖'));
      const prod = result.prod;
      console.log(`  生产: ${prod.prod.sizeFormatted} (${prod.prod.count} 包)`);
      console.log(`  开发: ${prod.dev.sizeFormatted} (${prod.dev.count} 包, ${Math.round(prod.dev.ratio*100)}%)`);
      console.log(`  间接: ${prod.indirect.sizeFormatted} (${prod.indirect.count} 包)`);
      console.log(chalk.dim(`  → ${prod.suggestion}`));
      return;
    }

    // Full analysis
    terminal.printFullReport(result);
    // extra sections
    console.log(chalk.bold.cyan('\n────────────────────────────────────────'));
    if (result.usage) {
      console.log(chalk.bold('🧹 未使用: ') + (result.usage.unused.length ? chalk.yellow(result.usage.unused.length + ' 个') : chalk.green('0')) + chalk.dim('  | 幽灵: ') + (result.usage.ghost.length ? chalk.red(result.usage.ghost.length) : chalk.green('0')));
      if (result.usage.unused.length) console.log(chalk.dim('  提示: nodeslim analyze --unused 查看详情'));
    }
    if (result.usage?.onDemandIssues?.length) console.log(chalk.bold('⚡ 按需: ') + chalk.yellow(result.usage.onDemandIssues.length + ' 处全量导入') + chalk.dim(' (nodeslim analyze --on-demand)'));
    if (result.esm) console.log(chalk.bold('📦 ESM: ') + (result.esm.issues.length ? chalk.yellow(result.esm.issues.length + ' 项') : chalk.green('良好')) + chalk.dim(' (nodeslim analyze --esm)'));
    if (result.platform) console.log(chalk.bold('🖥️ 平台: ') + (result.platform.wastedCount ? chalk.yellow(`浪费 ${result.platform.wastedFormatted}`) : chalk.green('无冗余')));
    if (result.prod) console.log(chalk.bold('🏗️ Prod: ') + chalk.dim(result.prod.suggestion));
    printTreePreview(result, opts.depth);
  } catch (err) {
    spinner.fail(chalk.red(`分析失败: ${err.message}`));
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

function printTreePreview(scanResult, depthOpt) {
  if (!scanResult.packages?.length) return;
  const maxDepth = depthOpt ? parseInt(depthOpt,10) : 2;
  console.log(chalk.bold.cyan(`\n🌳 依赖树预览 (深度 ${maxDepth})`));
  console.log(chalk.dim('─'.repeat(60)));
  const direct = scanResult.packages.filter(p => p.isDirectDependency);
  const indirect = scanResult.packages.filter(p => !p.isDirectDependency && !p.isDevDependency);
  const dev = scanResult.packages.filter(p => p.isDevDependency);
  const showGroup = (title, list, color) => {
    if (!list.length) return;
    console.log(chalk.bold[color](`  ${title} (${list.length}):`));
    list.slice(0, 8).forEach(p => {
      console.log(`   ${chalk.dim('├─')} ${chalk.bold(p.name)}@${p.version}  ${chalk.dim(formatBytes(p.size))} ${p.installCount>1?chalk.red(`×${p.installCount}`):''}`);
    });
    if (list.length > 8) console.log(chalk.dim(`   └─ ... 还有 ${list.length-8} 个`));
  };
  showGroup('直接依赖', direct, 'cyan');
  showGroup('间接依赖', indirect, 'white');
  showGroup('开发依赖', dev, 'yellow');
  console.log(chalk.dim('\n  完整依赖树请运行 nodeslim scan --output html 或启动 dashboard 可视化'));
}

module.exports = { analyzeAction };
