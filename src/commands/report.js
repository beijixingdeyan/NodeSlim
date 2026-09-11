'use strict';
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { scanProject } = require('../scanner');
const { loadConfig } = require('../utils/config');
const { saveAllReports, saveJsonReport, saveHtmlReport, saveMarkdownReport } = require('../reporter');

async function reportAction(opts) {
  const target = path.resolve(opts.target || process.cwd());
  const reportsDir = path.join(target, '.nodeslim/reports');

  if (opts.history) {
    // show history
    if (!fs.existsSync(reportsDir)) {
      console.log(chalk.yellow('暂无历史报告'));
      return;
    }
    const files = fs.readdirSync(reportsDir)
      .filter(f => f.startsWith('report-') && (f.endsWith('.json')||f.endsWith('.html')||f.endsWith('.md')))
      .map(f => {
        const full = path.join(reportsDir, f);
        const stat = fs.statSync(full);
        return { file: f, size: stat.size, mtime: stat.mtime, full };
      })
      .sort((a,b)=> b.mtime - a.mtime);

    console.log(chalk.bold.cyan('\n📜 历史报告'));
    console.log(chalk.dim('─'.repeat(60)));
    if (!files.length) console.log(chalk.dim('  无历史报告'));
    else files.slice(0,20).forEach(f => {
      console.log(`  ${chalk.cyan(f.file.padEnd(40))} ${chalk.dim(formatTime(f.mtime))}  ${(f.size/1024).toFixed(1)}KB`);
    });

    // try to compare latest two JSON reports
    const jsons = files.filter(f=>f.file.endsWith('.json')).slice(0,2);
    if (jsons.length === 2) {
      try {
        const a = JSON.parse(fs.readFileSync(jsons[1].full,'utf-8'));
        const b = JSON.parse(fs.readFileSync(jsons[0].full,'utf-8'));
        console.log(chalk.bold('\n📊 对比 (上次 → 本次):'));
        const diff = (b.summary.totalSize - a.summary.totalSize);
        console.log(`   总体积: ${formatBytes(a.summary.totalSize)} → ${formatBytes(b.summary.totalSize)}  ${diff>0?chalk.red(`+${formatBytes(diff)}`):chalk.green(formatBytes(diff))}`);
        console.log(`   包数量: ${a.summary.totalPackages} → ${b.summary.totalPackages}`);
      } catch {}
    }
    return;
  }

  if (opts.export) {
    const fmt = String(opts.export).toLowerCase();
    // regenerate from latest scan or fresh scan
    console.log(chalk.cyan(`正在生成 ${fmt} 报告...`));
    const { config } = loadConfig(target);
    const scanResult = await scanProject(target, { config });
    const { scanSecurity } = require('../analyzer/security-scanner');
    const { analyzeBundle } = require('../analyzer/bundle-analyzer');
    scanResult.security = scanSecurity(scanResult.packages||[]);
    scanResult.bundle = analyzeBundle(target);

    let res;
    if (fmt === 'pdf') {
      // We don't have PDF generation; fallback to HTML with print hint
      console.log(chalk.yellow('PDF 导出通过 HTML 打印实现（浏览器打开 HTML 后 Ctrl+P 保存为 PDF）'));
      res = await saveHtmlReport(scanResult, { outputDir: reportsDir });
      console.log(chalk.green(`✅ HTML 已生成: ${res.path} — 请用浏览器打开后打印为 PDF`));
    } else if (fmt === 'json') {
      res = await saveJsonReport(scanResult, { outputDir: reportsDir });
      console.log(chalk.green(`✅ JSON 报告: ${res.path}`));
    } else if (fmt === 'html') {
      res = await saveHtmlReport(scanResult, { outputDir: reportsDir });
      console.log(chalk.green(`✅ HTML 报告: ${res.path}`));
    } else if (fmt === 'md' || fmt === 'markdown') {
      res = await saveMarkdownReport(scanResult, { outputDir: reportsDir });
      console.log(chalk.green(`✅ Markdown 报告: ${res.path}`));
    } else {
      console.log(chalk.red(`未知格式: ${fmt}，支持 json/html/md/pdf`));
    }
    return;
  }

  // default: generate latest report (full)
  console.log(chalk.cyan('正在生成最新报告...'));
  const { config } = loadConfig(target);
  const scanResult = await scanProject(target, { config });
  const { scanSecurity } = require('../analyzer/security-scanner');
  const { analyzeBundle } = require('../analyzer/bundle-analyzer');
  scanResult.security = scanSecurity(scanResult.packages||[]);
  scanResult.bundle = analyzeBundle(target);

  const results = await saveAllReports(scanResult, { outputDir: reportsDir });
  console.log(chalk.green('\n✅ 报告已生成:'));
  console.log(`   JSON:     ${chalk.cyan(results.json.path)}`);
  console.log(`   HTML:     ${chalk.cyan(results.html.path)}`);
  console.log(`   Markdown: ${chalk.cyan(results.markdown.path)}`);
  console.log(chalk.dim(`\n  用浏览器打开 HTML 查看可视化，或运行 nodeslim dashboard 启动面板`));
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k=1024, sizes=['B','KB','MB','GB'];
  const i=Math.floor(Math.log(bytes)/Math.log(k));
  return `${parseFloat((bytes/Math.pow(k,i)).toFixed(2))} ${sizes[i]}`;
}
function formatTime(d) {
  return d.toLocaleString('zh-CN');
}

module.exports = { reportAction };
