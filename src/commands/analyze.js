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
    spinner.succeed('分析完成');

    const onlyDuplicates = opts.duplicates;
    const onlyBloat = opts.bloat;
    const onlySecurity = opts.security;

    if (onlyDuplicates) {
      console.log(chalk.bold.cyan('\n♻️  重复依赖分析'));
      terminal.printDuplicates(result);
      if (!result.duplicates.length) console.log(chalk.dim('  Tip: 重复依赖为 0，说明包管理器去重良好（pnpm 天然有此优势）'));
      return;
    }
    if (onlyBloat) {
      console.log(chalk.bold.cyan('\n🐘 膨胀包分析'));
      terminal.printBloat(result);
      terminal.printSuggestions(result);
      return;
    }
    if (onlySecurity) {
      console.log(chalk.bold.cyan('\n🔒 安全扫描'));
      terminal.printSecurity(result);
      terminal.printDuplicates(result); // also show duplicates as they may cause security issues
      return;
    }

    // Full analysis: print everything plus tree preview
    terminal.printFullReport(result);
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
