'use strict';
const fs = require('fs');
const path = require('path');

function generateDedupePlan(duplicates) {
  if (!duplicates || duplicates.length === 0) {
    return { needed: false, message: '无重复依赖，无需去重', overrides: {}, resolutions: {} };
  }

  const overrides = {};
  const resolutions = {};
  const details = [];

  for (const dup of duplicates) {
    // Pick most common version or latest semver
    const versions = dup.versions || [];
    if (versions.length < 2) continue;
    // sort by semver naive: pick highest that appears most
    const counts = {};
    dup.versions.forEach(v => counts[v] = (counts[v]||0)+1);
    let best = versions[0];
    let maxCount = 0;
    for (const v of Object.keys(counts)) {
      if (counts[v] > maxCount) { maxCount = counts[v]; best = v; }
    }
    // also try to pick latest if tie: simple string compare
    overrides[dup.packageName] = best;
    resolutions[dup.packageName] = best;
    // for yarn resolutions need **/pkg pattern
    resolutions[`**/${dup.packageName}`] = best;
    details.push({
      package: dup.packageName,
      versions: dup.versions,
      chosen: best,
      reason: `统一为出现最多的版本 ${best} (${maxCount}次)`,
      wasted: dup.wastedSize,
    });
  }

  return {
    needed: true,
    count: duplicates.length,
    overrides,
    resolutions,
    details,
    pnpmOverrides: overrides,
    yarnResolutions: Object.fromEntries(Object.entries(resolutions).filter(([k])=>k.startsWith('**/'))),
    npmOverrides: overrides,
    instructions: {
      npm: `在 package.json 添加 "overrides": ${JSON.stringify(overrides, null, 2)} 后执行 npm install`,
      yarn: `在 package.json 添加 "resolutions": ${JSON.stringify(Object.fromEntries(details.map(d=>[d.package, d.chosen])), null, 2)} 后执行 yarn install`,
      pnpm: `在 package.json 添加 "pnpm": { "overrides": ${JSON.stringify(overrides, null, 2)} } 后执行 pnpm install`,
    },
  };
}

function applyDedupeToPackageJson(projectRoot, plan, dryRun = true) {
  const pjPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pjPath)) throw new Error('package.json not found');
  const pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
  if (!dryRun) {
    pj.overrides = { ...(pj.overrides||{}), ...plan.overrides };
    // also add pnpm.overrides for pnpm users
    pj.pnpm = pj.pnpm || {};
    pj.pnpm.overrides = { ...(pj.pnpm.overrides||{}), ...plan.overrides };
    fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2), 'utf-8');
  }
  return { path: pjPath, overrides: plan.overrides, dryRun };
}

module.exports = { generateDedupePlan, applyDedupeToPackageJson };
