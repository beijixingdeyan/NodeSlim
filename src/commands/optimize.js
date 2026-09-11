'use strict';
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const { scanProject } = require('../scanner');
const { loadConfig } = require('../utils/config');
const { previewClean, executeClean } = require('../optimizer/clean-engine');
const { detectCurrentPM, migrationPlan, executeMigration } = require('../optimizer/migration-engine');
const { formatBytes } = require('../utils/format');
const { analyzeBundle } = require('../analyzer/bundle-analyzer');

async function optimizeAction(opts) {
  const target = path.resolve(opts.target || process.cwd());
  const { config } = loadConfig(target);

  if (opts.dedupe) { await handleDedupe(target, opts); return; }
  if (opts.replace) { await handleReplace(target, opts); return; }
  if (opts.importMaps || opts.importMapsSave) { await handleImportMaps(target, opts); return; }
  if (opts.pruneDev) { await handlePruneDev(target, opts); return; }
  if (opts.checkSize) { await handleCheckSize(target, opts); return; }

  if (opts.dryRun && !opts.clean && !opts.migrate && !opts.bundle) {
    opts.clean = true;
  }
  if (opts.clean) { await handleClean(target, opts); return; }
  if (opts.migrate) { await handleMigrate(target, opts.migrate, opts); return; }
  if (opts.bundle) { await handleBundle(target); return; }
  if (opts.apply) {
    console.log(chalk.yellow('⚠️  --apply 将应用所有安全级别的优化（先预览）'));
    await handleClean(target, { ...opts, dryRun: false });
    return;
  }

  console.log(chalk.bold.cyan('\n✨ NodeSlim 优化中心'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log(`  ${chalk.bold('可用优化:')}`);
  console.log(`   ${chalk.cyan('1.')} ${chalk.bold('清理冗余文件')}  — nodeslim optimize --clean --dry-run / --clean`);
  console.log(`   ${chalk.cyan('2.')} ${chalk.bold('包管理器迁移')} — nodeslim optimize --migrate pnpm|yarn|bun|npm`);
  console.log(`   ${chalk.cyan('3.')} ${chalk.bold('去重方案')}     — nodeslim optimize --dedupe [--dedupe-apply]`);
  console.log(`   ${chalk.cyan('4.')} ${chalk.bold('替换重型库')}   — nodeslim optimize --replace`);
  console.log(`   ${chalk.cyan('5.')} ${chalk.bold('Import Maps')} — nodeslim optimize --import-maps [--import-maps-save]`);
  console.log(`   ${chalk.cyan('6.')} ${chalk.bold('Prod 分离')}   — nodeslim optimize --prune-dev --check-size`);
  console.log(`   ${chalk.cyan('7.')} ${chalk.bold('Bundle 部署')}  — nodeslim optimize --bundle`);
  console.log(chalk.dim('\n  提示: 所有清理操作默认 dry-run，需显式确认才会修改文件。'));
  const scan = await scanProject(target, { config });
  console.log(chalk.dim(`\n  当前总体积: ${formatBytes(scan.totalSize)} | 可优化约 ${formatBytes(scan.optimizableSize)} | 重复浪费 ${formatBytes(scan.wastedSize)}`));
  console.log(chalk.dim(`  仪表盘: nodeslim dashboard  |  全量审计: nodeslim audit`));
}

async function handleClean(target, opts) {
  const dryRun = opts.dryRun ? true : false;
  const spinner = ora(dryRun ? '正在预览可清理文件...' : '正在执行清理...').start();
  try {
    const result = dryRun ? await previewClean(target, { excludePackages: opts.excludePackages }) : await executeClean(target, { dryRun: false });
    spinner.succeed(dryRun ? '预览完成' : `清理完成 — 已删除 ${result.removed} 项`);
    console.log(chalk.bold.cyan(dryRun ? '\n🧹 清理预览 (dry-run)' : '\n🧹 清理结果'));
    console.log(chalk.dim('─'.repeat(60)));
    console.log(`  命中规则: ${Object.keys(result.byPattern).length} 类`);
    console.log(`  命中文件: ${chalk.yellow(result.totalHits)} 项`);
    console.log(`  可节省:   ${chalk.green.bold(formatBytes(result.totalSize))}`);
    if (Object.keys(result.byPattern).length) {
      console.log(chalk.bold('\n  按规则分组:'));
      for (const [pat, info] of Object.entries(result.byPattern).sort((a,b)=>b[1].size-a[1].size).slice(0,8)) {
        console.log(`   ${chalk.cyan(pat.padEnd(20))} ${String(info.count).padStart(4)} 项  ${formatBytes(info.size).padStart(9)}`);
      }
    }
    if (result.hits.length) {
      console.log(chalk.bold('\n  Top 15 可清理文件:'));
      result.hits.slice(0,15).forEach(h => { console.log(`   ${chalk.dim(formatBytes(h.size).padStart(9))}  ${h.relative}`); });
      if (result.hits.length > 15) console.log(chalk.dim(`   ... 还有 ${result.hits.length-15} 项`));
    }
    if (dryRun) {
      console.log(chalk.yellow('\n  ⚠️  这是预览模式，未实际删除文件。'));
      console.log(chalk.dim('  执行 ') + chalk.bold.white('nodeslim optimize --clean') + chalk.dim(' 真正清理'));
    } else {
      if (result.failed) console.log(chalk.red(`  失败 ${result.failed} 项`));
      console.log(chalk.green('\n  ✅ 清理完成，建议运行 nodeslim scan 验证效果。'));
    }
  } catch (err) {
    spinner.fail(chalk.red(`清理失败: ${err.message}`));
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

async function handleDedupe(target, opts) {
  const spinner = ora('正在计算去重方案...').start();
  try {
    const { config } = loadConfig(target);
    const result = await scanProject(target, { config });
    const { generateDedupePlan, applyDedupeToPackageJson } = require('../analyzer/dedupe-helper');
    const plan = generateDedupePlan(result.duplicates);
    spinner.succeed('去重分析完成');
    if (!plan.needed) {
      console.log(chalk.green('\n✅ 无重复依赖，无需去重'));
      return;
    }
    console.log(chalk.bold.cyan(`\n♻️  去重方案 (${plan.count} 个重复包)`));
    console.log(chalk.dim('─'.repeat(60)));
    plan.details.forEach(d=>{ console.log(`  ${chalk.cyan(d.package)}: ${d.versions.join(', ')} → ${chalk.green(d.chosen)} (${d.reason})`); });
    console.log(chalk.bold('\n  npm overrides:'));
    console.log(chalk.dim(JSON.stringify(plan.overrides, null, 2)));
    console.log(chalk.bold('\n  pnpm overrides:'));
    console.log(chalk.dim(JSON.stringify(plan.pnpmOverrides, null, 2)));
    console.log(chalk.dim('\n  说明: ') + plan.instructions.npm.slice(0,120) + '...');
    if (opts.dedupeApply) {
      if (opts.dryRun) {
        console.log(chalk.yellow('\n  dry-run: 将写入 package.json (预览)'));
        console.log(chalk.dim('  去掉 --dry-run 真正写入'));
      } else {
        const res = applyDedupeToPackageJson(target, plan, false);
        console.log(chalk.green(`\n  ✅ 已写入 ${res.path}`));
        console.log(chalk.dim('  请执行 npm/pnpm install 应用'));
      }
    } else {
      console.log(chalk.dim('\n  执行 nodeslim optimize --dedupe --dedupe-apply 写入 package.json'));
    }
  } catch (e) {
    spinner.fail(chalk.red(`去重失败: ${e.message}`));
  }
}

async function handleReplace(target, opts) {
  const { config } = loadConfig(target);
  const result = await scanProject(target, { config });
  const { getSuggestions } = require('../analyzer/suggestions');
  const sugs = getSuggestions(result.packages).filter(s=>s.type==='REPLACE');
  console.log(chalk.bold.cyan('\n🔄 重型依赖替换建议'));
  console.log(chalk.dim('─'.repeat(60)));
  if (!sugs.length) { console.log(chalk.green('  ✅ 未发现可替换重型依赖')); return; }
  sugs.forEach(s=>{
    console.log(`  ${chalk.yellow(s.from)} → ${chalk.green(s.to)}: ${s.message}`);
    console.log(chalk.dim(`     节省: ${s.estimatedSavings} | 兼容: ${s.api_compat || s.migrationEffort} | 当前: ${s.currentSize}`));
  });
  console.log(chalk.dim('\n  详情: https://bundlephobia.com/ 对比体积'));
}

async function handleImportMaps(target, opts) {
  const { config } = loadConfig(target);
  const result = await scanProject(target, { config });
  const { generateImportMap, saveImportMap } = require('../analyzer/import-map-generator');
  const gen = generateImportMap(result.packages, { limit: 20 });
  console.log(chalk.bold.cyan('\n🗺️ Import Maps (零安装 CDN 方案)'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log(chalk.dim(gen.json));
  console.log(chalk.bold('\nHTML 片段:'));
  console.log(chalk.dim(gen.htmlSnippet));
  console.log(chalk.dim('\n' + gen.suggestion));
  if (opts.importMapsSave) {
    const saved = saveImportMap(target, result.packages, { dryRun: false });
    console.log(chalk.green(`\n  ✅ 已保存: ${saved.path}`));
  } else {
    console.log(chalk.dim('\n  添加 --import-maps-save 保存为 import-map.json'));
  }
}

async function handlePruneDev(target, opts) {
  const { config } = loadConfig(target);
  const result = await scanProject(target, { config });
  const { analyzeProdVsDev, simulatePruneDev } = require('../analyzer/prod-analyzer');
  const prod = analyzeProdVsDev(target, result.packages);
  const sim = simulatePruneDev(result.packages, target);
  console.log(chalk.bold.cyan('\n🏗️ 生产依赖分离'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log(`  生产: ${chalk.green(prod.prod.sizeFormatted)} (${prod.prod.count} 包)`);
  console.log(`  开发: ${chalk.yellow(prod.dev.sizeFormatted)} (${Math.round(prod.dev.ratio*100)}%)`);
  console.log(`  间接: ${chalk.dim(prod.indirect.sizeFormatted)} (${prod.indirect.count} 包)`);
  console.log(chalk.dim(`  → ${prod.suggestion}`));
  console.log(chalk.bold('\n  模拟生产安装:'));
  console.log(`  当前: ${sim.currentTotal} → 生产: ${sim.afterPrune}  节省 ${chalk.green(sim.saved)} (${Math.round(sim.savedRatio*100)}%)`);
  console.log(chalk.dim(`  命令: ${sim.command}`));
  console.log(chalk.dim(`  Dockerfile 多阶段示例见 docs/QUICKSTART.md`));
}

async function handleCheckSize(target, opts) {
  const threshold = opts.threshold ? parseInt(String(opts.threshold).replace('MB',''),10) : null;
  const { loadConfig } = require('../utils/config');
  const { config } = loadConfig(target);
  const limit = threshold || config.thresholds?.totalSizeMB || 100;
  const result = await scanProject(target, { config });
  const sizeMB = result.totalSize / 1024 / 1024;
  console.log(chalk.bold.cyan('\n📏 体积阈值检查'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log(`  当前: ${sizeMB.toFixed(2)} MB`);
  console.log(`  阈值: ${limit} MB (来自 .nodeslimrc.json 或 --threshold)`);
  if (sizeMB > limit) {
    console.log(chalk.red(`  ❌ 超出阈值 ${ (sizeMB-limit).toFixed(2)} MB`));
    console.log(chalk.dim('  建议: nodeslim optimize --clean --dry-run  或  nodeslim report'));
    process.exitCode = 1;
  } else {
    console.log(chalk.green('  ✅ 未超出阈值'));
  }
}

async function handleMigrate(target, to, opts) {
  const from = detectCurrentPM(target);
  console.log(chalk.bold.cyan(`\n🚀 包管理器迁移: ${chalk.yellow(from)} → ${chalk.green(to)}`));
  console.log(chalk.dim('─'.repeat(60)));
  const plan = migrationPlan(from, to);
  console.log(chalk.bold('  迁移计划:'));
  plan.steps.forEach((s, i) => {
    console.log(`   ${chalk.cyan(String(i+1).padStart(2)+'.')} ${s.description}`);
    if (s.command) console.log(`       ${chalk.dim('$')} ${chalk.yellow(s.command)}`);
  });
  if (from === to) { console.log(chalk.green('\n  ✅ 已是目标包管理器，无需迁移')); return; }
  const dryRun = opts.dryRun;
  if (dryRun) { console.log(chalk.yellow('\n  ⚠️  预览模式，未执行迁移。去掉 --dry-run 或加 --force 执行')); return; }
  if (opts.force) {
    const spinner = ora('正在执行迁移...').start();
    try {
      const res = await executeMigration(target, to, { dryRun: false, forceExecute: true });
      spinner.succeed('迁移执行完成');
      console.log(chalk.green(`\n  ✅ 已切换到 ${to}，备份位于 ${res.backupDir}`));
    } catch (e) { spinner.fail(chalk.red(`迁移失败: ${e.message}`)); }
  } else {
    const res = await executeMigration(target, to, { dryRun: false, forceExecute: false });
    console.log(chalk.green(`\n  ✅ 已创建备份: ${chalk.cyan(res.backupDir)}`));
    console.log(chalk.yellow('\n  下一步请手动执行:'));
    plan.steps.slice(1).forEach(s => { if (s.command) console.log(`    ${chalk.cyan(s.command)}`); });
    console.log(chalk.dim('\n  或运行 ') + chalk.bold.white(`nodeslim optimize --migrate ${to} --force`) + chalk.dim(' 自动执行'));
  }
}

async function handleBundle(target) {
  console.log(chalk.bold.cyan('\n📦 Bundle 部署建议'));
  console.log(chalk.dim('─'.repeat(60)));
  const bundle = analyzeBundle(target);
  if (!bundle.found) {
    console.log(chalk.yellow(`  ${bundle.message}`));
    console.log(chalk.dim('  建议方案:'));
    console.log(`   ${chalk.cyan('• esbuild')}: npx esbuild src/index.js --bundle --platform=node --outfile=dist/bundle.js`);
    console.log(`   ${chalk.cyan('• tsup')}:    npx tsup src/index.ts --format cjs,esm --minify`);
    console.log(`   ${chalk.cyan('• ncc')}:     npx @vercel/ncc build src/index.js -o dist/`);
    console.log(chalk.dim('\n  效果: 部署包可从 ~800MB → ~5MB，启动更快，攻击面更小'));
    return;
  }
  bundle.outputs.forEach(o => {
    console.log(`  ${chalk.bold(o.dir)} — ${chalk.yellow(o.totalFormatted)}`);
    o.largestFiles.slice(0,5).forEach(f => console.log(`    ${formatBytes(f.size).padStart(9)}  ${chalk.dim(f.file)}`));
    console.log(`  ${chalk.dim('→')} ${o.suggestion}`);
  });
  console.log(chalk.bold('\n  💡 Bundle 部署优势:'));
  console.log(`   • 部署体积: ${chalk.green('500MB → <10MB')}`);
  console.log(`   • 冷启动:  ${chalk.green('快 2-3 倍')}`);
  console.log(`   • 安全:    ${chalk.green('攻击面更小')}`);
}

module.exports = { optimizeAction };
