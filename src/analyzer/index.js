'use strict';
const { findDuplicates } = require('./duplicate-finder');
const { findBloat, detectIssues } = require('./bloat-detector');
const { scanSecurity } = require('./security-scanner');
const { analyzeBundle } = require('./bundle-analyzer');
const { getSuggestions } = require('./suggestions');

module.exports = {
  findDuplicates,
  findBloat,
  detectIssues,
  scanSecurity,
  analyzeBundle,
  getSuggestions,
};
