'use strict';
const fs = require('fs');
const path = require('path');
const { formatBytes } = require('../utils/format');

// Scan source files for import/require usage to detect unused and on-demand issues
function scanSourceUsage(projectRoot, packages) {
  const srcDirs = ['src', 'lib', 'app', 'pages', 'components', 'server', 'source'].map(d => path.join(projectRoot, d)).filter(p => fs.existsSync(p));
  // also check root-level js/ts files
  const rootFiles = [];
  try {
    const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && /\.(js|ts|jsx|tsx|mjs|cjs)$/.test(e.name)) rootFiles.push(path.join(projectRoot, e.name));
    }
  } catch {}

  const codeFiles = [...rootFiles];
  const collectFiles = (dir) => {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const it of items) {
        const p = path.join(dir, it.name);
        if (it.isDirectory()) {
          if (['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.vite'].includes(it.name)) continue;
          collectFiles(p);
        } else if (/\.(js|ts|jsx|tsx|mjs|cjs|vue|svelte)$/.test(it.name)) {
          codeFiles.push(p);
        }
      }
    } catch {}
  };
  for (const d of srcDirs) collectFiles(d);
  if (codeFiles.length === 0) {
    // fallback: glob src/**/*
    // we keep minimal
  }

  // Build usage map: package name -> count, and detect patterns
  const pkgNames = new Set(packages.map(p => p.name));
  // also consider bare specifiers like 'lodash/debounce' -> lodash
  const usage = new Map(); // pkg -> { count, files: [] }
  const onDemandIssues = []; // { file, line, pkg, type }
  const cjsUsages = []; // require or module.exports
  const dynamicImports = [];

  for (const file of codeFiles.slice(0, 500)) { // limit to 500 files for performance
    let content;
    try { content = fs.readFileSync(file, 'utf-8'); } catch { continue; }
    const rel = path.relative(projectRoot, file);
    // Detect requires / imports
    const importRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    let m;
    while ((m = importRegex.exec(content)) !== null) {
      const spec = m[1] || m[2] || m[3];
      if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) continue;
      // extract package name (scoped or not)
      const pkg = extractPkgFromSpec(spec);
      if (!pkg) continue;
      if (!usage.has(pkg)) usage.set(pkg, { count: 0, files: new Set() });
      const entry = usage.get(pkg);
      entry.count++;
      entry.files.add(rel);
      // on-demand check: full lodash import
      if (spec === 'lodash' && /import\s+_\s+from\s+['"]lodash['"]|import\s+\*\s+as\s+_\s+from\s+['"]lodash['"]|require\(['"]lodash['"]\)/.test(content)) {
        onDemandIssues.push({ file: rel, pkg: 'lodash', spec, type: 'full-import', message: `在 ${rel} 中全量导入 lodash，建议按需: import debounce from 'lodash/debounce'`, suggestion: '改为按需或迁移 es-toolkit' });
      }
      if (spec === 'moment') {
        onDemandIssues.push({ file: rel, pkg: 'moment', spec, type: 'heavy-moment', message: `在 ${rel} 中导入 moment (290KB)，建议替换为 dayjs (6KB)`, suggestion: 'moment → dayjs' });
      }
      // CJS check
      if (m[2]) { // require
        cjsUsages.push({ file: rel, spec, line: content.slice(0, m.index).split('\n').length });
      }
      if (m[3]) {
        dynamicImports.push({ file: rel, spec });
      }
    }
    // also detect CJS exports
    if (/module\.exports|exports\./.test(content)) {
      cjsUsages.push({ file: rel, spec: '(cjs-exports)', line: 1 });
    }
  }

  // Unused detection: packages that are in package.json but never imported in source
  const pkgJsonPath = path.join(projectRoot, 'package.json');
  let declared = { dependencies: {}, devDependencies: {}, all: {} };
  try {
    const pj = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    declared.dependencies = pj.dependencies || {};
    declared.devDependencies = pj.devDependencies || {};
    declared.all = { ...pj.dependencies, ...pj.devDependencies, ...(pj.peerDependencies || {}) };
  } catch {}

  const unused = [];
  for (const name of Object.keys(declared.all)) {
    if (!usage.has(name) && !name.startsWith('@types/')) {
      // heuristic: ignore cli/build tools that are not imported in source (eslint, typescript, vite etc are executed via CLI not import)
      const isCliTool = /eslint|prettier|typescript|vite|webpack|rollup|esbuild|jest|vitest|@types/.test(name);
      if (isCliTool) continue;
      const isUsed = pkgNames.has(name); // installed
      unused.push({
        name,
        version: declared.all[name],
        isDev: !!declared.devDependencies[name],
        reason: isUsed ? '已安装但源码中未检测到 import/require' : '声明但未安装',
        suggestion: isUsed ? `运行 depcheck 确认，或执行 npm uninstall ${name}` : `确认是否仍需依赖`,
      });
    }
  }

  // Ghost dependencies: used but not declared in package.json
  const BUILTINS = new Set(['fs','path','os','http','https','url','child_process','crypto','events','util','stream','buffer','querystring','zlib','assert','tty','net','dns','dgram','cluster','worker_threads','perf_hooks','readline','repl','vm','module','process','console','timers','string_decoder','punycode','constants','inspector','async_hooks','v8','trace_events','wasi']);
  const ghost = [];
  for (const [pkg, info] of usage.entries()) {
    if (BUILTINS.has(pkg)) continue;
    // filter template literal false positive like ${cdnBase} or y (single char)
    if (pkg.length <= 1 || pkg.includes('${') || pkg.includes('{') || pkg.includes('}')) continue;
    if (!declared.all[pkg]) {
      ghost.push({
        name: pkg,
        usedIn: Array.from(info.files).slice(0, 3),
        count: info.count,
        message: `${pkg} 在源码中使用但未在 package.json 声明（幽灵依赖，pnpm 严格模式会报错）`,
        suggestion: `执行 npm install ${pkg} --save 或 pnpm add ${pkg}`,
      });
    }
  }

  return {
    scannedFiles: codeFiles.length,
    usage: Object.fromEntries(Array.from(usage.entries()).map(([k, v]) => [k, { count: v.count, files: Array.from(v.files).slice(0, 5) }])),
    onDemandIssues: onDemandIssues.slice(0, 20),
    unused: unused.slice(0, 30),
    ghost: ghost.slice(0, 20),
    cjsUsages: cjsUsages.slice(0, 20),
    dynamicImports: dynamicImports.slice(0, 10),
    totalFullImports: onDemandIssues.length,
  };
}

function extractPkgFromSpec(spec) {
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    if (parts.length >= 2) return parts.slice(0, 2).join('/');
    return spec;
  }
  return spec.split('/')[0];
}

module.exports = { scanSourceUsage };
