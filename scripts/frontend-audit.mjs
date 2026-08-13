#!/usr/bin/env node
/**
 * frontend-audit.mjs — LOC / file-count inventory for www/js and www/admin/js.
 *
 * Outputs a Markdown table to backup/architecture_v5/plan/baseline-audit.md
 * Run via: npm run audit:frontend
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** Recursively collect all .js files under a directory. */
function collectJs(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectJs(full));
    } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
      results.push(full);
    }
  }
  return results;
}

/** Count newlines in a file (= LOC). */
function countLines(filePath) {
  try {
    return readFileSync(filePath, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

/** Whether file content matches the regex at least once. */
function hasMatch(content, re) {
  return re.test(content);
}

/**
 * Summarise a single top-level directory under a root.
 * Returns { name, files, loc, privateAccessFiles, viMockFiles }.
 */
function summariseDir(rootDir, subDir) {
  const dir = join(rootDir, subDir);
  const files = collectJs(dir);
  let loc = 0;
  let privateAccessFiles = 0;
  let viMockFiles = 0;
  for (const f of files) {
    let content;
    try { content = readFileSync(f, 'utf8'); } catch { continue; }
    loc += content.split('\n').length;
    // Best-effort: identifier starting with _ accessed on an imported symbol.
    if (hasMatch(content, /\b\w+\._[a-zA-Z]/)) privateAccessFiles += 1;
    if (hasMatch(content, /vi\.(mock|fn|spyOn)\s*\(/)) viMockFiles += 1;
  }
  return { name: subDir, files: files.length, loc, privateAccessFiles, viMockFiles };
}

/**
 * Produce a row for a single loose file (e.g. config.js, app.js).
 */
function summariseFile(filePath, label) {
  let content = '';
  try { content = readFileSync(filePath, 'utf8'); } catch { /* skip */ }
  const loc = content ? content.split('\n').length : 0;
  return { name: label, files: 1, loc, privateAccessFiles: 0, viMockFiles: 0 };
}

/**
 * Summarise tests/ directory with sub-directory breakdown.
 */
function summariseTests(testsDir) {
  const files = collectJs(testsDir);
  let totalLoc = 0;
  let filesWithPrivateAccess = 0;
  let filesWithViMocks = 0;
  let testCaseCount = 0;
  let expectCount = 0;
  let skippedTests = 0;
  let filesMockingApplicationImports = 0;
  const subDirCounts = {};

  for (const f of files) {
    let content = '';
    try { content = readFileSync(f, 'utf8'); } catch { continue; }
    totalLoc += content.split('\n').length;
    if (hasMatch(content, /\b\w+\._[a-zA-Z]/)) filesWithPrivateAccess += 1;
    if (hasMatch(content, /vi\.(mock|fn|spyOn)\s*\(/)) filesWithViMocks += 1;
    testCaseCount += (content.match(/\b(?:it|test)\s*\(/g) || []).length;
    expectCount += (content.match(/\bexpect\s*\(/g) || []).length;
    skippedTests += (content.match(/\b(?:describe|it|test)\.skip\s*\(|\bxdescribe\s*\(|\bxit\s*\(/g) || []).length;
    if (hasMatch(content, /vi\.mock\(\s*['\"][^'\"]*\/application\/imports\.js['\"]/)) {
      filesMockingApplicationImports += 1;
    }

    const rel = relative(testsDir, f);
    const top = rel.includes('/') ? rel.split('/')[0] : '(root)';
    subDirCounts[top] = (subDirCounts[top] || 0) + 1;
  }
  return {
    totalFiles: files.length,
    totalLoc,
    filesWithPrivateAccess,
    filesWithViMocks,
    testCaseCount,
    expectCount,
    skippedTests,
    filesMockingApplicationImports,
    subDirCounts,
  };
}

// ── www/js ────────────────────────────────────────────────────────────────────
const wwwJs = join(ROOT, 'www/js');
const wwwDirs = ['application', 'core', 'services', 'components', 'plugins', 'config'];
const wwwLooseFiles = [
  ['app.js', join(wwwJs, 'app.js')],
  ['config.js', join(wwwJs, 'config.js')],
];
const wwwRows = wwwDirs.map(d => summariseDir(wwwJs, d));
const wwwLooseRows = wwwLooseFiles.map(([label, path]) => summariseFile(path, label));

// ── www/admin/js ──────────────────────────────────────────────────────────────
const adminJs = join(ROOT, 'www/admin/js');
const adminDirs = ['core', 'services', 'components'];
const adminLooseFiles = [['admin.js', join(adminJs, 'admin.js')]];
const adminRows = adminDirs.map(d => summariseDir(adminJs, d));
const adminLooseRows = adminLooseFiles.map(([label, path]) => summariseFile(path, label));

// ── tests/ ────────────────────────────────────────────────────────────────────
const testsDir = join(ROOT, 'tests');
const testsSummary = summariseTests(testsDir);

// ── totals ────────────────────────────────────────────────────────────────────
function total(rows) {
  return rows.reduce((acc, r) => ({
    name: 'TOTAL', files: acc.files + r.files, loc: acc.loc + r.loc,
    privateAccessFiles: acc.privateAccessFiles + r.privateAccessFiles,
    viMockFiles: acc.viMockFiles + r.viMockFiles,
  }), { name: 'TOTAL', files: 0, loc: 0, privateAccessFiles: 0, viMockFiles: 0 });
}

const wwwTotal = total([...wwwRows, ...wwwLooseRows]);
const adminTotal = total([...adminRows, ...adminLooseRows]);

// ── render ────────────────────────────────────────────────────────────────────
const now = new Date().toISOString().slice(0, 10);

function tableRow(r) {
  return `| \`${r.name}\` | ${r.files} | ${r.loc.toLocaleString()} | ${r.privateAccessFiles} | ${r.viMockFiles} |`;
}

const subDirTable = Object.entries(testsSummary.subDirCounts)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([dir, count]) => `| \`${dir}/\` | ${count} |`)
  .join('\n');

const md = `# Frontend Baseline Audit

Generated: ${now}  
Script: \`scripts/frontend-audit.mjs\`  
**Re-run \`npm run audit:frontend\` after any phase to keep this current.**

---

## www/js/ (excl. vendor/)

| Directory | Files | LOC | Files with private-field access¹ | Files with vi.mock/fn/spyOn |
|---|---:|---:|---:|---:|
${[...wwwRows, ...wwwLooseRows].map(tableRow).join('\n')}
| **${wwwTotal.name}** | **${wwwTotal.files}** | **${wwwTotal.loc.toLocaleString()}** | **${wwwTotal.privateAccessFiles}** | **${wwwTotal.viMockFiles}** |

---

## www/admin/js/

| Directory | Files | LOC | Files with private-field access¹ | Files with vi.mock/fn/spyOn |
|---|---:|---:|---:|---:|
${[...adminRows, ...adminLooseRows].map(tableRow).join('\n')}
| **${adminTotal.name}** | **${adminTotal.files}** | **${adminTotal.loc.toLocaleString()}** | **${adminTotal.privateAccessFiles}** | **${adminTotal.viMockFiles}** |

---

## tests/

| Metric | Value |
|---|---:|
| Total test files | ${testsSummary.totalFiles} |
| Total LOC | ${testsSummary.totalLoc.toLocaleString()} |
| Test cases (it/test) | ${testsSummary.testCaseCount.toLocaleString()} |
| expect() call sites | ${testsSummary.expectCount.toLocaleString()} |
| Files with private-field access¹ | ${testsSummary.filesWithPrivateAccess} |
| Files with vi.mock/fn/spyOn | ${testsSummary.filesWithViMocks} |
| Files mocking application/imports.js seam | ${testsSummary.filesMockingApplicationImports} |
| Skipped tests (describe.skip/it.skip/xdescribe/xit) | ${testsSummary.skippedTests} |

### Test files per subdirectory

| Subdirectory | Files |
|---|---:|
${subDirTable}

---

¹ _Private-field access_ is a best-effort regex (\`identifier._name\`). The count is file-based, not
  occurrence-based, so it is useful for phase-to-phase drift tracking.

---

## ESLint guard-rule warnings baseline

<!-- Updated manually after \`npm run lint\` with guard rule active -->
<!-- See guard-warnings-baseline.md for per-rule breakdown -->

_See \`guard-warnings-baseline.md\` in this directory for the initial count._
`;

const outPath = join(ROOT, 'backup/architecture_v5/plan/baseline-audit.md');
writeFileSync(outPath, md, 'utf8');
console.log(`✓ Written: ${outPath}`);

// Also print a compact summary to stdout
console.log(`\nwww/js     : ${wwwTotal.files} files, ${wwwTotal.loc.toLocaleString()} LOC`);
console.log(`www/admin/js: ${adminTotal.files} files, ${adminTotal.loc.toLocaleString()} LOC`);
console.log(`tests/     : ${testsSummary.totalFiles} files, ${testsSummary.totalLoc.toLocaleString()} LOC`);
