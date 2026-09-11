'use strict';
const chalk = require('chalk');
const Table = require('cli-table3');
const { formatBytes } = require('../utils/format');

function printSummary(scanResult) {
  console.log(chalk.bold.cyan('\n📊 统计摘要'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log(`   ${chalk.bold('项目:')}      ${scanResult.root}`);
  console.log(`   ${chalk.bold('包管理器:')}  ${scanResult.packageManager}${scanResult.lock ? chalk.dim(` (${scanResult.lock.type})`) : ''}`);
  console.log(`   ${chalk.bold('总包数:')}    ${chalk.yellow(scanResult.totalPackages)} packages`);
  console.log(`   ${chalk.bold('总文件:')}    ${scanResult.totalFiles?.toLocaleString() || '-'} files`);
  console.log(`   ${chalk.bold('总体积:')}    ${chalk.green.bold(formatBytes(scanResult.totalSize))}`);
  if (!scanResult.exists) {
    console.log(chalk.yellow(`   ⚠️  ${scanResult.warning}`));
  } else {
    console.log(`   ${chalk.bold('重复包:')}    ${scanResult.duplicates?.length ? chalk.red(scanResult.duplicates.length + ' 个') : chalk.green('0 个')}  ${scanResult.wastedSize ? chalk.dim(`(浪费 ${formatBytes(scanResult.wastedSize)})`) : ''}`);
    console.log(`   ${chalk.bold('膨胀包:')}    ${(scanResult.bloat?.length || 0) > 0 ? chalk.yellow(scanResult.bloat.length + ' 个') : chalk.green('0 个')}`);
    console.log(`   ${chalk.bold('可优化:')}    ${chalk.magenta(formatBytes(scanResult.optimizableSize || 0))} ${chalk.dim('(估算)')}`);
  }
}

function printTopPackages(scanResult, limit = 10) {
  if (!scanResult.packages?.length) return;
  const sorted = [...scanResult.packages].sort((a,b)=>b.size-a.size).slice(0, limit);
  console.log(chalk.bold.cyan(`\n📦 Top ${limit} 最大包`));
  console.log(chalk.dim('─'.repeat(60)));

  const maxSize = sorted[0]?.size || 1;
  sorted.forEach((pkg, i) => {
    const barLen = Math.min(20, Math.ceil(pkg.size / maxSize * 20));
    const bar = chalk.hex(topColor(i))('█'.repeat(barLen)) + chalk.dim('░'.repeat(20 - barLen));
    const size = formatBytes(pkg.size).padStart(10);
    const name = pkg.name.length > 30 ? pkg.name.slice(0,27)+'...' : pkg.name.padEnd(30);
    const dupMark = pkg.installCount > 1 ? chalk.red(` ×${pkg.installCount}`) : '';
    console.log(`${String(i+1).padStart(2)}. ${chalk.bold(name)} ${bar} ${chalk.yellow(size)}${dupMark} ${chalk.dim(pkg.category)}`);
  });
}

function topColor(i) {
  const colors = ['#667eea', '#48bb78', '#ed8936', '#4299e1', '#ed64a6', '#38b2ac', '#ecc94b', '#9f7aea', '#f56565', '#a0aec0'];
  return colors[i % colors.length];
}

function printDuplicates(scanResult, limit = 8) {
  if (!scanResult.duplicates?.length) {
    console.log(chalk.green('\n✅ 无重复依赖 — 依赖去重良好'));
    return;
  }
  console.log(chalk.bold.yellow(`\n♻️  重复依赖 (${scanResult.duplicates.length} 个)`));
  console.log(chalk.dim('─'.repeat(60)));
  const table = new Table({
    head: [chalk.bold('包名'), chalk.bold('次数'), chalk.bold('版本'), chalk.bold('浪费')],
    colWidths: [30, 8, 30, 12],
    style: { head: [] },
    wordWrap: true,
  });
  scanResult.duplicates.slice(0, limit).forEach(d => {
    table.push([
      chalk.cyan(d.packageName),
      chalk.red(d.count + '×'),
      d.versions.join(', ').slice(0, 28),
      chalk.yellow(formatBytes(d.wastedSize)),
    ]);
  });
  console.log(table.toString());
  if (scanResult.duplicates.length > limit) console.log(chalk.dim(`  ... 还有 ${scanResult.duplicates.length - limit} 个，完整列表请查看 HTML/JSON 报告`));
  console.log(chalk.dim('  💡 建议: 使用 overrides/resolutions 统一版本，或迁移到 pnpm'));
}

function printBloat(scanResult, limit = 8) {
  if (!scanResult.bloat?.length) {
    console.log(chalk.green('\n✅ 无膨胀包'));
    return;
  }
  console.log(chalk.bold.magenta(`\n🐘 膨胀包 (${scanResult.bloat.length} 个)`));
  console.log(chalk.dim('─'.repeat(60)));
  const table = new Table({
    head: [chalk.bold('包名'), chalk.bold('体积'), chalk.bold('文件'), chalk.bold('级别'), chalk.bold('原因')],
    colWidths: [28, 12, 8, 10, 36],
    style: { head: [] },
    wordWrap: true,
  });
  scanResult.bloat.slice(0, limit).forEach(b => {
    const sev = b.severity === 'critical' ? chalk.red(b.severity) : b.severity === 'warning' ? chalk.yellow(b.severity) : chalk.cyan(b.severity);
    table.push([chalk.cyan(b.name), chalk.yellow(b.sizeFormatted), b.fileCount, sev, b.reason.slice(0,34)]);
  });
  console.log(table.toString());
}

function printSuggestions(scanResult) {
  if (!scanResult.suggestions?.length) return;
  console.log(chalk.bold.blue(`\n💡 优化建议 (${scanResult.suggestions.length} 条)`));
  console.log(chalk.dim('─'.repeat(60)));
  scanResult.suggestions.slice(0, 8).forEach((s, i) => {
    const icon = s.type === 'REPLACE' ? '🔄' : s.type === 'MIGRATION' ? '🚀' : s.type === 'CLEAN' ? '🧹' : '💡';
    console.log(`${icon} ${chalk.bold(`[${s.type}]`)} ${s.message}`);
    console.log(`   ${chalk.dim('→')} ${s.suggestion}`);
    if (s.estimatedSavings) console.log(`   ${chalk.green('节省:')} ${s.estimatedSavings}${s.currentSize ? `  (当前: ${s.currentSize})` : ''}`);
    if (i < Math.min(7, scanResult.suggestions.length-1)) console.log('');
  });
}

function printSecurity(scanResult) {
  const sec = scanResult.security || [];
  if (!sec.length) {
    console.log(chalk.green('\n🔒 安全扫描: 未发现已知漏洞 ✅'));
    return;
  }
  console.log(chalk.bold.red(`\n🔒 安全问题 (${sec.length} 个)`));
  console.log(chalk.dim('─'.repeat(60)));
  sec.forEach(s => {
    const sev = s.severity === 'CRITICAL' ? chalk.bgRed.white(` ${s.severity} `) : s.severity === 'WARNING' ? chalk.bgYellow.black(` ${s.severity} `) : chalk.bgBlue.white(` ${s.severity} `);
    console.log(`${sev} ${chalk.bold(s.packageName || '')} — ${s.message}`);
    if (s.suggestion) console.log(`   ${chalk.dim('→')} ${s.suggestion}`);
  });
}

function printBundle(bundle) {
  if (!bundle) return;
  if (!bundle.found) {
    console.log(chalk.dim(`\n📦 Bundle: ${bundle.message}`));
    return;
  }
  console.log(chalk.bold.cyan('\n📦 Bundle 产物分析'));
  console.log(chalk.dim('─'.repeat(60)));
  bundle.outputs.forEach(o => {
    console.log(`  ${chalk.bold(o.dir)} — ${chalk.yellow(o.totalFormatted)} (${o.jsCount} JS, ${o.cssCount} CSS)`);
    o.largestFiles.slice(0, 5).forEach(f => {
      console.log(`    ${formatBytes(f.size).padStart(9)}  ${chalk.dim(f.file)}`);
    });
    console.log(`  ${chalk.dim('→')} ${o.suggestion}`);
  });
}

function printFullReport(scanResult) {
  printSummary(scanResult);
  if (scanResult.exists) {
    printTopPackages(scanResult, 10);
    printDuplicates(scanResult);
    printBloat(scanResult);
    printSuggestions(scanResult);
    printSecurity(scanResult);
    printBundle(scanResult.bundle);
    console.log(chalk.dim('\n─'.repeat(60)));
    console.log(chalk.dim('  完整报告: ') + chalk.cyan('.nodeslim/reports/latest.html') + chalk.dim(' | ') + chalk.cyan('latest.json') + chalk.dim(' | ') + chalk.cyan('latest.md'));
    console.log(chalk.bold.green('\n✨ 提示: 运行 ') + chalk.bold.white('nodeslim optimize --clean --dry-run') + chalk.bold.green(' 预览清理  |  ') + chalk.bold.white('nodeslim dashboard') + chalk.bold.green(' 启动可视化面板\n'));
  } else {
    printSuggestions(scanResult);
    console.log(chalk.yellow('\n  提示: 先运行 npm/pnpm/yarn install 安装依赖后可获得更完整的分析。\n'));
  }
}

module.exports = { printSummary, printTopPackages, printDuplicates, printBloat, printSuggestions, printSecurity, printFullReport };
