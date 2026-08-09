#!/usr/bin/env node
/**
 * changelog-forge / src/changelog-forge.js
 * Generates a polished CHANGELOG.md from git log, grouped by Conventional Commit type.
 *
 * Usage:
 *   node src/changelog-forge.js --write
 *   node src/changelog-forge.js --from v1.0.0 --to HEAD
 *   node src/changelog-forge.js --version 1.2.0 --write
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function sh(cmd) {
  try {
    return execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch (e) {
    return '';
  }
}

const TYPE_LABELS = {
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Performance',
  docs: 'Documentation',
  refactor: 'Changed',
  style: 'Changed',
  test: 'Testing',
  build: 'Build',
  ci: 'CI',
  chore: 'Chore',
  revert: 'Reverted',
};

const HEADER_RE = /^(?<type>[a-z]+)(\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<subject>.+)$/;

function parseArgs(argv) {
  const args = { from: null, to: 'HEAD', write: false, version: null, file: 'CHANGELOG.md' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--write') args.write = true;
    else if (a === '--version') args.version = argv[++i];
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--help') args.help = true;
  }
  return args;
}

function lastTag() {
  return sh('git describe --tags --abbrev=0');
}

function collectCommits(from, to) {
  const range = from ? `${from}..${to}` : to;
  const log = sh(`git log ${range} --pretty=format:%H%x1f%s`);
  if (!log) return [];
  return log.split('\n').map((line) => {
    const [hash, subject] = line.split('\x1f');
    return { hash: hash ? hash.slice(0, 7) : '', subject: subject || '' };
  });
}

function groupCommits(commits) {
  const groups = {};
  const breaking = [];
  const uncategorized = [];

  commits.forEach(({ hash, subject }) => {
    const match = HEADER_RE.exec(subject);
    if (!match) {
      uncategorized.push({ hash, subject });
      return;
    }
    const { type, scope, breakingMark, subject: msg } = { ...match.groups, breakingMark: match.groups.breaking };
    const label = TYPE_LABELS[type] || 'Other';
    const entry = { hash, scope, subject: msg };
    if (breakingMark || /BREAKING CHANGE/.test(subject)) {
      breaking.push(entry);
    }
    groups[label] = groups[label] || [];
    groups[label].push(entry);
  });

  return { groups, breaking, uncategorized };
}

function renderSection(version, date, groups, breaking) {
  const lines = [`## [${version}] - ${date}`, ''];

  if (breaking.length) {
    lines.push('### ⚠ BREAKING CHANGES');
    breaking.forEach((e) => lines.push(`- ${e.scope ? `**${e.scope}:** ` : ''}${e.subject} (${e.hash})`));
    lines.push('');
  }

  const order = ['Added', 'Fixed', 'Performance', 'Changed', 'Documentation', 'Testing', 'Build', 'CI', 'Chore', 'Reverted', 'Other'];
  order.forEach((label) => {
    const entries = groups[label];
    if (!entries || !entries.length) return;
    lines.push(`### ${label}`);
    entries.forEach((e) => lines.push(`- ${e.scope ? `**${e.scope}:** ` : ''}${e.subject} (${e.hash})`));
    lines.push('');
  });

  return lines.join('\n');
}

function printHelp() {
  console.log(`changelog-forge — generate CHANGELOG.md from Conventional Commits

Usage:
  changelog-forge --write                  Generate section since last tag, prepend to CHANGELOG.md
  changelog-forge --from v1.0.0 --to HEAD  Print (don't write) the section for a specific range
  changelog-forge --version 1.2.0 --write  Use an explicit version label instead of the next-tag guess`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const from = args.from || lastTag();
  const commits = collectCommits(from, args.to);

  if (commits.length === 0) {
    console.log(from ? `No commits since ${from}.` : 'No commits found in this repository yet.');
    return;
  }

  const { groups, breaking, uncategorized } = groupCommits(commits);
  const version = args.version || 'Unreleased';
  const date = new Date().toISOString().slice(0, 10);
  const section = renderSection(version, date, groups, breaking);

  console.log(section);
  if (uncategorized.length) {
    console.log(`\n(${uncategorized.length} commit(s) did not match Conventional Commits format and were left out)`);
  }

  if (args.write) {
    const filePath = path.resolve(process.cwd(), args.file);
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '# Changelog\n\n';
    const marker = '# Changelog';
    let updated;
    if (existing.startsWith(marker)) {
      const rest = existing.slice(marker.length).replace(/^\n+/, '');
      updated = `${marker}\n\n${section}\n\n${rest}`;
    } else {
      updated = `${marker}\n\n${section}\n\n${existing}`;
    }
    fs.writeFileSync(filePath, updated);
    console.log(`\n✓ Prepended section to ${filePath}`);
  }
}

main();
