'use strict';
const assert = require('assert');
const { describe, it } = require('node:test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { extractPackageName, calculateByPackage, enrichPackages } = require('../src/scanner/size-calculator');
const { findDuplicates } = require('../src/analyzer/duplicate-finder');
const { findBloat } = require('../src/analyzer/bloat-detector');
const { getSuggestions } = require('../src/analyzer/suggestions');

describe('extractPackageName', () => {
  it('normal package', () => {
    assert.strictEqual(extractPackageName('node_modules/lodash/index.js'), 'lodash');
  });
  it('scoped package', () => {
    assert.strictEqual(extractPackageName('node_modules/@types/node/index.d.ts'), '@types/node');
  });
  it('nested', () => {
    assert.strictEqual(extractPackageName('/a/b/node_modules/react/node_modules/lodash/index.js'), 'lodash');
  });
  it('no node_modules', () => {
    assert.strictEqual(extractPackageName('src/index.js'), null);
  });
});

describe('calculateByPackage', () => {
  it('groups by package', () => {
    const entries = [
      { path: '/proj/node_modules/lodash/index.js', size: 100, isDir: false },
      { path: '/proj/node_modules/lodash/utils.js', size: 50, isDir: false },
      { path: '/proj/node_modules/react/index.js', size: 200, isDir: false },
      { path: '/proj/src/index.js', size: 10, isDir: false },
    ];
    const res = calculateByPackage(entries);
    const lodash = res.find(r => r.name === 'lodash');
    const react = res.find(r => r.name === 'react');
    assert.strictEqual(lodash.size, 150);
    assert.strictEqual(react.size, 200);
    assert.strictEqual(res.length, 2);
  });
});

describe('duplicate detection', () => {
  it('flags installCount >1', () => {
    const pkgs = [
      { name: 'lodash', version: '4.17.21', size: 5000, fileCount: 10, installCount: 2, installPaths: ['/a/node_modules/lodash', '/a/node_modules/x/node_modules/lodash'], category: 'utility' },
      { name: 'react', version: '18.0.0', size: 3000, fileCount: 5, installCount: 1, installPaths: ['/a/node_modules/react'], category: 'framework' },
    ];
    const dups = findDuplicates(pkgs);
    assert.strictEqual(dups.length, 1);
    assert.strictEqual(dups[0].packageName, 'lodash');
  });
});

describe('bloat detection', () => {
  it('flags large packages', () => {
    const pkgs = [
      { name: 'big', version: '1.0.0', size: 20 * 1024 * 1024, fileCount: 10, installCount: 1, installPaths: ['/a/node_modules/big'], category: 'library' },
      { name: 'small', version: '1.0.0', size: 1000, fileCount: 5, installCount: 1, installPaths: ['/a/node_modules/small'], category: 'utility' },
    ];
    const bloat = findBloat(pkgs, { maxPackageSizeMB: 10 });
    assert.strictEqual(bloat.length, 1);
    assert.strictEqual(bloat[0].name, 'big');
  });
});

describe('suggestions', () => {
  it('suggests replacement for moment', () => {
    const pkgs = [{ name: 'moment', version: '2.29.0', size: 300000, fileCount: 20, installCount: 1, installPaths: ['/a/node_modules/moment'], category: 'utility' }];
    const sugs = getSuggestions(pkgs);
    const hasMoment = sugs.some(s => s.from === 'moment' && s.to === 'dayjs');
    assert.ok(hasMoment, 'should suggest moment -> dayjs');
  });
});

describe('format', () => {
  it('formatBytes', () => {
    const { formatBytes } = require('../src/utils/format');
    assert.strictEqual(formatBytes(0), '0 B');
    assert.strictEqual(formatBytes(1024), '1 KB');
    assert.ok(formatBytes(1024*1024).includes('MB'));
  });
});
