// Example: programmatically use NodeSlim as a library
const path = require('path');
const { scanProject } = require('../src/scanner');

async function main() {
  const target = process.argv[2] || process.cwd();
  console.log(`Scanning ${target} ...`);
  const result = await scanProject(target, {});
  console.log(`Found ${result.totalPackages} packages, ${require('../src/utils/format').formatBytes(result.totalSize)}`);
  console.log('Top 3:', result.packages.sort((a,b)=>b.size-a.size).slice(0,3).map(p=>`${p.name}@${p.version} ${require('../src/utils/format').formatBytes(p.size)}`).join(', '));
}

main().catch(e=>{ console.error(e); process.exit(1); });
