'use strict';
const { buildReport, saveJsonReport } = require('./json-reporter');
const { generateHtml, saveHtmlReport } = require('./html-reporter');
const { generateMarkdown, saveMarkdownReport } = require('./markdown-reporter');
const terminal = require('./terminal-reporter');

async function saveAllReports(scanResult, opts = {}) {
  const outputDir = opts.outputDir;
  const results = {};
  results.json = await saveJsonReport(scanResult, { outputDir });
  results.html = await saveHtmlReport(scanResult, { outputDir });
  results.markdown = await saveMarkdownReport(scanResult, { outputDir });
  return results;
}

module.exports = {
  buildReport,
  saveJsonReport,
  generateHtml,
  saveHtmlReport,
  generateMarkdown,
  saveMarkdownReport,
  saveAllReports,
  terminal,
};
