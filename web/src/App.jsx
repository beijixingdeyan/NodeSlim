import React, { useEffect, useState, useRef } from 'react';

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes === 0) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes)/Math.log(k));
  return `${parseFloat((bytes/Math.pow(k,i)).toFixed(2))} ${sizes[i]}`;
}
function getQueryTarget(){ try{ return new URLSearchParams(location.search).get('target')||'' }catch{ return '' } }

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [scanning, setScanning] = useState(false);
  const [shallowMode, setShallowMode] = useState(false);
  const [target, setTarget] = useState(getQueryTarget());
  const [audit, setAudit] = useState(null);
  const [dedupe, setDedupe] = useState(null);
  const [importMap, setImportMap] = useState(null);
  const [importStatus, setImportStatus] = useState('');
  const folderRef = useRef(null);
  const fileRef = useRef(null);

  const api = (p) => {
    const t = target || getQueryTarget();
    const sep = p.includes('?') ? '&' : '?';
    return t ? `${p}${sep}target=${encodeURIComponent(t)}` : p;
  };

  const fetchLatest = async () => {
    try {
      setLoading(true);
      const res = await fetch(api('/api/report/latest'));
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const j = await res.json();
      setData(j); setError(''); setShallowMode(!!j.summary?.isEstimated);
      fetchExtras();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  const fetchExtras = async () => {
    try { const r = await fetch(api('/api/audit')); if(r.ok) setAudit(await r.json()); } catch{}
    try { const r = await fetch(api('/api/dedupe')); if(r.ok) setDedupe(await r.json()); } catch{}
    try { const r = await fetch(api('/api/import-map')); if(r.ok) setImportMap(await r.json()); } catch{}
  };
  const triggerScan = async (shallow=false) => {
    setScanning(true);
    try {
      const url = shallow ? api('/api/scan?mode=shallow') : api('/api/scan');
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchLatest();
    } catch (e) { setError(e.message); }
    finally { setScanning(false); }
  };
  useEffect(() => { fetchLatest(); }, []);

  // Import handlers - 显示真实文件夹路径（浏览器仅暴露相对路径，以首段文件夹名为准）
  const getFolderDisplay = (files) => {
    const p = files[0]?.webkitRelativePath || files[0]?._relative || '';
    const folder = p.includes('/') ? p.split('/')[0] : '';
    return folder ? `${folder} (本地)` : 'local-folder';
  };
  const handleFolder = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    const display = getFolderDisplay(Array.from(files));
    setImportStatus(`正在本地计算 ${display} — ${files.length} 个文件...`);
    const result = clientScanFromFileList(Array.from(files));
    // 覆盖为真实路径，避免只显示 local-folder
    result.root = result.meta.root = `${display} — ${result.totalPackages}包`;
    result.displayPath = display;
    setData(result); setShallowMode(false); setImportStatus(`✅ 本地文件夹扫描完成：${display} → ${result.totalPackages} 包，${formatBytes(result.totalSize)}`);
    e.target.value='';
  };
  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const pkgFile = files.find(f=>f.name==='package.json' || f.webkitRelativePath?.endsWith('package.json'));
    if (!pkgFile) { setImportStatus('未找到 package.json'); return; }
    const pkgPath = pkgFile.webkitRelativePath || pkgFile._relative || pkgFile.name;
    const pkgFolder = pkgPath.includes('/') ? pkgPath.substring(0, pkgPath.lastIndexOf('/')) : '';
    const displayPkgPath = pkgPath || 'package.json';
    const text = await pkgFile.text();
    const pj = JSON.parse(text);
    const lockFile = files.find(f=>f.name==='pnpm-lock.yaml'||f.name==='yarn.lock'||f.name==='package-lock.json');
    let lockContent=null, lockType='npm';
    if(lockFile){ lockContent=await lockFile.text(); if(lockFile.name.includes('pnpm')) lockType='pnpm'; else if(lockFile.name.includes('yarn')) lockType='yarn'; }
    try{
      const res = await fetch('/api/scan/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ packageJson: pj, lockfile: lockContent, lockType }) });
      if(res.ok){ const j=await res.json(); const disp = pkgFolder ? `${pkgFolder} (${j.root||pj.name})` : displayPkgPath; j.root=j.meta.root=disp; j.displayPath=displayPkgPath; setData(j); setShallowMode(true); setImportStatus(`✅ 少扫描完成：${displayPkgPath} → ${j.totalPackages} 包`); e.target.value=''; return; }
    }catch{}
    const result = clientShallowFromPackageJson(pj, lockContent);
    const disp2 = pkgFolder ? `${pkgFolder} (${result.root}) — 少扫描` : `${displayPkgPath} — 少扫描`;
    result.root=result.meta.root=disp2; result.displayPath=displayPkgPath;
    setData(result); setShallowMode(true); setImportStatus(`✅ 本地少扫描完成：${displayPkgPath} → ${result.totalPackages} 包`);
    e.target.value='';
  };
  const onDrop = async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    const arr = Array.from(files);
    const hasFolder = arr.some(f=>f.webkitRelativePath?.includes('/'));
    if (hasFolder) {
      const result = clientScanFromFileList(arr);
      const display = getFolderDisplay(arr);
      result.root=result.meta.root=`${display} — ${result.totalPackages}包`;
      setData(result); setImportStatus(`✅ 拖拽文件夹扫描：${display} → ${result.totalPackages} 包`);
    } else {
      const pkgFile = arr.find(f=>f.name==='package.json' || f.webkitRelativePath?.endsWith('package.json'));
      if (pkgFile) {
        const pkgPath=pkgFile.webkitRelativePath||pkgFile.name;
        const text = await pkgFile.text(); const pj = JSON.parse(text);
        const r=clientShallowFromPackageJson(pj, null); r.root=r.meta.root=pkgPath; setData(r); setShallowMode(true); setImportStatus(`✅ 拖拽少扫描完成：${pkgPath}`);
      }
    }
  };

  const summary = data?.summary || data || {};
  const packages = data?.packages || [];
  const duplicates = data?.duplicates || [];
  const bloat = data?.bloat || [];
  const suggestions = data?.suggestions || [];
  const security = data?.security || data?.issues?.filter(i=>i.type==='SECURITY') || [];
  const top10 = [...packages].sort((a,b)=>b.size-a.size).slice(0,10);
  const byCategory = packages.reduce((acc,p)=>{ const c=p.category||'unknown'; acc[c]=(acc[c]||0)+p.size; return acc; },{});

  return (
    <div className="min-h-screen">
      <header className="bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">📦 NodeSlim<span className="text-white/80 text-lg font-normal">智能优化面板</span></h1>
              <p className="mt-2 text-white/90 text-sm">{data?.meta?.root||data?.root||'—'} &nbsp;|&nbsp; {data?.meta?.packageManager||data?.packageManager||'—'} &nbsp;|&nbsp; {data?.meta?.generatedAt?new Date(data.meta.generatedAt).toLocaleString('zh-CN'):(data?.scannedAt?new Date(data.scannedAt).toLocaleString('zh-CN'):'')}</p>
              <p className="mt-2 flex gap-2 flex-wrap"><span className="bg-white/20 px-3 py-1 rounded-full text-xs">NodeSlim v{data?.meta?.version||'1.2.0'}</span>{shallowMode&&<span className="bg-white text-[#667eea] px-3 py-1 rounded-full text-xs font-bold">少扫描模式</span>}</p>
            </div>
            <div className="flex flex-col gap-2 items-end">
              <div className="flex gap-2">
                <button onClick={fetchLatest} className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm">🔄 刷新</button>
                <button onClick={()=>triggerScan(false)} disabled={scanning} className="bg-white text-[#667eea] px-5 py-2 rounded-lg text-sm font-bold shadow disabled:opacity-60">{scanning?'扫描中...':'⚡ 一键全量'}</button>
              </div>
              <button onClick={()=>triggerScan(true)} className="bg-white/20 border border-white/40 px-4 py-1.5 rounded-full text-xs">🍃 少扫描（秒级）</button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="bg-white rounded-xl border p-4 mb-6">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[240px]">
              <label className="text-xs font-semibold text-slate-600 uppercase">服务端目标路径</label>
              <div className="flex gap-2 mt-1">
                <input value={target} onChange={e=>setTarget(e.target.value)} placeholder="E:\my-project" className="flex-1 border rounded-lg px-3 py-2 text-sm"/>
                <button onClick={()=>{ const u=new URL(location.href); if(target) u.searchParams.set('target', target); else u.searchParams.delete('target'); history.replaceState({},'',u); fetchLatest(); }} className="bg-[#667eea] text-white px-4 py-2 rounded-lg text-sm">切换</button>
              </div>
            </div>
            <div className="flex gap-2">
              <label className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm cursor-pointer" title="本地全量：读取文件夹内所有文件真实 byte">📁 导入文件夹（本地全量）<input ref={folderRef} type="file" webkitdirectory="true" multiple className="hidden" onChange={handleFolder}/></label>
              <label className="bg-white border px-4 py-2 rounded-lg text-sm cursor-pointer" title="少扫描：仅 package.json 估算，秒级">📄 导入 package.json（少扫描）<input ref={fileRef} type="file" accept=".json,.yaml" multiple className="hidden" onChange={handleFiles}/></label>
            </div>
          </div>
          <div onDragOver={e=>e.preventDefault()} onDrop={onDrop} className="mt-4 border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-slate-50">
            <div className="text-2xl">📥</div>
            <div className="font-medium">拖拽 <b>package.json</b> / 整个文件夹到此处进行少扫描</div>
            <div className="text-xs text-slate-500">前端直接解析，无需上传服务器</div>
          </div>
          {importStatus && <div className="mt-3 text-sm bg-blue-50 border border-blue-200 rounded-lg p-3">{importStatus}</div>}
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {[
            ['overview','概览'],['packages','包列表'],['duplicates','重复'],['bloat','膨胀'],['suggestions','建议'],['security','安全'],['audit','审计'],['prod','Prod/Dev'],['platform','平台'],['importmap','Import Maps'],
          ].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} className={`px-4 py-2 rounded-full text-sm font-medium ${tab===k?'bg-[#667eea] text-white shadow':'bg-white text-slate-600 border'}`}>{l}</button>
          ))}
        </div>

        {loading && <div className="bg-white rounded-xl p-12 text-center text-slate-500">⏳ 加载中...</div>}
        {error && !loading && <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center"><div className="text-amber-700 font-medium">⚠️ {error}</div><button onClick={()=>triggerScan(false)} className="mt-4 bg-amber-500 text-white px-6 py-2 rounded-lg">立即扫描</button></div>}
        {!loading && !error && data && (
          <>
            {tab==='overview' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <StatCard label="总包数" value={summary.totalPackages} unit="packages" />
                  <StatCard label="总体积" value={formatBytes(summary.totalSize)} unit={`${summary.totalFiles||data.totalFiles||''} files`} highlight />
                  <StatCard label="重复" value={summary.duplicateCount??duplicates.length} unit={`浪费 ${formatBytes(summary.wastedSize)}`} danger={(summary.duplicateCount??0)>0} />
                  <StatCard label="可优化" value={formatBytes(summary.optimizableSize)} unit={summary.isEstimated?'估算':''} warn />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  <div className="bg-white rounded-xl p-6 border">
                    <h3 className="font-bold mb-2">📊 Top 10</h3>
                    {top10.map((p,i)=>{ const max=top10[0]?.size||1; return <div key={p.name} className="flex items-center gap-2 mb-1"><span className="w-6 text-xs">{i+1}</span><span className="flex-1 text-sm truncate">{p.name}<span className="text-slate-400">@{p.version}</span></span><div className="w-24 h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-[#667eea] to-[#764ba2]" style={{width:`${Math.round(p.size/max*100)}%`}}/></div><span className="w-20 text-right text-xs font-mono">{formatBytes(p.size)}</span></div> })}
                  </div>
                  <div className="bg-white rounded-xl p-6 border">
                    <h3 className="font-bold mb-2">🗂️ 按类别</h3>
                    {Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([c,s])=>{ const pct=(s/(summary.totalSize||1)*100).toFixed(1); return <div key={c} className="flex items-center gap-2 mb-2"><span className={`px-2 py-0.5 rounded-full text-xs text-white ${catColor(c)}`}>{c}</span><div className="flex-1 h-2 bg-slate-100 rounded-full"><div className="h-full bg-slate-600" style={{width:`${pct}%`}}/></div><span className="text-xs w-24 text-right">{formatBytes(s)} {pct}%</span></div> })}
                  </div>
                </div>
                <div className="bg-white rounded-xl p-6 border">
                  <h3 className="font-bold mb-3">💡 建议 (Top 5)</h3>
                  {suggestions.slice(0,5).map((s,i)=><div key={i} className="border-l-4 rounded-lg p-3 border mb-2" style={{borderLeftColor:sugColor(s.type)}}><div className="text-sm"><span className="bg-slate-100 px-2 py-0.5 rounded text-xs mr-2">{s.type}</span>{s.message}</div><div className="text-xs text-slate-500">→ {s.suggestion}</div></div>)}
                </div>
              </>
            )}
            {tab==='packages' && <PackagesTable packages={packages} />}
            {tab==='duplicates' && <DuplicatesView duplicates={duplicates} dedupe={dedupe} />}
            {tab==='bloat' && <BloatView bloat={bloat} />}
            {tab==='suggestions' && <div className="space-y-2">{suggestions.map((s,i)=><div key={i} className="bg-white rounded-xl p-4 border border-l-4" style={{borderLeftColor:sugColor(s.type)}}><div className="font-bold text-sm">{s.type} {s.packageName}</div><div className="text-sm">{s.message}</div><div className="text-xs text-slate-500">→ {s.suggestion}</div></div>)}</div>}
            {tab==='security' && <SecurityView security={security} />}
            {tab==='audit' && <AuditView audit={audit} />}
            {tab==='prod' && <ProdView audit={audit} />}
            {tab==='platform' && <PlatformView audit={audit} />}
            {tab==='importmap' && <ImportMapView importMap={importMap} />}
          </>
        )}
      </div>
      <footer className="text-center text-slate-400 text-xs py-8">NodeSlim v{data?.meta?.version||'1.2.0'}</footer>
    </div>
  );
}
function PackagesTable({packages}){
  const [q,setQ]=useState('');
  const filtered=[...packages].sort((a,b)=>b.size-a.size).filter(p=>!q||p.name.includes(q));
  return <div className="bg-white rounded-xl border overflow-hidden"><div className="p-3 flex justify-between gap-2"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="搜索" className="border rounded px-3 py-1 text-sm flex-1"/><span className="text-xs text-slate-500">{filtered.length} 包</span></div><div className="overflow-auto max-h-[60vh]"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2">#</th><th className="p-2">包名</th><th className="p-2 text-right">体积</th><th className="p-2">类型</th></tr></thead><tbody>{filtered.map((p,i)=><tr key={i} className="border-t"><td className="p-2">{i+1}</td><td className="p-2 font-mono">{p.name}@{p.version}</td><td className="p-2 text-right">{formatBytes(p.size)}</td><td className="p-2"><span className={`px-2 py-0.5 rounded-full text-xs text-white ${catColor(p.category)}`}>{p.category}</span></td></tr>)}</tbody></table></div></div>;
}
function DuplicatesView({duplicates, dedupe}){
  return <div><div className="bg-white rounded-xl border overflow-hidden"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2">包名</th><th className="p-2">次数</th><th className="p-2">版本</th></tr></thead><tbody>{duplicates.map((d,i)=><tr key={i} className="border-t"><td className="p-2 font-mono">{d.packageName}</td><td className="p-2 text-red-600">{d.count}×</td><td className="p-2 font-mono text-xs">{(d.versions||[]).join(', ')}</td></tr>)}{!duplicates.length&&<tr><td colSpan={3} className="p-8 text-center text-green-600">✅ 无重复</td></tr>}</tbody></table></div>{dedupe?.needed&&<div className="mt-4 bg-white rounded-xl border p-4"><h4 className="font-bold">去重方案</h4><pre className="bg-slate-900 text-green-300 p-3 rounded text-xs overflow-auto">{JSON.stringify(dedupe.overrides,null,2)}</pre></div>}</div>;
}
function BloatView({bloat}){ return <div className="bg-white rounded-xl border overflow-hidden"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2">包名</th><th className="p-2 text-right">体积</th><th className="p-2">原因</th></tr></thead><tbody>{bloat.map((b,i)=><tr key={i} className="border-t"><td className="p-2 font-mono">{b.name}</td><td className="p-2 text-right">{b.sizeFormatted||formatBytes(b.size)}</td><td className="p-2 text-xs">{b.reason}</td></tr>)}{!bloat.length&&<tr><td colSpan={3} className="p-8 text-center text-green-600">✅ 无膨胀</td></tr>}</tbody></table></div>; }
function SecurityView({security}){ return <div className="bg-white rounded-xl border overflow-hidden"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2">级别</th><th className="p-2">包名</th><th className="p-2">问题</th></tr></thead><tbody>{security.map((s,i)=><tr key={i} className="border-t"><td className="p-2"><span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">{s.severity}</span></td><td className="p-2 font-mono">{s.packageName}</td><td className="p-2">{s.message}</td></tr>)}{!security.length&&<tr><td colSpan={3} className="p-8 text-center text-green-600">✅ 无漏洞</td></tr>}</tbody></table></div>; }
function AuditView({audit}){ if(!audit) return <div className="bg-white rounded-xl p-8 text-center text-slate-500">暂无审计数据</div>; return <div className="space-y-4"><div className="bg-white rounded-xl p-4 border">未使用 {audit.usage?.unused?.length||0} | 幽灵 {audit.usage?.ghost?.length||0} | 按需 {audit.usage?.onDemandIssues?.length||0}</div><div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{['unused','ghost','onDemandIssues'].map(k=><div key={k} className="bg-white rounded-xl p-4 border"><h4 className="font-bold">{k}</h4><pre className="text-xs overflow-auto max-h-40">{JSON.stringify(audit.usage?.[k]?.slice(0,3)||[],null,2)}</pre></div>)}</div></div>; }
function ProdView({audit}){ const prod=audit?.prod; if(!prod) return <div className="bg-white rounded-xl p-8 text-center">暂无数据</div>; return <div className="bg-white rounded-xl p-6 border"><div className="grid grid-cols-3 gap-3 text-center"><div className="bg-green-50 p-3 rounded"><div className="text-xs">生产</div><div className="font-bold">{prod.prod?.sizeFormatted}</div></div><div className="bg-amber-50 p-3 rounded"><div className="text-xs">开发</div><div className="font-bold">{prod.dev?.sizeFormatted}</div><div className="text-xs">{Math.round((prod.dev?.ratio||0)*100)}%</div></div><div className="bg-slate-50 p-3 rounded"><div className="text-xs">间接</div><div className="font-bold">{prod.indirect?.sizeFormatted}</div></div></div><div className="mt-3 text-sm">{prod.suggestion}</div></div>; }
function PlatformView({audit}){ const p=audit?.platform; if(!p) return <div className="bg-white rounded-xl p-8 text-center">暂无数据</div>; return <div className="bg-white rounded-xl p-6 border"><div>当前 {p.currentPlatform} — 浪费 {p.wastedFormatted}</div><div className="text-sm text-slate-500">{p.suggestion}</div></div>; }
function ImportMapView({importMap}){ if(!importMap) return <div className="bg-white rounded-xl p-8 text-center">暂无数据</div>; return <div className="bg-white rounded-xl p-6 border"><pre className="bg-slate-900 text-slate-100 p-4 rounded text-xs overflow-auto max-h-64">{importMap.json||JSON.stringify(importMap.importMap,null,2)}</pre></div>; }
function StatCard({label,value,unit,highlight,danger,warn}){ return <div className="bg-white rounded-xl p-5 border"><div className="text-xs uppercase text-slate-500">{label}</div><div className={`text-2xl font-bold ${highlight?'text-green-600':danger?'text-red-600':warn?'text-amber-600':''}`}>{value??'—'}</div><div className="text-xs text-slate-500">{unit}</div></div>; }
function catColor(c){ const m={framework:'bg-blue-500','build-tool':'bg-green-500',utility:'bg-orange-500',types:'bg-slate-400',testing:'bg-red-500',library:'bg-purple-500'}; return m[c]||'bg-slate-400'; }
function sugColor(t){ if(t==='REPLACE') return '#4299e1'; if(t==='MIGRATION') return '#48bb78'; if(t==='CLEAN') return '#ed8936'; return '#a0aec0'; }

// Client helpers for folder import - 显示相对路径（浏览器安全限制仅能获取文件夹名）
function clientShallowFromPackageJson(pj, lockContent){
  const allDeps={ ...pj.dependencies, ...pj.devDependencies };
  const known={ 'react':200*1024, 'react-dom':3*1024*1024, 'typescript':60*1024*1024 };
  const pkgs=Object.keys(allDeps).map(name=>({ name, version:String(allDeps[name]).replace(/^[\^~]/,''), size: known[name]||120*1024, fileCount:10, installCount:1, installPaths:[`/virtual/${name}`], category:'library', isDirectDependency:true }));
  const total=pkgs.reduce((s,p)=>s+p.size,0);
  return { root:pj.name||'imported', packageManager:'unknown', packages:pkgs, totalPackages:pkgs.length, totalSize:total, totalFiles:0, duplicates:[], bloat:[], suggestions:[], security:[], summary:{totalPackages:pkgs.length,totalSize:total,totalFiles:0,duplicateCount:0,bloatCount:0,optimizableSize:total*0.2,wastedSize:0,isEstimated:true}, meta:{root:pj.name||'imported',generatedAt:new Date().toISOString(),version:'1.2.0'}, scannedAt:new Date().toISOString() };
}
function clientScanFromFileList(files){
  const map=new Map();
  function extractName(p){ const normalized=p.replace(/\\/g,'/'); const idx=normalized.lastIndexOf('node_modules/'); if(idx===-1) return null; const after=normalized.slice(idx+'node_modules/'.length); const parts=after.split('/'); const first=parts[0]; if(!first || first.startsWith('.')) return null; if(first.startsWith('@')) { if(parts.length>=2 && parts[1].startsWith('.')) return null; return parts.length>=2? parts.slice(0,2).join('/'):first; } return first; }
  const firstPath=files[0]?.webkitRelativePath||files[0]?._relative||'';
  const folderName=firstPath ? firstPath.split('/')[0] : 'local-folder';
  const displayRoot=folderName && folderName!=='local-folder' ? `${folderName} (本地文件夹)` : 'local-folder';
  for(const f of files){ const p=f.webkitRelativePath||f._relative||f.name; if(!p.includes('node_modules/')) continue; const n=extractName(p); if(!n) continue; if(!map.has(n)) map.set(n,{name:n,size:0,fileCount:0,paths:new Set()}); const e=map.get(n); e.size+=f.size; e.fileCount++; e.paths.add(p.slice(0, p.indexOf('node_modules/')+('node_modules/'+n).length)); }
  const pkgs=Array.from(map.values()).map(v=>({name:v.name,size:v.size,fileCount:v.fileCount,installPaths:Array.from(v.paths),installCount:v.paths.size,version:'unknown',category:'library'}));
  const total=pkgs.reduce((s,p)=>s+p.size,0);
  return { root:displayRoot, packageManager:'unknown', packages:pkgs, totalPackages:pkgs.length, totalSize:total, totalFiles:files.length, duplicates:pkgs.filter(p=>p.installCount>1).map(p=>({packageName:p.name,count:p.installCount,versions:[p.version],totalSize:p.size,wastedSize:p.size-p.size/p.installCount})), bloat:[], suggestions:[], security:[], summary:{totalPackages:pkgs.length,totalSize:total,totalFiles:files.length,duplicateCount:pkgs.filter(p=>p.installCount>1).length,bloatCount:0,optimizableSize:total*0.2,wastedSize:0}, meta:{root:displayRoot,generatedAt:new Date().toISOString(),version:'1.2.0'}, scannedAt:new Date().toISOString(), folderName, displayRoot };
}
