'use strict';
const fs = require('fs');
const path = require('path');
const ora = require('ora');
const chalk = require('chalk');
const { scanProject } = require('../scanner');
const { loadConfig } = require('../utils/config');
const { saveAllReports, saveJsonReport, saveHtmlReport, saveMarkdownReport, terminal } = require('../reporter');
const { scanSecurity } = require('../analyzer/security-scanner');
const { analyzeBundle } = require('../analyzer/bundle-analyzer');

async function scanAction(opts) {
  const target = path.resolve(opts.target || process.cwd());
  const { config } = loadConfig(target);

  const output = (opts.output || 'terminal').toLowerCase();
  const saveReportFlag = opts.saveReport || opts.save || output !== 'terminal';
  const isShallow = opts.shallow || opts.quick;

  const spinner = ora(`正在${isShallow ? '少扫描' : '扫描'} ${chalk.cyan(target)} ${isShallow ? chalk.dim('(仅 package.json/lockfile, 秒级)') : ''}...`).start();
  let result;
  try {
    if (isShallow) {
      const { shallowScan } = require('../analyzer/shallow-scanner');
      const shallow = shallowScan(target);
      const { getSuggestions } = require('../analyzer/suggestions');
      const pkgs = shallow.packages;
      const suggestions = getSuggestions(pkgs);
      result = {
        root: target,
        nodeModulesPath: null,
        exists: false,
        shallow: true,
        isEstimated: true,
        packages: pkgs,
        totalPackages: pkgs.length,
        totalSize: shallow.totalSize,
        totalFiles: 0,
        duplicates: [],
        bloat: [],
        issues: [],
        suggestions,
        wastedSize: 0,
        optimizableSize: shallow.totalSize * 0.2,
        packageManager: shallow.lockInfo?.type || 'unknown',
        pkgJson: shallow.pj,
        lock: shallow.lockInfo,
        summary: { totalPackages: pkgs.length, totalSize: shallow.totalSize, totalFiles: 0, duplicateCount: 0, bloatCount: 0, optimizableSize: shallow.totalSize*0.2, wastedSize: 0, isEstimated: true },
        scannedAt: shallow.scannedAt,
        warnings: shallow.warnings,
        meta: { root: target, packageManager: shallow.lockInfo?.type || 'unknown', generatedAt: new Date().toISOString(), version: require('../../package.json').version },
      };
      result.bundle = analyzeBundle(target);
      spinner.succeed(`少扫描完成！发现 ${chalk.bold(result.totalPackages)} 个声明依赖，估算总体积 ${chalk.bold(formatBytes(result.totalSize))} ${chalk.dim('(无需 node_modules)')}`);
      if (shallow.warnings?.length) shallow.warnings.forEach(w => console.log(chalk.yellow('  ⚠️ ' + w)));
    } else {
      result = await scanProject(target, {
        config,
        maxDepth: opts.depth ? parseInt(opts.depth, 10) : undefined,
        onProgress: (n) => { spinner.text = `正在扫描 ... 已发现 ${n} 文件`; },
      });
      if (result.packages?.length) {
        result.security = scanSecurity(result.packages);
        result.issues = [...(result.issues || []), ...result.security];
      }
      result.bundle = analyzeBundle(target);
      // enrich with prod/platform for terminal summary count
      try {
        const { analyzeProdVsDev } = require('../analyzer/prod-analyzer');
        result.prod = analyzeProdVsDev(target, result.packages || []);
      } catch {}
      spinner.succeed(`扫描完成！发现 ${chalk.bold(result.totalPackages)} 个包，总体积 ${chalk.bold(formatBytes(result.totalSize))} ${result.exists ? '' : chalk.yellow('(仅 package.json 分析)')}`);
    }

    // Handle output formats
    if (output === 'json') {
      if (saveReportFlag) {
        const { path: p } = await saveJsonReport(result, { outputDir: path.join(target, '.nodeslim/reports') });
        console.log(JSON.stringify(result.packages ? { summary: result.summary || { totalPackages: result.totalPackages, totalSize: result.totalSize }, packages: result.packages } : result, null, 2));
        console.log(chalk.green(`\n✅ JSON 报告已保存: ${p}`));
      } else {
        const { buildReport } = require('../reporter/json-reporter');
        console.log(JSON.stringify(buildReport(result), null, 2));
      }
      return result;
    }

    if (output === 'html') {
      const { path: p } = await saveHtmlReport(result, { outputDir: path.join(target, '.nodeslim/reports') });
      console.log(chalk.green(`✅ HTML 报告已生成: ${p}`));
      console.log(chalk.dim(`   用浏览器打开查看完整可视化`));
      terminal.printFullReport(result);
      return result;
    }

    if (output === 'md' || output === 'markdown') {
      const { path: p } = await saveMarkdownReport(result, { outputDir: path.join(target, '.nodeslim/reports') });
      console.log(chalk.green(`✅ Markdown 报告已生成: ${p}`));
      terminal.printFullReport(result);
      return result;
    }

    terminal.printFullReport(result);

    if (saveReportFlag) {
      const results = await saveAllReports(result, { outputDir: path.join(target, '.nodeslim/reports') });
      console.log(chalk.green(`\n✅ 报告已保存:`));
      console.log(`   JSON: ${chalk.cyan(results.json.path)}`);
      console.log(`   HTML: ${chalk.cyan(results.html.path)}`);
      console.log(`   Markdown: ${chalk.cyan(results.markdown.path)}`);
    } else {
      try {
        await saveJsonReport(result, { outputDir: path.join(target, '.nodeslim/reports') });
        console.log(chalk.dim(`\n  (已静默保存快照到 .nodeslim/reports/latest.json — dashboard 可直接读取)`));
      } catch {}
    }

    const thresholdMB = config.thresholds?.totalSizeMB;
    if (thresholdMB && result.totalSize > thresholdMB * 1024 * 1024) {
      console.log(chalk.yellow(`\n⚠️  体积超出阈值: ${formatBytes(result.totalSize)} > ${thresholdMB}MB (配置于 .nodeslimrc.json)`));
    }

    return result;
  } catch (err) {
    spinner.fail(chalk.red(`扫描失败: ${err.message}`));
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes)/Math.log(k));
  return `${parseFloat((bytes/Math.pow(k,i)).toFixed(2))} ${sizes[i]}`;
}

module.exports = { scanAction };
