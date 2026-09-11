'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { scanProject } = require('../scanner');
const { loadConfig } = require('../utils/config');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

function resolveStaticRoot() {
  const candidates = [
    path.join(__dirname, '../../web/dist'),
    path.join(__dirname, '../../web/public'),
    path.join(__dirname, '../../web'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return path.join(__dirname, '../../web/dist');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 5 * 1024 * 1024) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleApi(req, res, targetRef) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  // allow dynamic target via query ?target=...
  let target = targetRef;
  if (query.target) {
    const candidate = path.resolve(String(query.target));
    if (fs.existsSync(candidate)) target = candidate;
  }

  const sendJson = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(JSON.stringify(obj));
  };

  // GET /api/health
  if (pathname === '/api/health') {
    return sendJson({ ok: true, target, time: new Date().toISOString() });
  }

  // GET /api/config
  if (pathname === '/api/config' && req.method === 'GET') {
    const { config, path: cfgPath } = loadConfig(target);
    return sendJson({ target, configPath: cfgPath, config });
  }

  // GET /api/report/latest
  if ((pathname === '/api/report/latest' || pathname === '/api/latest') && req.method === 'GET') {
    const p = path.join(path.resolve(target), '.nodeslim/reports/latest.json');
    if (!fs.existsSync(p)) return sendJson({ error: 'No report yet. Run nodeslim scan first.', target }, 404);
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return sendJson(j);
    } catch (e) {
      return sendJson({ error: e.message }, 500);
    }
  }

  // GET /api/scan?mode=full|shallow&target=...
  if (pathname === '/api/scan' && req.method === 'GET') {
    const mode = (query.mode || query.shallow ? 'shallow' : 'full');
    const isShallow = mode === 'shallow' || query.shallow === '1' || query.quick === '1';
    try {
      const { config } = loadConfig(target);
      let result;
      if (isShallow) {
        const { shallowScan } = require('../analyzer/shallow-scanner');
        const shallow = shallowScan(target);
        // enrich with suggestions still
        const { getSuggestions } = require('../analyzer/suggestions');
        const pkgs = shallow.packages.map(p => ({ ...p, size: p.size, isDirectDependency: p.isDirectDependency, installCount: 1 }));
        shallow.suggestions = getSuggestions(pkgs);
        shallow.summary = { totalPackages: pkgs.length, totalSize: shallow.totalSize, totalFiles: 0, duplicateCount: 0, bloatCount: 0, optimizableSize: shallow.totalSize * 0.2, wastedSize: 0, isEstimated: true };
        // Save as shallow report for dashboard
        const { saveJsonReport } = require('../reporter/json-reporter');
        await saveJsonReport({ ...shallow, packages: pkgs, root: target, packageManager: shallow.lockInfo?.type || 'unknown', scannedAt: shallow.scannedAt, exists: false, duplicates: [], bloat: [], issues: [], suggestions: shallow.suggestions, security: [], bundle: null }, { outputDir: path.join(path.resolve(target), '.nodeslim/reports') });
        return sendJson({ ...shallow, packages: pkgs, shallow: true });
      } else {
        result = await scanProject(target, { config });
        const { scanSecurity } = require('../analyzer/security-scanner');
        const { analyzeBundle } = require('../analyzer/bundle-analyzer');
        const { saveAllReports } = require('../reporter');
        result.security = scanSecurity(result.packages || []);
        result.bundle = analyzeBundle(target);
        // additional governance + usage for consistent 建议/审计
        let usageForSuggestions = null;
        try {
          const { scanSourceUsage } = require('../analyzer/usage-scanner');
          result.usage = scanSourceUsage(target, result.packages || []);
          usageForSuggestions = result.usage;
        } catch {}
        try {
          const { analyzeProdVsDev } = require('../analyzer/prod-analyzer');
          result.prod = analyzeProdVsDev(target, result.packages || []);
          const { checkPlatformBinaries } = require('../analyzer/platform-check');
          result.platform = checkPlatformBinaries(result.packages || []);
          const { checkWhitelist } = require('../analyzer/whitelist-check');
          result.whitelist = checkWhitelist(target);
        } catch {}
        // 用真实 usage 重算 suggestions，确保与审计一致
        try {
          const { getSuggestions } = require('../analyzer/suggestions');
          if (usageForSuggestions) result.suggestions = getSuggestions(result.packages || [], { usage: usageForSuggestions });
        } catch {}
        await saveAllReports(result, { outputDir: path.join(path.resolve(target), '.nodeslim/reports') });
        return sendJson(result);
      }
    } catch (e) {
      return sendJson({ error: e.message, stack: e.stack }, 500);
    }
  }

  // POST /api/scan  (JSON body with { target, mode })
  if (pathname === '/api/scan' && req.method === 'POST') {
    try {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const reqTarget = body.target ? path.resolve(String(body.target)) : target;
      const actualTarget = fs.existsSync(reqTarget) ? reqTarget : target;
      const isShallow = body.mode === 'shallow' || body.shallow;
      const { config } = loadConfig(actualTarget);
      let result;
      if (isShallow) {
        const { shallowScan } = require('../analyzer/shallow-scanner');
        const shallow = shallowScan(actualTarget);
        const { getSuggestions } = require('../analyzer/suggestions');
        const pkgs = shallow.packages;
        shallow.suggestions = getSuggestions(pkgs);
        shallow.summary = { totalPackages: pkgs.length, totalSize: shallow.totalSize, totalFiles: 0, duplicateCount: 0, bloatCount: 0, optimizableSize: shallow.totalSize * 0.2, wastedSize: 0, isEstimated: true };
        const { saveJsonReport } = require('../reporter/json-reporter');
        await saveJsonReport({ ...shallow, packages: pkgs, root: actualTarget, packageManager: shallow.lockInfo?.type || 'unknown', scannedAt: shallow.scannedAt, exists: false, duplicates: [], bloat: [], issues: [], suggestions: shallow.suggestions, security: [], bundle: null }, { outputDir: path.join(path.resolve(actualTarget), '.nodeslim/reports') });
        return sendJson({ ...shallow, packages: pkgs, shallow: true, target: actualTarget });
      } else {
        result = await scanProject(actualTarget, { config });
        const { scanSecurity } = require('../analyzer/security-scanner');
        const { analyzeBundle } = require('../analyzer/bundle-analyzer');
        const { saveAllReports } = require('../reporter');
        result.security = scanSecurity(result.packages || []);
        result.bundle = analyzeBundle(actualTarget);
        let usageForSuggestions2 = null;
        try { const { scanSourceUsage } = require('../analyzer/usage-scanner'); result.usage = scanSourceUsage(actualTarget, result.packages || []); usageForSuggestions2 = result.usage; } catch {}
        try {
          const { analyzeProdVsDev } = require('../analyzer/prod-analyzer');
          result.prod = analyzeProdVsDev(actualTarget, result.packages || []);
          const { checkPlatformBinaries } = require('../analyzer/platform-check');
          result.platform = checkPlatformBinaries(result.packages || []);
          const { checkWhitelist } = require('../analyzer/whitelist-check');
          result.whitelist = checkWhitelist(actualTarget);
        } catch {}
        try { const { getSuggestions } = require('../analyzer/suggestions'); if (usageForSuggestions2) result.suggestions = getSuggestions(result.packages || [], { usage: usageForSuggestions2 }); } catch {}
        await saveAllReports(result, { outputDir: path.join(path.resolve(actualTarget), '.nodeslim/reports') });
        return sendJson(result);
      }
    } catch (e) {
      return sendJson({ error: e.message }, 500);
    }
  }

  // POST /api/scan/shallow  (same as above but explicit)
  if (pathname === '/api/scan/shallow' && req.method === 'POST') {
    try {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const reqTarget = body.target ? path.resolve(String(body.target)) : target;
      const actualTarget = fs.existsSync(reqTarget) ? reqTarget : target;
      const { shallowScan } = require('../analyzer/shallow-scanner');
      const shallow = shallowScan(actualTarget);
      const { getSuggestions } = require('../analyzer/suggestions');
      shallow.suggestions = getSuggestions(shallow.packages);
      shallow.summary = { totalPackages: shallow.packages.length, totalSize: shallow.totalSize, totalFiles: 0, duplicateCount: 0, bloatCount: 0, optimizableSize: shallow.totalSize * 0.2, wastedSize: 0, isEstimated: true };
      const { saveJsonReport } = require('../reporter/json-reporter');
      await saveJsonReport({ ...shallow, root: actualTarget, packageManager: shallow.lockInfo?.type || 'unknown', scannedAt: shallow.scannedAt, exists: false, duplicates: [], bloat: [], issues: [], suggestions: shallow.suggestions, security: [], bundle: null }, { outputDir: path.join(path.resolve(actualTarget), '.nodeslim/reports') });
      return sendJson({ ...shallow, shallow: true, target: actualTarget });
    } catch (e) {
      return sendJson({ error: e.message }, 500);
    }
  }

  // POST /api/scan/upload  (lightweight browser import: receives { packageJson, lockfile, lockType })
  if (pathname === '/api/scan/upload' && req.method === 'POST') {
    try {
      const bodyRaw = await readBody(req);
      const body = JSON.parse(bodyRaw || '{}');
      const pkgJson = body.packageJson || body.package_json;
      const lockContent = body.lockfile || body.lockContent;
      const lockType = body.lockType || 'npm';
      if (!pkgJson) return sendJson({ error: 'packageJson required' }, 400);
      const pj = typeof pkgJson === 'string' ? JSON.parse(pkgJson) : pkgJson;
      // build shallow-like packages from uploaded content
      const allDeps = { ...pj.dependencies, ...pj.devDependencies, ...pj.peerDependencies };
      const knownSizes = { 'react': 200*1024, 'react-dom': 3*1024*1024, '@babel/core': 5*1024*1024, 'typescript': 60*1024*1024, 'webpack': 18*1024*1024, 'eslint': 8*1024*1024, 'jest': 25*1024*1024, 'lodash': 5*1024*1024, 'moment': 4*1024*1024 };
      const packages = Object.keys(allDeps).map(name => {
        const isDev = !!pj.devDependencies?.[name];
        const size = knownSizes[name] || (name.startsWith('@types/') ? 500*1024 : 120*1024);
        return { name, version: String(allDeps[name]).replace(/^[\^~]/,''), size, fileCount: Math.floor(size/2000)+10, installCount: 1, installPaths: [`/virtual/node_modules/${name}`], category: name.startsWith('@types/')?'types':'library', isDirectDependency: !isDev, isDevDependency: isDev, isEstimated: true, isUploaded: true };
      });
      const totalSize = packages.reduce((s,p)=>s+p.size,0);
      const { getSuggestions } = require('../analyzer/suggestions');
      const suggestions = getSuggestions(packages);
      // dedupe detection from lockfile if provided
      let duplicates = [];
      if (lockContent) {
        try {
          if (lockType === 'pnpm') {
            const yaml = require('js-yaml');
            const y = yaml.load(lockContent);
            const seen = new Map();
            for (const k of Object.keys(y.packages||{})) {
              const m = k.match(/\/([^@\/]+)@/);
              if (m) {
                const n = m[1];
                if (!seen.has(n)) seen.set(n, new Set());
                seen.get(n).add(k);
              }
            }
            for (const [name, set] of seen.entries()) if (set.size>1) duplicates.push({ packageName: name, count: set.size, versions: Array.from(set).slice(0,3), totalSize: 0, wastedSize: 0 });
          }
        } catch {}
      }
      const result = {
        mode: 'uploaded-shallow',
        root: pj.name || 'uploaded-project',
        packageManager: lockType,
        packages,
        totalPackages: packages.length,
        totalSize,
        totalFiles: 0,
        duplicates,
        bloat: [],
        suggestions,
        security: [],
        summary: { totalPackages: packages.length, totalSize, totalFiles: 0, duplicateCount: duplicates.length, bloatCount: 0, optimizableSize: totalSize*0.2, wastedSize: 0, isEstimated: true, isUploaded: true },
        meta: { root: pj.name || 'uploaded', packageManager: lockType, generatedAt: new Date().toISOString(), version: require('../../package.json').version },
        scannedAt: new Date().toISOString(),
        isUploaded: true,
      };
      return sendJson(result);
    } catch (e) {
      return sendJson({ error: e.message, stack: e.stack }, 500);
    }
  }

  // GET /api/scan/stream  (SSE) — support ?target=&mode=
  if (pathname === '/api/scan/stream') {
    const mode = (query.mode === 'shallow' || query.shallow === '1') ? 'shallow' : 'full';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ stage: 'start', message: '开始扫描...', mode });
    try {
      if (mode === 'shallow') {
        send({ stage: 'walk', message: '轻量解析 package.json...' });
        const { shallowScan } = require('../analyzer/shallow-scanner');
        const shallow = shallowScan(target);
        send({ stage: 'done', message: '轻量扫描完成', result: shallow });
        res.end();
        return sendJson ? null : null;
      }
      const { config } = loadConfig(target);
      send({ stage: 'walk', message: '遍历文件系统...' });
      const result = await scanProject(target, { config });
      send({ stage: 'analyze', message: '分析依赖...' });
      const { scanSecurity } = require('../analyzer/security-scanner');
      const { analyzeBundle } = require('../analyzer/bundle-analyzer');
      const { saveAllReports } = require('../reporter');
      result.security = scanSecurity(result.packages || []);
      result.bundle = analyzeBundle(target);
      await saveAllReports(result, { outputDir: path.join(path.resolve(target), '.nodeslim/reports') });
      send({ stage: 'done', message: '扫描完成', result });
      res.end();
    } catch (e) {
      send({ stage: 'error', message: e.message });
      res.end();
    }
    return {};
  }

  // GET /api/packages, /api/duplicates, /api/bloat, /api/suggestions etc (with optional target)
  if (pathname.startsWith('/api/')) {
    const p = path.join(path.resolve(target), '.nodeslim/reports/latest.json');
    if (!fs.existsSync(p)) return sendJson({ error: 'No report. Run scan.', target }, 404);
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (pathname === '/api/packages') return sendJson(j.packages || []);
    if (pathname === '/api/duplicates') return sendJson(j.duplicates || []);
    if (pathname === '/api/bloat') return sendJson(j.bloat || []);
    if (pathname === '/api/suggestions') return sendJson(j.suggestions || []);
    if (pathname === '/api/security') return sendJson(j.security || []);
    if (pathname === '/api/summary') return sendJson(j.summary || j);
    if (pathname === '/api/audit') {
      try {
        const { scanSourceUsage } = require('../analyzer/usage-scanner');
        const usage = scanSourceUsage(target, j.packages || []);
        const { analyzeProdVsDev } = require('../analyzer/prod-analyzer');
        const prod = analyzeProdVsDev(target, j.packages || []);
        const { checkEsm } = require('../analyzer/esm-check');
        const esm = checkEsm(target, usage);
        const { checkPlatformBinaries } = require('../analyzer/platform-check');
        const platform = checkPlatformBinaries(j.packages || []);
        const { checkWhitelist } = require('../analyzer/whitelist-check');
        const whitelist = checkWhitelist(target);
        return sendJson({ usage, prod, esm, platform, whitelist, summary: j.summary });
      } catch (e) { return sendJson({ error: e.message }, 500); }
    }
    if (pathname === '/api/dedupe') {
      const { generateDedupePlan } = require('../analyzer/dedupe-helper');
      return sendJson(generateDedupePlan(j.duplicates || []));
    }
    if (pathname === '/api/import-map') {
      const { generateImportMap } = require('../analyzer/import-map-generator');
      return sendJson(generateImportMap(j.packages || []));
    }
    if (pathname === '/api/tree') {
      const nodes = (j.packages || []).slice(0, 100).map(pkg => ({
        name: pkg.name, version: pkg.version, size: pkg.size, category: pkg.category,
        isDuplicate: pkg.installCount > 1,
      }));
      return sendJson({ root: j.meta?.root, packages: nodes });
    }
  }

  return null; // not handled
}

function createServer(opts = {}) {
  const target = path.resolve(opts.target || process.cwd());
  const staticRoot = resolveStaticRoot();

  const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    let pathname = parsed.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    // API
    if (pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, target);
      if (handled !== null) return;
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Not found: ' + pathname }));
    }

    // Static
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const safePath = path.normalize(path.join(staticRoot, pathname));
    if (!safePath.startsWith(path.normalize(staticRoot))) {
      res.writeHead(403); return res.end('Forbidden');
    }

    let filePath = safePath;
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {}

    if (!fs.existsSync(filePath)) {
      const index = path.join(staticRoot, 'index.html');
      if (fs.existsSync(index)) {
        filePath = index;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=3600', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(filePath).pipe(res);
  });

  return server;
}

function start(opts = {}) {
  const port = parseInt(opts.port || 3000, 10);
  const target = path.resolve(opts.target || process.cwd());
  const server = createServer({ target });
  server.listen(port, () => {
    let chalk; try { chalk = require('chalk'); } catch { chalk = { cyan: s=>s, green: s=>s, dim: s=>s, bold: { cyan: s=>s, green: s=>s } }; }
    const c = chalk;
    console.log(c.bold && c.bold.cyan ? c.bold.cyan('\n🚀 NodeSlim Dashboard 已启动') : '\n🚀 NodeSlim Dashboard 已启动');
    console.log(`   ${(c.cyan ? c.cyan('Local:') : 'Local:')}   http://localhost:${port}`);
    try {
      const { networkInterfaces } = require('os');
      const nets = networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          if (net.family === 'IPv4' && !net.internal) {
            console.log(`   ${(c.cyan ? c.cyan('Network:') : 'Network:')} http://${net.address}:${port}`);
            break;
          }
        }
      }
    } catch {}
    console.log(`   ${(c.dim ? c.dim('Target: ' + target) : 'Target: ' + target)}`);
    console.log(`   ${(c.dim ? c.dim('按 Ctrl+C 退出 | 支持拖拽 package.json 进行少扫描 | ?target= 切换项目') : '按 Ctrl+C 退出 | 支持拖拽 package.json 进行少扫描')}\n`);
    try {
      const { exec } = require('child_process');
      const urlOpen = `http://localhost:${port}`;
      const platform = process.platform;
      const cmd = platform === 'win32' ? `start "" "${urlOpen}"` : platform === 'darwin' ? `open "${urlOpen}"` : `xdg-open "${urlOpen}"`;
      exec(cmd, () => {});
    } catch {}
  });
  server.on('error', (err) => {
    console.error('Server error:', err.message);
    if (err.code === 'EADDRINUSE') console.error(`端口 ${port} 已被占用，请尝试 --port 另指定端口`);
    process.exit(1);
  });
  return server;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let port = 3000;
  let target = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--port' || args[i] === '-p') && args[i+1]) port = parseInt(args[i+1], 10);
    if ((args[i] === '--target' || args[i] === '-t') && args[i+1]) target = args[i+1];
  }
  start({ port, target });
}

module.exports = { createServer, start };
