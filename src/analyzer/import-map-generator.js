'use strict';
const fs = require('fs');
const path = require('path');

function generateImportMap(packages, opts = {}) {
  const cdnBase = opts.cdnBase || 'https://esm.sh';
  const mappings = {};
  const sorted = [...packages].sort((a,b)=>b.size-a.size).slice(0, opts.limit || 20);
  for (const p of sorted) {
    // skip scoped types and subpaths
    if (p.name.startsWith('@types/')) continue;
    mappings[p.name] = `${cdnBase}/${p.name}@${p.version}`;
    // also add common subpath for lodash etc
    if (p.name === 'lodash') mappings['lodash/'] = `${cdnBase}/lodash@4.17.21/`;
    if (p.name === 'react') {
      mappings['react'] = `${cdnBase}/react@18.2.0`;
      mappings['react-dom'] = `${cdnBase}/react-dom@18.2.0`;
    }
  }

  const importMap = {
    imports: mappings,
  };

  return {
    importMap,
    json: JSON.stringify(importMap, null, 2),
    htmlSnippet: `<script type="importmap">\n${JSON.stringify(importMap, null, 2)}\n</script>`,
    denoSnippet: `// Deno 零安装示例\nimport React from "${cdnBase}/react@18.2.0";`,
    suggestion: `已生成 ${Object.keys(mappings).length} 条映射，可用于 Deno / 浏览器原生 import maps，或 Node --experimental-vm-modules 实验特性`,
  };
}

function saveImportMap(projectRoot, packages, opts = {}) {
  const { importMap, json } = generateImportMap(packages, opts);
  const dest = path.join(projectRoot, opts.filename || 'import-map.json');
  if (!opts.dryRun) fs.writeFileSync(dest, json, 'utf-8');
  return { path: dest, importMap, saved: !opts.dryRun };
}

module.exports = { generateImportMap, saveImportMap };
