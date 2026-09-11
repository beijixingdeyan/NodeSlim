'use strict';

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  if (bytes == null || isNaN(bytes)) return '-';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const idx = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, idx)).toFixed(decimals))} ${sizes[idx]}`;
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US');
}

function stripAnsi(str) {
  return String(str).replace(/\x1b\[[0-9;]*m/g, '');
}

function progressBar(current, total, width = 20) {
  const ratio = total === 0 ? 0 : current / total;
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

module.exports = { formatBytes, formatNumber, progressBar, stripAnsi };
