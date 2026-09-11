'use strict';
const fs = require('fs');
const path = require('path');
const { formatBytes } = require('../utils/format');

function analyzeProdVsDev(projectRoot, packages) {
  const pjPath = path.join(projectRoot, 'package.json');
  let pj = {};
  try { pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8')); } catch {}
  const deps = new Set(Object.keys(pj.dependencies || {}));
  const devDeps = new Set(Object.keys(pj.devDependencies || {}));
  const peer = new Set(Object.keys(pj.peerDependencies || {}));
  const opt = new Set(Object.keys(pj.optionalDependencies || {}));

  let prodSize = 0, devSize = 0, peerSize = 0, indirectSize = 0;
  let prodCount = 0, devCount = 0, indirectCount = 0;
  const prodPkgs = [], devPkgs = [], indirectPkgs = [];

  for (const p of packages) {
    if (deps.has(p.name) || opt.has(p.name)) {
      prodSize += p.size; prodCount++; prodPkgs.push(p);
    } else if (devDeps.has(p.name)) {
      devSize += p.size; devCount++; devPkgs.push(p);
    } else if (peer.has(p.name)) {
      peerSize += p.size;
    } else {
      indirectSize += p.size; indirectCount++; indirectPkgs.push(p);
    }
  }
  const total = prodSize + devSize + peerSize + indirectSize;
  const devRatio = total ? devSize / total : 0;

  return {
    prod: { count: prodCount, size: prodSize, sizeFormatted: formatBytes(prodSize), pkgs: prodPkgs.sort((a,b)=>b.size-a.size).slice(0,10) },
    dev: { count: devCount, size: devSize, sizeFormatted: formatBytes(devSize), pkgs: devPkgs.sort((a,b)=>b.size-a.size).slice(0,10), ratio: devRatio },
    indirect: { count: indirectCount, size: indirectSize, sizeFormatted: formatBytes(indirectSize), pkgs: indirectPkgs.sort((a,b)=>b.size-a.size).slice(0,10) },
    total: { size: total, sizeFormatted: formatBytes(total) },
    suggestion: devRatio > 0.6 ? `开发依赖占 ${Math.round(devRatio*100)}%，生产部署建议使用 pnpm install --prod 或 npm ci --production，可节省 ${formatBytes(devSize)}` :
                 devRatio > 0.4 ? `开发依赖占 ${Math.round(devRatio*100)}%，可考虑多阶段 Docker 构建分离` :
                 `生产与开发依赖比例健康`,
  };
}

function simulatePruneDev(packages, projectRoot) {
  const analysis = analyzeProdVsDev(projectRoot, packages);
  return {
    currentTotal: analysis.total.sizeFormatted,
    afterPrune: formatBytes(analysis.prod.size + analysis.indirect.size),
    saved: formatBytes(analysis.dev.size),
    savedRatio: analysis.dev.ratio,
    command: 'npm ci --production  或  pnpm install --prod  或  yarn install --production',
  };
}

module.exports = { analyzeProdVsDev, simulatePruneDev };
