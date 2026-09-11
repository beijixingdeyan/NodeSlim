'use strict';
const os = require('os');
const { formatBytes } = require('../utils/format');

function checkPlatformBinaries(packages) {
  const currentPlatform = os.platform(); // win32, linux, darwin
  const currentArch = os.arch(); // x64, arm64, etc

  const platformPatterns = [
    { pattern: /esbuild-(darwin|linux|windows|freebsd|android)-/, pkg: 'esbuild', sizeEst: null },
    { pattern: /swc-(darwin|linux|windows)-/, pkg: 'swc' },
    { pattern: /sharp-(darwin|linux|windows)-/, pkg: 'sharp' },
    { pattern: /\.node$/, pkg: 'native-addon' },
  ];

  const hits = [];
  let totalWasted = 0;

  for (const p of packages) {
    // Check package name itself
    for (const plat of platformPatterns) {
      if (plat.pattern.test(p.name)) {
        // Check if it's for current platform
        const isCurrent = isForCurrentPlatform(p.name, currentPlatform, currentArch);
        if (!isCurrent) {
          hits.push({
            name: p.name,
            version: p.version,
            size: p.size,
            sizeFormatted: formatBytes(p.size),
            platform: inferPlatform(p.name),
            isCurrentPlatform: false,
            message: `${p.name}@${p.version} (${formatBytes(p.size)}) 非当前平台 (${currentPlatform}-${currentArch})，可移除`,
            suggestion: `配置 .npmrc: cpu=${currentArch} os=${currentPlatform} 或使用 optionalDependencies 过滤`,
          });
          totalWasted += p.size;
        } else {
          hits.push({
            name: p.name,
            version: p.version,
            size: p.size,
            sizeFormatted: formatBytes(p.size),
            platform: inferPlatform(p.name),
            isCurrentPlatform: true,
            message: `${p.name} 为当前平台所需，保留`,
          });
        }
      }
    }
    // Also check fileCount heavy for esbuild-like
    if (p.name === 'esbuild' && p.fileCount > 100) {
      // heuristic: esbuild main package may contain multiple binaries via optional deps
    }
  }

  // Also detect .node binaries inside packages (via fileCount heuristic not perfect, but we approximate)
  const wasted = hits.filter(h => !h.isCurrentPlatform);

  return {
    currentPlatform: `${currentPlatform}-${currentArch}`,
    totalBinaries: hits.length,
    wastedCount: wasted.length,
    wastedSize: totalWasted,
    wastedFormatted: formatBytes(totalWasted),
    hits,
    suggestion: wasted.length ? `检测到 ${wasted.length} 个非当前平台二进制，浪费 ${formatBytes(totalWasted)}，建议配置 npm 安装过滤：npm install --cpu=${currentArch} --os=${currentPlatform} 或 pnpm --filter` : '平台二进制检查通过',
  };
}

function isForCurrentPlatform(name, platform, arch) {
  // map node platform names: win32 -> windows, darwin -> darwin, linux -> linux
  const platformMap = { win32: 'windows', darwin: 'darwin', linux: 'linux', freebsd: 'freebsd' };
  const current = platformMap[platform] || platform;
  if (name.includes(current)) {
    // also check arch
    if (name.includes(arch) || name.includes(arch.replace('arm64', 'arm64').replace('x64', '64'))) return true;
    // if no arch in name, assume match
    if (!name.match(/(x64|arm64|64|arm)/)) return true;
    return name.includes(arch) || name.includes('64') && arch === 'x64';
  }
  return false;
}

function inferPlatform(name) {
  const m = name.match(/(darwin|linux|windows|freebsd|android)/);
  return m ? m[1] : 'unknown';
}

module.exports = { checkPlatformBinaries };
