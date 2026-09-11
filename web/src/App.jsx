import React, { useEffect, useState } from 'react';

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes === 0) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes)/Math.log(k));
  return `${parseFloat((bytes/Math.pow(k,i)).toFixed(2))} ${sizes[i]}`;
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [scanning, setScanning] = useState(false);

  const fetchLatest = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/report/latest');
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const j = await res.json();
      setData(j);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  const triggerScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/scan');
      if (!res.ok) throw new Error((await res.json()).error);
      const j = await res.json();
      // j is scan result; but dashboard expects latest.json shape via /api/report/latest; fetch again
      await fetchLatest();
    } catch (e) {
      setError(e.message);
    } finally { setScanning(false); }
  };

  useEffect(() => { fetchLatest(); }, []);

  const summary = data?.summary || data || {};
  const packages = data?.packages || [];
  const duplicates = data?.duplicates || [];
  const bloat = data?.bloat || [];
  const suggestions = data?.suggestions || [];
  const security = data?.security || data?.issues?.filter(i=>i.type==='SECURITY') || [];

  const top10 = [...packages].sort((a,b)=>b.size-a.size).slice(0,10);
  const byCategory = packages.reduce((acc,p)=>{
    const c = p.category || 'unknown';
    acc[c] = (acc[c]||0)+ p.size;
    return acc;
  },{});

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">📦 NodeSlim<span className="text-white/80 text-lg font-normal">智能优化面板</span></h1>
              <p className="mt-2 text-white/90 text-sm">{data?.meta?.root || '—'} &nbsp;|&nbsp; {data?.meta?.packageManager || '—'} &nbsp;|&nbsp; {data?.meta?.generatedAt ? new Date(data.meta.generatedAt).toLocaleString('zh-CN') : ''}</p>
              <p className="mt-3"><span className="bg-white/20 px-3 py-1 rounded-full text-xs">NodeSlim v{data?.meta?.version || '1.2.0'} — 从 850MB 到 50MB，一键诊断</span></p>
            </div>
            <div className="flex gap-3">
              <button onClick={fetchLatest} className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium transition">🔄 刷新</button>
              <button onClick={triggerScan} disabled={scanning} className="bg-white text-[#667eea] hover:bg-white/90 px-5 py-2 rounded-lg text-sm font-bold shadow transition disabled:opacity-60">
                {scanning ? '⏳ 扫描中...' : '⚡ 一键扫描'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {[
            ['overview','概览'],
            ['packages','包列表'],
            ['duplicates','重复依赖'],
            ['bloat','膨胀分析'],
            ['suggestions','优化建议'],
            ['security','安全'],
          ].map(([k,label])=>(
            <button key={k} onClick={()=>setTab(k)} className={`px-4 py-2 rounded-full text-sm font-medium transition ${tab===k?'bg-[#667eea] text-white shadow':'bg-white text-slate-600 hover:bg-slate-100 border'}`}>{label}</button>
          ))}
        </div>

        {loading && <div className="bg-white rounded-xl p-12 text-center text-slate-500">⏳ 加载中...</div>}
        {error && !loading && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
            <div className="text-amber-700 font-medium">⚠️ {error}</div>
            <p className="text-sm text-slate-600 mt-2">请先在项目根目录运行 <code className="bg-slate-100 px-2 py-1 rounded">nodeslim scan</code> 生成报告，或点击“一键扫描”</p>
            <button onClick={triggerScan} className="mt-4 bg-amber-500 text-white px-6 py-2 rounded-lg font-medium">立即扫描</button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {tab==='overview' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <StatCard label="总包数" value={summary.totalPackages} unit="packages" />
                  <StatCard label="总体积" value={formatBytes(summary.totalSize)} unit={`${summary.totalFiles||''} files`} highlight />
                  <StatCard label="重复依赖" value={summary.duplicateCount} unit={`浪费 ${formatBytes(summary.wastedSize)}`} danger={summary.duplicateCount>0} />
                  <StatCard label="可优化" value={formatBytes(summary.optimizableSize)} unit="estimated" warn />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  <div className="bg-white rounded-xl p-6 shadow-sm border">
                    <h3 className="font-bold mb-3">📊 体积分布 (Top 10)</h3>
                    <div className="space-y-2">
                      {top10.map((p,i)=>{
                        const max = top10[0]?.size || 1;
                        return (
                          <div key={p.name} className="flex items-center gap-3">
                            <span className="w-6 text-xs text-slate-500">{i+1}</span>
                            <span className="flex-1 text-sm font-medium truncate" title={p.name}>{p.name}<span className="text-slate-400">@{p.version}</span></span>
                            <div className="w-32 h-3 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-[#667eea] to-[#764ba2]" style={{width: `${Math.round(p.size/max*100)}%`}} />
                            </div>
                            <span className="w-20 text-right text-sm font-mono">{formatBytes(p.size)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-6 shadow-sm border">
                    <h3 className="font-bold mb-3">🗂️ 按类别聚合</h3>
                    <div className="space-y-3">
                      {Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([cat,size])=>{
                        const total = summary.totalSize || 1;
                        const pct = (size/total*100).toFixed(1);
                        return (
                          <div key={cat} className="flex items-center gap-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${catColor(cat)}`}>{cat}</span>
                            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-slate-600" style={{width: `${pct}%`}} />
                            </div>
                            <span className="text-sm font-mono w-24 text-right">{formatBytes(size)} ({pct}%)</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-6">
                      <h4 className="font-semibold text-sm mb-2">💡 快速操作</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <CodeBlock label="清理预览" code="nodeslim optimize --clean --dry-run" />
                        <CodeBlock label="迁移 pnpm" code="nodeslim optimize --migrate pnpm" />
                        <CodeBlock label="深度分析" code="nodeslim analyze --duplicates" />
                        <CodeBlock label="生成报告" code="nodeslim report --export html" />
                      </div>
                    </div>
                  </div>
                </div>

                {suggestions.length>0 && (
                  <div className="bg-white rounded-xl p-6 shadow-sm border">
                    <h3 className="font-bold mb-3">💡 优化建议（Top 5）</h3>
                    <div className="space-y-3">
                      {suggestions.slice(0,5).map((s,i)=>(
                        <div key={i} className="border rounded-lg p-4 border-l-4" style={{borderLeftColor: sugColor(s.type)}}>
                          <div className="font-medium text-sm"><span className="text-xs bg-slate-100 px-2 py-0.5 rounded mr-2">{s.type}</span>{s.message}</div>
                          <div className="text-sm text-slate-600 mt-1">→ {s.suggestion}</div>
                          {s.estimatedSavings && <div className="text-sm text-green-600 mt-1">预计节省: <b>{s.estimatedSavings}</b></div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {tab==='packages' && (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="p-4 flex items-center justify-between border-b">
                  <h3 className="font-bold">📦 全部包 ({packages.length}) — 按体积排序</h3>
                  <span className="text-xs text-slate-500">安装 ×N 表示该包被多处安装（重复）</span>
                </div>
                <div className="overflow-auto max-h-[70vh]">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr className="text-left text-slate-600">
                        <th className="p-3">#</th><th className="p-3">包名</th><th className="p-3 text-right">体积</th><th className="p-3 text-right">文件</th><th className="p-3">类型</th><th className="p-3">安装</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...packages].sort((a,b)=>b.size-a.size).map((p,i)=>(
                        <tr key={p.name+i} className="border-t hover:bg-slate-50">
                          <td className="p-3 text-slate-500">{i+1}</td>
                          <td className="p-3 font-mono">{p.name}<span className="text-slate-400">@{(p.version||'').slice(0,12)}</span></td>
                          <td className="p-3 text-right font-mono">{formatBytes(p.size)}</td>
                          <td className="p-3 text-right">{p.fileCount}</td>
                          <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs text-white ${catColor(p.category)}`}>{p.category}</span></td>
                          <td className="p-3">{p.installCount>1?<span className="text-red-600 font-bold">{p.installCount}×</span>:'1'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab==='duplicates' && (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="p-4 border-b">
                  <h3 className="font-bold">♻️ 重复依赖 ({duplicates.length})</h3>
                  <p className="text-sm text-slate-500 mt-1">同一包被多版本/多路径安装，浪费磁盘与安装时间；建议用 overrides/resolutions 统一版本或迁移 pnpm。</p>
                </div>
                {duplicates.length===0 ? <div className="p-12 text-center text-green-600">✅ 无重复依赖 — 依赖去重良好</div> : (
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left text-slate-600"><th className="p-3">包名</th><th className="p-3">次数</th><th className="p-3">版本</th><th className="p-3 text-right">总计</th><th className="p-3 text-right">浪费</th></tr>
                      </thead>
                      <tbody>
                        {duplicates.map(d=>(
                          <tr key={d.packageName} className="border-t hover:bg-slate-50">
                            <td className="p-3 font-mono font-medium">{d.packageName}</td>
                            <td className="p-3 text-red-600 font-bold">{d.count}×</td>
                            <td className="p-3 font-mono text-xs">{d.versions.join(', ')}</td>
                            <td className="p-3 text-right font-mono">{formatBytes(d.totalSize)}</td>
                            <td className="p-3 text-right font-mono text-red-600">{formatBytes(d.wastedSize)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab==='bloat' && (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="p-4 border-b"><h3 className="font-bold">🐘 膨胀包 ({bloat.length})</h3></div>
                {bloat.length===0 ? <div className="p-12 text-center text-green-600">✅ 无膨胀包</div> : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50"><tr className="text-left text-slate-600"><th className="p-3">包名</th><th className="p-3 text-right">体积</th><th className="p-3">文件</th><th className="p-3">级别</th><th className="p-3">原因</th></tr></thead>
                    <tbody>
                      {bloat.map(b=>(
                        <tr key={b.name} className="border-t hover:bg-slate-50">
                          <td className="p-3 font-mono">{b.name}@{b.version}</td>
                          <td className="p-3 text-right font-mono">{b.sizeFormatted || formatBytes(b.size)}</td>
                          <td className="p-3">{b.fileCount}</td>
                          <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${sevClass(b.severity)}`}>{b.severity}</span></td>
                          <td className="p-3 text-slate-600">{b.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {tab==='suggestions' && (
              <div className="space-y-3">
                {suggestions.map((s,i)=>(
                  <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-l-4" style={{borderLeftColor: sugColor(s.type)}}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-bold text-sm flex items-center gap-2"><span className="bg-slate-100 px-2 py-0.5 rounded text-xs">{s.type}</span>{s.packageName && <span className="font-mono text-[#667eea]">{s.packageName}</span>}</div>
                        <div className="mt-1 text-sm">{s.message}</div>
                        <div className="mt-2 text-sm text-slate-600">💡 {s.suggestion}</div>
                      </div>
                      {s.estimatedSavings && <span className="shrink-0 bg-green-50 text-green-700 px-3 py-1 rounded-full text-xs font-bold">节省 {s.estimatedSavings}</span>}
                    </div>
                  </div>
                ))}
                {suggestions.length===0 && <div className="bg-white rounded-xl p-12 text-center text-slate-500">暂无建议</div>}
              </div>
            )}

            {tab==='security' && (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="p-4 border-b"><h3 className="font-bold">🔒 安全扫描 ({security.length})</h3></div>
                {security.length===0 ? <div className="p-12 text-center text-green-600">✅ 未发现已知漏洞</div> : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50"><tr className="text-left text-slate-600"><th className="p-3">级别</th><th className="p-3">包名</th><th className="p-3">问题</th><th className="p-3">建议</th></tr></thead>
                    <tbody>
                      {security.map((s,i)=>(
                        <tr key={i} className="border-t hover:bg-slate-50">
                          <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${sevClass(s.severity)}`}>{s.severity}</span></td>
                          <td className="p-3 font-mono">{s.packageName||'—'}</td>
                          <td className="p-3">{s.message}</td>
                          <td className="p-3 text-slate-600">{s.suggestion||''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <footer className="text-center text-slate-400 text-xs py-8">Generated by NodeSlim v{data?.meta?.version || '1.2.0'} • <a href="https://github.com/your-org/nodeslim" className="text-[#667eea] hover:underline">GitHub</a></footer>
    </div>
  );
}

function StatCard({ label, value, unit, highlight, danger, warn }){
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border">
      <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${highlight?'text-green-600': danger?'text-red-600': warn?'text-amber-600':''}`}>{value ?? '—'}</div>
      <div className="text-xs text-slate-500">{unit}</div>
    </div>
  );
}
function CodeBlock({ label, code }){
  return <div className="bg-slate-900 text-slate-100 rounded-lg p-2"><div className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</div><code className="text-xs font-mono">{code}</code></div>;
}
function catColor(cat){
  const map = { 'framework':'bg-blue-500','build-tool':'bg-green-500','utility':'bg-orange-500','types':'bg-slate-400','testing':'bg-red-500','library':'bg-purple-500','unknown':'bg-slate-400' };
  return map[cat]||'bg-slate-400';
}
function sevClass(s){
  const v = String(s).toLowerCase();
  if (v==='critical'||v==='error') return 'bg-red-100 text-red-700';
  if (v==='warning'||v==='high') return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
}
function sugColor(t){
  if (t==='REPLACE') return '#4299e1';
  if (t==='MIGRATION') return '#48bb78';
  if (t==='CLEAN') return '#ed8936';
  return '#a0aec0';
}
