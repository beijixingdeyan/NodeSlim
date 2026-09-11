#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const MAX_SIZE_MB = parseInt(process.env.MAX_SIZE_MB || '100', 10);
const target = process.argv[2] || process.cwd();

function getFolderSize(folderPath) {
  let size = 0;
  const files = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const file of files) {
    const filePath = path.join(folderPath, file.name);
    try {
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        if (file.name === '.cache' || file.name === '.bin') continue;
        size += getFolderSize(filePath);
      } else {
        size += stats.size;
      }
    } catch {}
  }
  return size;
}

const nmPath = path.join(path.resolve(target), 'node_modules');
if (!fs.existsSync(nmPath)) {
  console.log('node_modules 不存在，跳过体积检查（可能是 CI 缓存未安装）');
  process.exit(0);
}
const size = getFolderSize(nmPath);
const sizeMB = size / 1024 / 1024;
console.log(`node_modules size: ${sizeMB.toFixed(2)} MB (threshold ${MAX_SIZE_MB}MB)`);
if (sizeMB > MAX_SIZE_MB) {
  console.error(`❌ ERROR: node_modules exceeds ${MAX_SIZE_MB}MB limit!`);
  console.error(`   建议: 运行 nodeslim scan 查看明细，或 nodeslim optimize --clean --dry-run`);
  process.exit(1);
}
console.log('✅ Size check passed');
