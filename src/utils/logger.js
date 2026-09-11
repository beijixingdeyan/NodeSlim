'use strict';
const chalk = require('chalk');

const logger = {
  info: (msg) => console.log(chalk.cyan('ℹ'), msg),
  success: (msg) => console.log(chalk.green('✔'), msg),
  warn: (msg) => console.log(chalk.yellow('⚠'), msg),
  error: (msg) => console.log(chalk.red('✖'), msg),
  title: (msg) => console.log(chalk.bold.cyan('\n' + msg)),
  dim: (msg) => console.log(chalk.dim(msg)),
  raw: (...args) => console.log(...args),
};

module.exports = logger;
