'use strict';
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const { initConfig, loadConfig } = require('../utils/config');

async function configAction(subcmd, key, value) {
  // commander passes subcmd as first arg when we define `config <action>`
  const action = String(subcmd || '').toLowerCase();
  const target = process.cwd();

  if (action === 'init') {
    const res = initConfig(target);
    if (res.created) console.log(chalk.green(`✅ 已创建配置文件: ${chalk.cyan(res.path)}`));
    else console.log(chalk.yellow(`⚠️  配置已存在: ${res.path}`));
    console.log(chalk.dim('  编辑阈值、清理规则等后重新运行 scan 生效'));
    return;
  }

  if (action === 'get') {
    const { config, path: p } = loadConfig(target);
    if (!p) { console.log(chalk.yellow('未找到配置文件，使用默认配置')); console.log(JSON.stringify(config, null, 2)); return; }
    if (!key) {
      console.log(chalk.dim(`配置文件: ${p}\n`));
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    const val = getByPath(config, key);
    if (val === undefined) console.log(chalk.red(`未找到键: ${key}`));
    else console.log(chalk.cyan(key) + ' = ' + chalk.green(JSON.stringify(val, null, 2)));
    return;
  }

  if (action === 'set') {
    if (!key) { console.log(chalk.red('用法: nodeslim config set <key> <value>')); return; }
    const { config, path: p } = loadConfig(target);
    if (!p) { console.log(chalk.red('未找到配置文件，先运行 nodeslim config init')); return; }
    let parsedValue;
    try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }
    setByPath(config, key, parsedValue);
    fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
    console.log(chalk.green(`✅ 已更新 ${key} = ${JSON.stringify(parsedValue)}`));
    console.log(chalk.dim(`  文件: ${p}`));
    return;
  }

  if (action === 'path') {
    const { path: p } = loadConfig(target);
    console.log(p || '(not found, using defaults)');
    return;
  }

  console.log(chalk.bold.cyan('nodeslim config 用法:'));
  console.log(`  ${chalk.cyan('nodeslim config init')}              创建 .nodeslimrc.json`);
  console.log(`  ${chalk.cyan('nodeslim config get')}                 查看完整配置`);
  console.log(`  ${chalk.cyan('nodeslim config get <key>')}           查看某项配置 e.g. thresholds.totalSizeMB`);
  console.log(`  ${chalk.cyan('nodeslim config set <key> <val>')}     修改配置 e.g. config set thresholds.totalSizeMB 200`);
  console.log(`  ${chalk.cyan('nodeslim config path')}               查看配置文件路径`);
}

function getByPath(obj, p) {
  return p.split('.').reduce((o,k)=> o?.[k], obj);
}
function setByPath(obj, p, val) {
  const parts = p.split('.');
  let cur = obj;
  for (let i=0;i<parts.length-1;i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length-1]] = val;
}

module.exports = { configAction };
