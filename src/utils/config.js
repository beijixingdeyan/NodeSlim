'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  version: '1.0.0',
  scan: {
    target: '.',
    maxDepth: 10,
    exclude: ['node_modules/.cache', 'node_modules/.bin'],
    includeDevDependencies: true,
  },
  thresholds: {
    totalSizeMB: 100,
    maxPackageSizeMB: 10,
    maxDuplicateCount: 5,
    maxBloatRatio: 0.3,
  },
  clean: {
    enabled: true,
    patterns: ['test', 'tests', '__tests__', 'docs', 'doc', '*.md', '*.map', '.github', '.travis.yml', '.circleci'],
    excludePackages: ['@types/*'],
  },
  optimize: {
    suggestReplacements: true,
    suggestMigration: true,
    autoApplySafe: false,
  },
  report: {
    format: 'html',
    outputDir: '.nodeslim/reports',
    keepHistory: 10,
  },
  ci: {
    failOnThreshold: true,
    commentOnPR: true,
    uploadArtifact: true,
  },
};

function findConfig(startDir = process.cwd()) {
  const candidates = ['.nodeslimrc.json', '.nodeslimrc', 'nodeslim.config.json'];
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    for (const name of candidates) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  // also check default location in this project
  const local = path.join(startDir, '.nodeslimrc.json');
  if (fs.existsSync(local)) return local;
  return null;
}

function loadConfig(targetDir) {
  const configPath = findConfig(targetDir || process.cwd());
  if (!configPath) return { config: DEFAULT_CONFIG, path: null };
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // shallow merge
    const merged = deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), parsed);
    return { config: merged, path: configPath };
  } catch (e) {
    return { config: DEFAULT_CONFIG, path: configPath, error: e.message };
  }
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function initConfig(targetDir = process.cwd()) {
  const dest = path.join(path.resolve(targetDir), '.nodeslimrc.json');
  if (fs.existsSync(dest)) {
    return { created: false, path: dest };
  }
  fs.writeFileSync(dest, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
  return { created: true, path: dest };
}

module.exports = { DEFAULT_CONFIG, loadConfig, findConfig, initConfig, deepMerge };
