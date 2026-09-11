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

  const spinner = ora(`正在扫描 ${chalk.cyan(target)} ...`).start();
  let result;
  try {
    result = await scanProject(target, {
      config,
      maxDepth: opts.depth ? parseInt(opts.depth, 10) : undefined,
      onProgress: (n) => { spinner.text = `正在扫描 ... 已发现 ${n} 文件`; },
    });

    // enrich with security & bundle
    if (result.packages?.length) {
      result.security = scanSecurity(result.packages);
      result.issues = [...(result.issues || []), ...result.security];
    }
    result.bundle = analyzeBundle(target);

    spinner.succeed(`扫描完成！发现 ${chalk.bold(result.totalPackages)} 个包，总体积 ${chalk.bold(formatBytes(result.totalSize))} ${result.exists ? '' : chalk.yellow('(仅 package.json 分析)')}`);

    // Handle output formats
    if (output === 'json') {
      if (saveReportFlag) {
        const { path: p } = await saveJsonReport(result, { outputDir: path.join(target, '.nodeslim/reports') });
        console.log(JSON.stringify(result.packages ? { summary: result.summary || { totalPackages: result.totalPackages, totalSize: result.totalSize }, packages: result.packages } : result, null, 2));
        console.log(chalk.green(`\n✅ JSON 报告已保存: ${p}`));
      } else {
        // just print json to stdout
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

    // terminal (default)
    terminal.printFullReport(result);

    if (saveReportFlag) {
      const results = await saveAllReports(result, { outputDir: path.join(target, '.nodeslim/reports') });
      console.log(chalk.green(`\n✅ 报告已保存:`));
      console.log(`   JSON: ${chalk.cyan(results.json.path)}`);
      console.log(`   HTML: ${chalk.cyan(results.html.path)}`);
      console.log(`   Markdown: ${chalk.cyan(results.markdown.path)}`);
    } else {
      // still save latest.json silently for dashboard
      try {
        await saveJsonReport(result, { outputDir: path.join(target, '.nodeslim/reports') });
        console.log(chalk.dim(`\n  (已静默保存快照到 .nodeslim/reports/latest.json — dashboard 可直接读取)`));
      } catch {}
    }

    // threshold check
    const thresholdMB = config.thresholds?.totalSizeMB;
    if (thresholdMB && result.totalSize > thresholdMB * 1024 * 1024) {
      console.log(chalk.yellow(`\n⚠️  体积超出阈值: ${formatBytes(result.totalSize)} > ${thresholdMB}MB (配置于 .nodeslimrc.json)`));
      if (config.ci?.failOnThreshold) {
        // don't exit with error by default for CLI, just warn
      }
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
