'use strict';
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const { scanProject } = require('../scanner');
const { loadConfig } = require('../utils/config');
const { scanSecurity } = require('../analyzer/security-scanner');
const { scanSourceUsage } = require('../analyzer/usage-scanner');
const { analyzeProdVsDev } = require('../analyzer/prod-analyzer');
const { checkEsm } = require('../analyzer/esm-check');
const { checkPlatformBinaries } = require('../analyzer/platform-check');
const { checkWhitelist } = require('../analyzer/whitelist-check');
const { formatBytes } = require('../utils/format');

async function auditAction(opts) {
  const target = path.resolve(opts.target || process.cwd());
  const { config } = loadConfig(target);
  const spinner = ora('正在执行全量审计...').start();
  let result;
  try {
    result = await scanProject(target, { config });
    result.security = scanSecurity(result.packages || []);
    spinner.succeed('扫描完成，正在生成审计报告');
  } catch (e) {
    spinner.fail(chalk.red(`审计失败: ${e.message}`));
    process.exit(1);
  }

  const usage = scanSourceUsage(target, result.packages || []);
  const prod = analyzeProdVsDev(target, result.packages || []);
  const esm = checkEsm(target, usage);
  const platform = checkPlatformBinaries(result.packages || []);
  const whitelist = checkWhitelist(target);

  console.log(chalk.bold.cyan('\n🔍 NodeSlim 全量审计报告'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log(`  项目: ${target}`);
  console.log(`  总体积: ${chalk.yellow(formatBytes(result.totalSize))} (${result.totalPackages} 包)`);

  // Security
  console.log(chalk.bold('\n[1] 🔒 安全'));
  if (!result.security.length) console.log(chalk.green('  ✅ 未发现已知漏洞'));
  else result.security.forEach(s => console.log(`  ${s.severity === 'CRITICAL' ? chalk.bgRed.white(' CRITICAL ') : chalk.yellow(s.severity)} ${s.packageName} — ${s.message}`));

  // Unused & Ghost
  console.log(chalk.bold('\n[2] 🧹 未使用 / 幽灵依赖'));
  if (!usage.unused.length && !usage.ghost.length) console.log(chalk.green('  ✅ 无未使用依赖'));
  else {
    if (usage.unused.length) {
      console.log(chalk.yellow(`  未使用 (${usage.unused.length}):`));
      usage.unused.slice(0, 8).forEach(u => console.log(`   - ${chalk.cyan(u.name)}@${u.version} ${chalk.dim(u.isDev ? '(dev)' : '')} — ${u.reason}`));
    }
    if (usage.ghost.length) {
      console.log(chalk.red(`  幽灵依赖 (${usage.ghost.length}):`));
      usage.ghost.slice(0, 8).forEach(g => console.log(`   - ${chalk.cyan(g.name)} used in ${g.usedIn.join(', ')} — ${g.message}`));
    }
  }

  // On-demand
  console.log(chalk.bold('\n[3] ⚡ 按需加载'));
  if (!usage.onDemandIssues.length) console.log(chalk.green('  ✅ 未发现全量 lodash/moment 导入'));
  else usage.onDemandIssues.slice(0, 5).forEach(o => console.log(`  ${chalk.yellow('⚠️')} ${o.message} — ${o.suggestion}`));

  // ESM
  console.log(chalk.bold('\n[4] 📦 ESM / Tree-shaking'));
  esm.issues.forEach(i => console.log(`  ${chalk.dim('→')} ${i.message} — ${i.suggestion}`));
  if (!esm.issues.length) console.log(chalk.green('  ✅ ESM 良好'));

  // Prod vs Dev
  console.log(chalk.bold('\n[5] 🏗️ 生产 vs 开发'));
  console.log(`  生产: ${prod.prod.sizeFormatted} (${prod.prod.count} 包)`);
  console.log(`  开发: ${prod.dev.sizeFormatted} (${prod.dev.count} 包, ${Math.round(prod.dev.ratio*100)}%)`);
  console.log(`  间接: ${prod.indirect.sizeFormatted} (${prod.indirect.count} 包)`);
  console.log(chalk.dim(`  → ${prod.suggestion}`));

  // Platform
  console.log(chalk.bold('\n[6] 🖥️ 平台二进制'));
  console.log(`  当前: ${platform.currentPlatform} — 浪费 ${platform.wastedFormatted} (${platform.wastedCount} 个)`);
  if (platform.wastedCount) platform.hits.filter(h=>!h.isCurrentPlatform).slice(0,5).forEach(h=>console.log(`   - ${h.name} ${h.sizeFormatted}`));
  else console.log(chalk.green('  ✅ 无冗余平台二进制'));

  // Whitelist / Governance
  console.log(chalk.bold('\n[7] 📋 工程治理 / 白名单'));
  whitelist.issues.forEach(i => console.log(`  ${chalk.dim('→')} ${i.message}`));

  // Summary
  const totalIssues = result.security.length + usage.unused.length + usage.ghost.length + usage.onDemandIssues.length + esm.issues.length + (platform.wastedCount>0?1:0) + whitelist.issues.length;
  console.log(chalk.bold.cyan('\n─'.repeat(60)));
  console.log(`  审计完成 — 发现 ${totalIssues ? chalk.yellow(totalIssues + ' 项待优化') : chalk.green('0 项，项目健康度优秀 ✅')}`);
  console.log(chalk.dim(`  建议运行: nodeslim optimize --clean --dry-run  |  nodeslim dashboard 查看可视化`));
  if (opts.json) {
    const out = { target, totalSize: result.totalSize, usage, prod, esm, platform, whitelist, security: result.security };
    console.log(JSON.stringify(out, null, 2));
  }
}

module.exports = { auditAction };
