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

async function handleApi(req, res, target) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  const sendJson = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(obj));
  };

  // GET /api/report/latest
  if (pathname === '/api/report/latest' || pathname === '/api/latest') {
    const p = path.join(path.resolve(target), '.nodeslim/reports/latest.json');
    if (!fs.existsSync(p)) return sendJson({ error: 'No report yet. Run nodeslim scan first.' }, 404);
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return sendJson(j);
    } catch (e) {
      return sendJson({ error: e.message }, 500);
    }
  }

  // GET /api/scan  (triggers scan)
  if (pathname === '/api/scan' && req.method === 'GET') {
    try {
      const { config } = loadConfig(target);
      const result = await scanProject(target, { config });
      const { scanSecurity } = require('../analyzer/security-scanner');
      const { analyzeBundle } = require('../analyzer/bundle-analyzer');
      const { saveAllReports } = require('../reporter');
      result.security = scanSecurity(result.packages || []);
      result.bundle = analyzeBundle(target);
      await saveAllReports(result, { outputDir: path.join(path.resolve(target), '.nodeslim/reports') });
      return sendJson(result);
    } catch (e) {
      return sendJson({ error: e.message }, 500);
    }
  }

  // GET /api/scan/stream  (SSE)
  if (pathname === '/api/scan/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ stage: 'start', message: '开始扫描...' });
    try {
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
    return;
  }

  // GET /api/packages, /api/duplicates, /api/bloat, /api/suggestions
  if (pathname.startsWith('/api/')) {
    const p = path.join(path.resolve(target), '.nodeslim/reports/latest.json');
    if (!fs.existsSync(p)) return sendJson({ error: 'No report. Run scan.' }, 404);
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (pathname === '/api/packages') return sendJson(j.packages || []);
    if (pathname === '/api/duplicates') return sendJson(j.duplicates || []);
    if (pathname === '/api/bloat') return sendJson(j.bloat || []);
    if (pathname === '/api/suggestions') return sendJson(j.suggestions || []);
    if (pathname === '/api/security') return sendJson(j.security || []);
    if (pathname === '/api/summary') return sendJson(j.summary || j);
    if (pathname === '/api/tree') {
      // Build simple tree from packages
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
      // if not handled, fall through to 404 json
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not found: ' + pathname }));
    }

    // Static
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    // prevent directory traversal
    const safePath = path.normalize(path.join(staticRoot, pathname));
    if (!safePath.startsWith(path.normalize(staticRoot))) {
      res.writeHead(403); return res.end('Forbidden');
    }

    let filePath = safePath;
    // if path is directory, try index.html
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {}

    if (!fs.existsSync(filePath)) {
      // SPA fallback: serve index.html for non-file routes (except /api)
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
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=3600' });
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
    console.log(`   ${(c.dim ? c.dim('按 Ctrl+C 退出 | 刷新页面自动读取最新报告') : '按 Ctrl+C 退出 | 刷新页面自动读取最新报告')}\n`);
    // try open browser (non-blocking)
    try {
      const { exec } = require('child_process');
      const urlOpen = `http://localhost:${port}`;
      const platform = process.platform;
      const cmd = platform === 'win32' ? `start "" "${urlOpen}"` : platform === 'darwin' ? `open "${urlOpen}"` : `xdg-open "${urlOpen}"`;
      // don't block; just attempt
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
