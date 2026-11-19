import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const registry = JSON.parse(readFileSync(join(root, 'docs/prototype-registry.json'), 'utf8'));
const extensions = ['.ts', '.tsx', '.js', '.jsx'];
const candidateDirs = ['src/lib', 'server/db'];
const sourceDirs = ['src', 'server'];
const isSource = (file) => extensions.some((ext) => file.endsWith(ext)) && !/\.(test|spec|d)\.[jt]sx?$/.test(file) && !file.includes('__tests__');

function walk(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path.replaceAll('\\', '/')];
  });
}

const sources = sourceDirs.flatMap(walk).filter(isSource);
const candidates = candidateDirs.flatMap(walk).filter(isSource);
const imports = new Map(candidates.map((file) => [file, []]));
const importsRegex = /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/g;
for (const source of sources) {
  const body = readFileSync(join(root, source), 'utf8');
  for (const match of body.matchAll(importsRegex)) {
    const spec = match[1];
    const target = spec.startsWith('@/')
      ? join(root, 'src', spec.slice(2))
      : spec.startsWith('.') ? resolve(root, dirname(source), spec) : null;
    if (!target) continue;
    // TypeScript source often imports the .js path that its compiled output will use.
    const targets = [target];
    if (target.endsWith('.js')) targets.push(target.slice(0, -3) + '.ts');
    if (target.endsWith('.jsx')) targets.push(target.slice(0, -4) + '.tsx');
    for (const candidate of targets) {
      for (const ext of ['', ...extensions, ...extensions.map((extension) => `/index${extension}`)]) {
        const key = relative(root, candidate + ext).replaceAll('\\', '/');
        if (key !== source && imports.has(key)) imports.get(key).push(source);
      }
    }
  }
}

if (process.argv.includes('--list')) {
  process.stdout.write(JSON.stringify(candidates.filter((file) => imports.get(file).length === 0), null, 2) + '\n');
  process.exit(0);
}

const failures = [];
for (const file of candidates) {
  const entry = registry[file];
  const referenced = imports.get(file).length > 0;
  if (!referenced && !entry) failures.push(`${file}: no production imports; add a prototype-registry entry`);
  if (entry && !['wired', 'prototype-only', 'deprecated'].includes(entry.state)) failures.push(`${file}: invalid registry state`);
  if (entry?.state === 'prototype-only' && referenced) failures.push(`${file}: now imported by ${imports.get(file).join(', ')}; mark wired after integration review`);
  if (entry?.state === 'wired' && !referenced && !entry.entrypoint) failures.push(`${file}: no longer imported; mark prototype-only or restore integration`);
}
for (const file of Object.keys(registry)) {
  if (!candidates.includes(file)) failures.push(`${file}: registered file no longer exists`);
}
if (failures.length) {
  process.stderr.write(failures.join('\n') + '\nSee docs/prototype-registry.md for the review process.\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`Prototype registry checked ${candidates.length} modules.\n`);
}
