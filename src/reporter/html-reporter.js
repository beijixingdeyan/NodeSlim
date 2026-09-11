'use strict';
const fs = require('fs');
const path = require('path');
const { formatBytes } = require('../utils/format');
const { buildReport } = require('./json-reporter');

function generateHtml(scanResult) {
  const report = buildReport(scanResult);
  const sum = report.summary;

  const topPackages = [...(report.packages || [])].sort((a,b)=>b.size-a.size).slice(0,20);

  const pkgRows = topPackages.map((p, i) => `
    <tr>
      <td>${i+1}</td>
      <td><code>${escapeHtml(p.name)}</code> <span style="color:#999">@${escapeHtml(p.version)}</span></td>
      <td style="text-align:right">${formatBytes(p.size)}</td>
      <td style="text-align:right">${p.fileCount}</td>
      <td><span class="badge ${p.category}">${escapeHtml(p.category)}</span></td>
      <td>${p.installCount > 1 ? `<span style="color:#e53e3e;font-weight:bold">${p.installCount}×</span>` : '1'}</td>
      <td><div class="bar" style="width:${Math.min(100, Math.round(p.size / (topPackages[0]?.size||1) * 100))}%"></div></td>
    </tr>
  `).join('');

  const dupRows = (report.duplicates || []).map(d => `
    <tr>
      <td><code>${escapeHtml(d.packageName)}</code></td>
      <td>${d.count}×</td>
      <td>${escapeHtml(d.versions.join(', '))}</td>
      <td style="text-align:right">${formatBytes(d.totalSize)}</td>
      <td style="text-align:right;color:${d.wastedSize>0?'#e53e3e':'#000'}">${formatBytes(d.wastedSize)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;padding:20px">无重复依赖 ✅</td></tr>';

  const bloatRows = (report.bloat || []).slice(0,15).map(b => `
    <tr>
      <td><code>${escapeHtml(b.name)}</code> @${escapeHtml(b.version)}</td>
      <td style="text-align:right">${escapeHtml(b.sizeFormatted)}</td>
      <td>${b.fileCount}</td>
      <td><span class="severity ${b.severity}">${b.severity}</span></td>
      <td>${escapeHtml(b.reason)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;padding:20px">无膨胀包 ✅</td></tr>';

  const sugItems = (report.suggestions || []).map(s => `
    <div class="sug ${s.type.toLowerCase()}">
      <div class="sug-title"><span class="sug-type">${s.type}</span> ${escapeHtml(s.message)}</div>
      <div class="sug-action">💡 ${escapeHtml(s.suggestion)}</div>
      ${s.estimatedSavings ? `<div class="sug-saving">预计节省: <b>${escapeHtml(String(s.estimatedSavings))}</b></div>` : ''}
    </div>
  `).join('') || '<div style="color:#999;text-align:center;padding:20px">暂无优化建议</div>';

  const secRows = (report.security || []).map(s => `
    <tr>
      <td><span class="severity ${s.severity.toLowerCase()}">${s.severity}</span></td>
      <td><code>${escapeHtml(s.packageName||'')}</code></td>
      <td>${escapeHtml(s.message)}</td>
      <td>${escapeHtml(s.suggestion||'')}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:#999;padding:20px">未发现已知漏洞 ✅</td></tr>';

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>NodeSlim Report — ${escapeHtml(report.meta.root)}</title>
<style>
*{box-sizing:border-box;font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
body{margin:0;background:#f7fafc;color:#1a202c}
.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:32px 24px}
.header h1{margin:0;font-size:28px}
.header p{margin:8px 0 0;opacity:.9}
.container{max-width:1200px;margin:0 auto;padding:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.card h3{margin:0 0 8px;font-size:14px;color:#718096;text-transform:uppercase;letter-spacing:.05em}
.card .val{font-size:28px;font-weight:700}
.card .unit{font-size:14px;color:#718096}
.section{background:#fff;border-radius:12px;padding:24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.section h2{margin:0 0 16px;font-size:18px;border-bottom:2px solid #edf2f7;padding-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;padding:10px 8px;background:#f7fafc;color:#4a5568;font-weight:600;border-bottom:2px solid #e2e8f0}
td{padding:10px 8px;border-bottom:1px solid #edf2f7}
.bar{height:14px;background:linear-gradient(90deg,#667eea,#764ba2);border-radius:4px}
.badge{padding:2px 8px;border-radius:999px;font-size:12px;color:#fff}
.badge.framework{background:#4299e1}
.badge.build-tool{background:#48bb78}
.badge.utility{background:#ed8936}
.badge.types{background:#a0aec0}
.badge.library{background:#9f7aea}
.badge.testing{background:#f56565}
.badge.unknown{background:#cbd5e0;color:#4a5568}
.severity{padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600}
.severity.critical,.severity.ERROR{background:#fff5f5;color:#c53030}
.severity.warning,.severity.WARNING{background:#fffaf0;color:#c05621}
.severity.info,.severity.INFO{background:#ebf8ff;color:#2b6cb0}
.sug{border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:12px}
.sug.replace{border-left:4px solid #4299e1}
.sug.migration{border-left:4px solid #48bb78}
.sug.clean{border-left:4px solid #ed8936}
.sug-type{font-size:12px;background:#edf2f7;padding:2px 6px;border-radius:4px;margin-right:8px}
.sug-title{font-weight:600;margin-bottom:6px}
.sug-action{color:#4a5568;font-size:14px}
.sug-saving{color:#38a169;font-size:13px;margin-top:6px}
.footer{text-align:center;color:#a0aec0;padding:20px;font-size:13px}
code{background:#edf2f7;padding:1px 4px;border-radius:4px;font-size:13px}
</style></head><body>
<div class="header">
  <div class="container" style="padding:0">
    <h1>📦 NodeSlim 智能优化报告</h1>
    <p>${escapeHtml(report.meta.root)} &nbsp;|&nbsp; ${escapeHtml(report.meta.packageManager)} &nbsp;|&nbsp; ${new Date(report.meta.generatedAt).toLocaleString('zh-CN')}</p>
    <p style="margin-top:12px"><span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:999px;font-size:13px">NodeSlim v${escapeHtml(report.meta.version)} — 从 850MB 到 50MB，一键诊断</span></p>
  </div>
</div>
<div class="container">
  <div class="grid">
    <div class="card"><h3>总包数</h3><div class="val">${sum.totalPackages}</div><div class="unit">packages</div></div>
    <div class="card"><h3>总体积</h3><div class="val">${formatBytes(sum.totalSize)}</div><div class="unit">${sum.totalFiles} files</div></div>
    <div class="card"><h3>重复依赖</h3><div class="val" style="color:${sum.duplicateCount>0?'#e53e3e':'#38a169'}">${sum.duplicateCount}</div><div class="unit">浪费 ${formatBytes(sum.wastedSize)}</div></div>
    <div class="card"><h3>可优化</h3><div class="val" style="color:#ed8936">${formatBytes(sum.optimizableSize)}</div><div class="unit">estimated</div></div>
  </div>

  <div class="section">
    <h2>📊 Top 20 最大包</h2>
    <table><thead><tr><th>#</th><th>包名</th><th style="text-align:right">体积</th><th style="text-align:right">文件</th><th>类型</th><th>安装</th><th>占比</th></tr></thead><tbody>
    ${pkgRows || '<tr><td colspan="7" style="text-align:center;color:#999;padding:20px">无数据</td></tr>'}
    </tbody></table>
  </div>

  <div class="section">
    <h2>♻️ 重复依赖详情</h2>
    <table><thead><tr><th>包名</th><th>次数</th><th>版本</th><th style="text-align:right">总计</th><th style="text-align:right">浪费</th></tr></thead><tbody>
    ${dupRows}
    </tbody></table>
  </div>

  <div class="section">
    <h2>🐘 膨胀包分析</h2>
    <table><thead><tr><th>包名</th><th style="text-align:right">体积</th><th>文件</th><th>级别</th><th>原因</th></tr></thead><tbody>
    ${bloatRows}
    </tbody></table>
  </div>

  <div class="section">
    <h2>💡 优化建议</h2>
    ${sugItems}
  </div>

  <div class="section">
    <h2>🔒 安全扫描</h2>
    <table><thead><tr><th>级别</th><th>包名</th><th>问题</th><th>建议</th></tr></thead><tbody>
    ${secRows}
    </tbody></table>
  </div>

  ${report.bundle ? `<div class="section"><h2>📦 Bundle 产物分析</h2><pre style="background:#1a202c;color:#e2e8f0;padding:16px;border-radius:8px;overflow:auto;font-size:13px">${escapeHtml(JSON.stringify(report.bundle, null, 2))}</pre></div>` : ''}

  <div class="footer">Generated by NodeSlim v${escapeHtml(report.meta.version)} — <a href="https://github.com/beijixingdeyan/NodeSlim" style="color:#667eea">GitHub</a> &nbsp;|&nbsp; ${new Date().toISOString()}</div>
</div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

async function saveHtmlReport(scanResult, opts = {}) {
  const outputDir = opts.outputDir || path.join(scanResult.root, '.nodeslim/reports');
  const fsMem = require('fs');
  fsMem.mkdirSync(outputDir, { recursive: true });
  const html = generateHtml(scanResult);
  const filename = opts.filename || `report-${new Date().toISOString().slice(0,10)}-${Date.now()}.html`;
  const full = path.join(outputDir, filename);
  fsMem.writeFileSync(full, html, 'utf-8');
  // also write latest.html
  fsMem.writeFileSync(path.join(outputDir, 'latest.html'), html, 'utf-8');
  return { path: full, html };
}

module.exports = { generateHtml, saveHtmlReport };
