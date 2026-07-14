#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOT = path.join(ROOT, 'www', 'js');
const ALLOWED_STATE_IMPORT_FILE = path.normalize(
  path.join('www', 'js', 'application', 'plannerApplication.js')
);

const JS_FILE_EXTENSIONS = new Set(['.js', '.mjs']);
const ASSIGNMENT_OPERATORS = ['=', '+=', '-=', '*=', '/=', '%='];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function walkFiles(dirPath, files = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.name === 'dist' || entry.name === 'node_modules') {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
      continue;
    }
    const extension = path.extname(entry.name);
    if (JS_FILE_EXTENSIONS.has(extension)) {
      files.push(fullPath);
    }
  }
  return files;
}

function isStateImportLine(line) {
  return /from\s+['\"][^'\"]*services\/State\.js['\"]/.test(line);
}

function hasDirectGetStateMutation(line) {
  if (!line.includes('getState()')) return false;
  if (/\bdelete\s+[^;]*getState\(\)\s*\./.test(line)) return true;
  if (/\bgetState\(\)\s*(\.|\[[^\]]+\])/.test(line)) {
    return ASSIGNMENT_OPERATORS.some((operator) =>
      new RegExp(`\\bgetState\\(\\)\\s*(?:\\.|\\[[^\\]]+\\])[^;]*\\\\${operator}`).test(line)
    ) || /\bgetState\(\)\s*(\.|\[[^\]]+\])[^;]*(\+\+|--)/.test(line);
  }
  return false;
}

function getAliasFromStateSnapshot(line) {
  const match = line.match(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*\bgetState\(\)\s*;?/);
  return match ? match[1] : null;
}

function hasAliasMutation(line, alias) {
  const aliasPattern = `${alias}(?:\\.|\\[[^\\]]+\\])`;
  if (new RegExp(`\\bdelete\\s+${aliasPattern}`).test(line)) return true;
  for (const operator of ASSIGNMENT_OPERATORS) {
    if (new RegExp(`\\b${aliasPattern}[^;]*\\${operator}`).test(line)) return true;
  }
  return new RegExp(`\\b${aliasPattern}[^;]*(\\+\\+|--)`).test(line);
}

function run() {
  if (!fs.existsSync(SCAN_ROOT)) {
    console.error('Runtime guard failed: www/js directory is missing.');
    process.exit(2);
  }

  const files = walkFiles(SCAN_ROOT);
  const violations = [];

  for (const filePath of files) {
    const relativePath = path.normalize(path.relative(ROOT, filePath));
    const displayPath = toPosix(relativePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const snapshotAliases = new Map();

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      if (isStateImportLine(line) && relativePath !== ALLOWED_STATE_IMPORT_FILE) {
        violations.push(
          `${displayPath}:${lineNumber} forbidden State.js import (allowed only in ${toPosix(ALLOWED_STATE_IMPORT_FILE)})`
        );
      }

      if (hasDirectGetStateMutation(line)) {
        violations.push(
          `${displayPath}:${lineNumber} direct AppStore snapshot mutation via getState() is forbidden`
        );
      }

      const alias = getAliasFromStateSnapshot(line);
      if (alias) {
        snapshotAliases.set(alias, lineNumber);
      }

      for (const [aliasName, aliasLine] of snapshotAliases.entries()) {
        if (lineNumber === aliasLine) continue;
        if (hasAliasMutation(line, aliasName)) {
          violations.push(
            `${displayPath}:${lineNumber} AppStore snapshot alias '${aliasName}' is mutated (declared at line ${aliasLine})`
          );
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error('Runtime state guard violations found:');
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }

  console.log(`Runtime state guard passed (${files.length} files checked).`);
}

run();
