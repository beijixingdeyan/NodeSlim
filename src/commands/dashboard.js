'use strict';
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { scanProject } = require('../scanner');
const { loadConfig } = require('../utils/config');
const { saveAllReports } = require('../reporter');

function startDashboard(opts) {
  const port = parseInt(opts.port || '3000', 10);
  const target = path.resolve(opts.target || process.cwd());

  // Lazy require server so CLI still works if dependencies missing
  let server;
  try {
    server = require('../server');
  } catch (e) {
    console.log(chalk.red(`Dashboard 依赖缺失: ${e.message}`));
    console.log(chalk.dim('尝试运行: npm install'));
    process.exit(1);
  }

  // Ensure reports exist
  const reportsDir = path.join(target, '.nodeslim/reports');
  if (!fs.existsSync(path.join(reportsDir, 'latest.json'))) {
    console.log(chalk.yellow('未找到最新报告，正在快速扫描...'));
    // don't block startup; do async scan
    (async () => {
      try {
        const { config } = loadConfig(target);
        const result = await scanProject(target, { config });
        const { scanSecurity } = require('../analyzer/security-scanner');
        const { analyzeBundle } = require('../analyzer/bundle-analyzer');
        result.security = scanSecurity(result.packages||[]);
        result.bundle = analyzeBundle(target);
        await saveAllReports(result, { outputDir: reportsDir });
        console.log(chalk.green('  初始报告已生成'));
      } catch (err) {
        console.log(chalk.red(`  初始扫描失败: ${err.message}`));
      }
    })();
  }

  server.start({ port, target });
}

module.exports = { startDashboard };
