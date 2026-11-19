#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { error, log } from 'node:console';

const ROOT = resolve(process.argv[2] || process.cwd());
const EXCLUDED_FILES = new Set([
  'scripts/check-env-names.mjs',
  'shared/contractEnvAliases.ts',
  'shared/contractEnvironment.ts',
  'server/legacyContractEnv.js',
  'src/vite-env.d.ts',
]);
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'docs',
]);
const LEGACY_PATTERNS = [
  /\bVITE_HELPHONE_CONTRACT_ID\b/,
  /\bVITE_HELPHONE_DAO_CONTRACT_ID\b/,
  /\bVITE_MAINTAINER_VAULT_CONTRACT_ID\b/,
  /\bHELPHONE_CONTRACT_ID\b/,
  /\bprocess\.env\.CONTRACT_ID\b/,
];

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walk(path, files);
    } else if (
      entry.name.startsWith('.env.') ||
      /\.(?:[cm]?[jt]sx?|json|ya?ml|sh|toml)$/.test(entry.name)
    ) {
      files.push(path);
    }
  }
  return files;
}

const findings = [];
for (const file of walk(ROOT)) {
  const relativePath = relative(ROOT, file).replaceAll('\\', '/');
  if (EXCLUDED_FILES.has(relativePath)) continue;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const legacyBareEnvironmentName =
      (relativePath.startsWith('.env.') && /^\s*CONTRACT_ID\s*=/.test(line)) ||
      (/\.ya?ml$/.test(relativePath) &&
        /^\s*(?:-\s*)?key:\s*CONTRACT_ID\s*$/.test(line));
    if (
      legacyBareEnvironmentName ||
      LEGACY_PATTERNS.some((pattern) => pattern.test(line))
    ) {
      findings.push(`${relativePath}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (findings.length) {
  error('Deprecated contract environment names found:');
  for (const finding of findings) error(`  ${finding}`);
  process.exitCode = 1;
} else {
  log('Contract environment names are canonical.');
}
