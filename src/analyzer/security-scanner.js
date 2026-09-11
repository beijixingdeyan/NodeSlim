'use strict';
const fs = require('fs');
const path = require('path');
const semver = require('semver');

let securityRules = null;
function loadRules() {
  if (securityRules) return securityRules;
  try {
    const p = path.join(__dirname, '../../rules/security-rules.json');
    securityRules = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    securityRules = { checks: [] };
  }
  return securityRules;
}

function scanSecurity(enrichedPackages) {
  const rules = loadRules();
  const issues = [];

  const pkgMap = new Map(enrichedPackages.map(p => [p.name, p]));

  for (const check of rules.checks || []) {
    if (check.id === 'known-vuln' && check.packages) {
      for (const vuln of check.packages) {
        const pkg = pkgMap.get(vuln.name);
        if (!pkg) continue;
        try {
          if (semver.satisfies(pkg.version, vuln.vulnerable)) {
            issues.push({
              type: 'SECURITY',
              severity: 'CRITICAL',
              packageName: vuln.name,
              message: `${vuln.name}@${pkg.version} 存在漏洞 ${vuln.cve}`,
              suggestion: vuln.fix,
              cve: vuln.cve,
              autoFixable: false,
            });
          }
        } catch {
          // if version is unknown or not semver, skip
        }
      }
    }
    if (check.id === 'deprecated' && check.packages) {
      for (const dep of check.packages) {
        if (pkgMap.has(dep.name)) {
          issues.push({
            type: 'SECURITY',
            severity: 'WARNING',
            packageName: dep.name,
            message: `${dep.name} 已废弃: ${dep.message}`,
            suggestion: dep.message,
            autoFixable: false,
          });
        }
      }
    }
  }

  // heuristic: detect packages with postinstall scripts (potential risk)
  for (const pkg of enrichedPackages) {
    try {
      const pjPath = path.join(pkg.installPaths[0], 'package.json');
      const raw = fs.readFileSync(pjPath, 'utf-8');
      const j = JSON.parse(raw);
      if (j.scripts && (j.scripts.postinstall || j.scripts.preinstall || j.scripts.install)) {
        // only flag if not well-known
        const knownSafe = new Set(['esbuild', 'sharp', 'node-sass', 'swc', 'prisma']);
        if (!knownSafe.has(pkg.name) && pkg.size > 100 * 1024) {
          issues.push({
            type: 'SECURITY',
            severity: 'INFO',
            packageName: pkg.name,
            message: `${pkg.name} 包含安装脚本 (${Object.keys(j.scripts).filter(k => /install/.test(k)).join(', ')})`,
            suggestion: '确认该包来源可信，审查其安装脚本',
            autoFixable: false,
          });
        }
      }
    } catch {}
  }

  return issues;
}

module.exports = { scanSecurity };
