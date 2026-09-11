'use strict';
const { program } = require('commander');
const chalk = require('chalk');
const pkg = require('../package.json');
const { scanAction } = require('./commands/scan');
const { analyzeAction } = require('./commands/analyze');
const { optimizeAction } = require('./commands/optimize');
const { reportAction } = require('./commands/report');
const { configAction } = require('./commands/config-cmd');
const { startDashboard } = require('./commands/dashboard');
const { auditAction } = require('./commands/audit');

const logo = `
  ${chalk.hex('#667eea').bold('███╗   ██╗ ██████╗ ██████╗ ███████╗███████╗██╗     ██╗███╗   ███╗')}
  ${chalk.hex('#764ba2').bold('████╗  ██║██╔═══██╗██╔══██╗██╔════╝██╔════╝██║     ██║████╗ ████║')}
  ${chalk.hex('#667eea').bold('██╔██╗ ██║██║   ██║██║  ██║███████╗███████╗██║     ██║██╔████╔██║')}
  ${chalk.hex('#764ba2').bold('██║╚██╗██║██║   ██║██║  ██║╚════██║╚════██║██║     ██║██║╚██╔╝██║')}
  ${chalk.hex('#667eea').bold('██║ ╚████║╚██████╔╝██████╔╝███████║███████║███████╗██║██║ ╚═╝ ██║')}
  ${chalk.dim('  从 850MB 到 50MB，一键诊断，智能优化  •  v' + pkg.version)}
`;

program
  .name('nodeslim')
  .description('NodeSlim — Node Modules 智能优化平台 (含轻量少扫描)')
  .version(pkg.version, '-v, --version', '查看版本')
  .helpOption('-h, --help', '查看帮助')
  .addHelpText('beforeAll', logo)
  .showHelpAfterError(true)
  .showSuggestionAfterError(true);

// scan — 支持 full/shallow
program
  .command('scan')
  .description('扫描 node_modules 体积与依赖 (支持 --shallow 少扫描)')
  .option('-t, --target <path>', '目标目录', process.cwd())
  .option('-d, --depth <n>', '依赖层级深度')
  .option('-o, --output <format>', '输出格式: terminal|json|html|md', 'terminal')
  .option('--save-report', '保存报告到 .nodeslim/reports/')
  .option('--save', '保存报告 (同 --save-report)')
  .option('--shallow', '少扫描：仅解析 package.json/lockfile，不遍历 node_modules (秒级)')
  .option('--quick', '同 --shallow')
  .option('--include-dev', '少扫描时包含 dev 统计')
  .action(scanAction);

// analyze — 扩展
program
  .command('analyze')
  .description('深度分析依赖关系 (含 unused/on-demand/esm/platform/prod)')
  .option('-t, --target <path>', '目标目录', process.cwd())
  .option('--duplicates', '只分析重复依赖')
  .option('--bloat', '只分析膨胀包')
  .option('--security', '只分析安全风险')
  .option('--unused', '检测未使用 & 幽灵依赖')
  .option('--on-demand', '检测按需加载问题 (lodash 全量等)')
  .option('--esm', '检测 ESM / tree-shaking')
  .option('--platform', '检测平台二进制冗余')
  .option('--prod', '分析生产 vs 开发依赖')
  .option('--depth <n>', '树深度预览')
  .option('--json', '以 JSON 输出')
  .action(analyzeAction);

// optimize — 扩展
program
  .command('optimize')
  .description('执行优化 (清理/迁移/Bundle/去重/import-maps)')
  .option('-t, --target <path>', '目标目录', process.cwd())
  .option('--dry-run', '模拟执行，不实际修改')
  .option('--clean', '清理冗余文件 (test/docs/*.md/*.map 等)')
  .option('--migrate <pm>', '迁移包管理器: npm|pnpm|yarn|bun')
  .option('--bundle', '建议 Bundle 部署方案')
  .option('--dedupe', '生成去重方案 (overrides/resolutions)')
  .option('--dedupe-apply', '应用去重方案到 package.json')
  .option('--replace', '显示重型依赖替换建议')
  .option('--import-maps', '生成 Import Maps (CDN 零安装)')
  .option('--import-maps-save', '生成并保存 import-map.json')
  .option('--prune-dev', '模拟移除 dev 依赖节省')
  .option('--check-size', '检查体积是否超阈值 (配合 .nodeslimrc.json)')
  .option('--apply', '应用所有安全级别的优化（需确认）')
  .option('--force', '强制执行迁移/去重（会修改文件）')
  .action(optimizeAction);

// audit
program
  .command('audit')
  .description('全量审计（安全+未使用+按需+ESM+平台+治理）')
  .option('-t, --target <path>', '目标目录', process.cwd())
  .option('--json', '以 JSON 输出')
  .action(auditAction);

// dashboard
program
  .command('dashboard')
  .alias('serve')
  .alias('web')
  .description('启动 Web 可视化面板 (支持文件夹导入少扫描)')
  .option('-p, --port <n>', '端口', '3000')
  .option('-t, --target <path>', '目标项目目录', process.cwd())
  .action(startDashboard);

// report
program
  .command('report')
  .description('生成/查看报告')
  .option('-t, --target <path>', '目标目录', process.cwd())
  .option('--history', '查看历史报告对比')
  .option('--export <format>', '导出格式: json|html|md|pdf')
  .action(reportAction);

// config
program
  .command('config <action> [key] [value]')
  .description('配置管理 (init|get|set|path)')
  .action(configAction);

// watch
program
  .command('watch')
  .description('监控 node_modules 变化 (实验性)')
  .option('-t, --target <path>', '目标目录', process.cwd())
  .option('--threshold <size>', '阈值告警, e.g. 100MB', '100MB')
  .action(async (opts) => {
    const chokidar = (() => { try { return require('chokidar'); } catch { return null; } })();
    const target = require('path').resolve(opts.target || process.cwd());
    const nmPath = require('path').join(target, 'node_modules');
    console.log(chalk.cyan(`👀 监控 ${nmPath} (阈值 ${opts.threshold}) — 按 Ctrl+C 退出`));
    if (!chokidar) {
      console.log(chalk.yellow('  未安装 chokidar，使用 fs.watch 简易监控'));
      const fs = require('fs');
      try {
        fs.watch(nmPath, { recursive: true }, (event, filename) => {
          console.log(chalk.dim(`[${new Date().toLocaleTimeString()}] ${event} ${filename || ''}`));
        });
        setInterval(()=>{}, 1000);
      } catch (e) {
        console.log(chalk.red(`监控失败: ${e.message}`));
      }
      return;
    }
    const watcher = chokidar.watch(nmPath, { ignored: /(^|[\/\\])\../, persistent: true, depth: 4 });
    watcher.on('all', (event, p) => {
      console.log(chalk.dim(`[${new Date().toLocaleTimeString()}] ${event} ${require('path').relative(target, p)}`));
    });
  });

// default: if no args, show help plus quick scan hint
if (process.argv.length === 2) {
  console.log(logo);
  program.outputHelp();
  console.log(chalk.bold.green('\n✨ 快速开始: ') + chalk.white('nodeslim scan') + chalk.dim('  — 一键扫描当前项目'));
  console.log(chalk.dim('  少扫描: ') + chalk.white('nodeslim scan --shallow') + chalk.dim('  — 秒级估算，无需 node_modules'));
  console.log(chalk.dim('  导入: ') + chalk.white('nodeslim dashboard') + chalk.dim('  — 浏览器拖拽 package.json / 文件夹进行少扫描'));
  console.log(chalk.dim('  更多: nodeslim scan --help  |  nodeslim audit  |  nodeslim optimize --clean --dry-run\n'));
} else {
  program.parse(process.argv);
}
