'use strict';
const fs = require('fs');
const path = require('path');

function detectCurrentPM(projectRoot) {
  const root = path.resolve(projectRoot);
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  return 'npm';
}

function migrationPlan(from, to) {
  const valid = ['npm', 'pnpm', 'yarn', 'bun'];
  if (!valid.includes(to)) throw new Error(`Invalid target package manager: ${to}. Valid: ${valid.join(', ')}`);
  if (from === to) return { from, to, steps: [{ action: 'noop', description: `Already using ${to}` }] };

  const steps = [];

  // Backup
  steps.push({ action: 'backup', description: 'Backup lockfile and node_modules (creates .nodeslim/backup-*)', command: null });

  if (from === 'npm' && to === 'pnpm') {
    steps.push({ action: 'install-tool', description: 'Ensure pnpm is installed', command: 'npm install -g pnpm  (or corepack enable)' });
    steps.push({ action: 'clean', description: 'Remove node_modules and package-lock.json', command: 'rm -rf node_modules package-lock.json' });
    steps.push({ action: 'import', description: 'Import npm lockfile (pnpm can auto-import)', command: 'pnpm import  # or just pnpm install' });
    steps.push({ action: 'install', description: 'Install with pnpm', command: 'pnpm install' });
    steps.push({ action: 'verify', description: 'Verify installation', command: 'pnpm list --depth=0' });
  } else if (from === 'npm' && to === 'yarn') {
    steps.push({ action: 'install-tool', description: 'Ensure yarn is installed', command: 'npm install -g yarn  (or corepack enable)' });
    steps.push({ action: 'clean', description: 'Remove node_modules and package-lock.json', command: 'rm -rf node_modules package-lock.json' });
    steps.push({ action: 'install', description: 'Install with yarn', command: 'yarn install' });
  } else if (from === 'npm' && to === 'bun') {
    steps.push({ action: 'install-tool', description: 'Ensure bun is installed', command: 'curl -fsSL https://bun.sh/install | bash  or  npm install -g bun' });
    steps.push({ action: 'clean', description: 'Remove node_modules and package-lock.json', command: 'rm -rf node_modules package-lock.json' });
    steps.push({ action: 'install', description: 'Install with bun', command: 'bun install' });
  } else if (from === 'pnpm' && to === 'npm') {
    steps.push({ action: 'clean', description: 'Remove node_modules, pnpm-lock.yaml, .pnpm-store references', command: 'rm -rf node_modules pnpm-lock.yaml' });
    steps.push({ action: 'install', description: 'Install with npm', command: 'npm install' });
  } else if (from === 'yarn' && to === 'pnpm') {
    steps.push({ action: 'install-tool', description: 'Ensure pnpm is installed', command: 'npm install -g pnpm' });
    steps.push({ action: 'clean', description: 'Remove node_modules and yarn.lock', command: 'rm -rf node_modules yarn.lock' });
    steps.push({ action: 'install', description: 'Install with pnpm', command: 'pnpm install' });
  } else {
    steps.push({ action: 'clean', description: `Remove node_modules and ${from} lockfile`, command: `rm -rf node_modules ${lockFileFor(from)}` });
    steps.push({ action: 'install', description: `Install with ${to}`, command: `${to} install` });
  }

  steps.push({ action: 'packageManager-field', description: `Optionally set packageManager field in package.json: "${to}"`, command: `Add "packageManager": "${to}@latest" to package.json` });

  return { from, to, steps };
}

function lockFileFor(pm) {
  switch (pm) {
    case 'pnpm': return 'pnpm-lock.yaml';
    case 'yarn': return 'yarn.lock';
    case 'bun': return 'bun.lockb';
    case 'npm':
    default: return 'package-lock.json';
  }
}

async function executeMigration(projectRoot, targetPM, opts = {}) {
  const root = path.resolve(projectRoot);
  const dryRun = opts.dryRun ?? true;
  const from = detectCurrentPM(root);
  const plan = migrationPlan(from, targetPM);

  if (dryRun) {
    return { from, to: targetPM, dryRun: true, plan, executed: false };
  }

  // Backup phase
  const backupDir = path.join(root, `.nodeslim/backup-${Date.now()}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const lockFile = lockFileFor(from);
  const lockPath = path.join(root, lockFile);
  if (fs.existsSync(lockPath)) {
    fs.copyFileSync(lockPath, path.join(backupDir, lockFile));
  }
  const pkgJsonPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    fs.copyFileSync(pkgJsonPath, path.join(backupDir, 'package.json'));
  }

  // Optional: update packageManager field
  if (opts.updatePackageJson !== false) {
    try {
      const pkgRaw = fs.readFileSync(pkgJsonPath, 'utf-8');
      const pkg = JSON.parse(pkgRaw);
      pkg.packageManager = `${targetPM}@latest`;
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2), 'utf-8');
    } catch {}
  }

  // We do NOT actually delete node_modules or run install automatically, to stay safe.
  // Instead we provide the plan and let user confirm.
  // If opts.forceExecute, we would do deletion + spawn install — but we keep it manual for safety.
  if (opts.forceExecute) {
    // dangerous path: actually execute
    const { execSync } = require('child_process');
    try {
      if (fs.existsSync(path.join(root, 'node_modules'))) {
        fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
      }
      if (fs.existsSync(lockPath)) fs.rmSync(lockPath, { force: true });
      execSync(`${targetPM} install`, { cwd: root, stdio: 'inherit' });
      return { from, to: targetPM, dryRun: false, plan, executed: true, backupDir };
    } catch (e) {
      return { from, to: targetPM, dryRun: false, plan, executed: false, error: e.message, backupDir };
    }
  }

  return { from, to: targetPM, dryRun: false, plan, executed: false, backupDir, message: 'Backup created. Run the commands in the plan manually, or re-run with --force to auto-execute.' };
}

module.exports = { detectCurrentPM, migrationPlan, executeMigration, lockFileFor };
