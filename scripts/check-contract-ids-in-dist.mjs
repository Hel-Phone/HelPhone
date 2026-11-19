#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '../contracts/manifest.json' with { type: 'json' };

const distDir = process.argv[2] || 'dist';
if (!existsSync(distDir)) {
  console.error(`[contract-id-check] Build output not found: ${distDir}`);
  process.exit(1);
}

const markerPath = join(distDir, 'contract-network.json');
if (!existsSync(markerPath)) {
  console.error(`[contract-id-check] Missing ${markerPath}; build must declare its network.`);
  process.exit(1);
}

const { network } = JSON.parse(readFileSync(markerPath, 'utf8'));
if (network !== 'testnet' && network !== 'mainnet') {
  console.error(`[contract-id-check] Invalid build network: ${network}`);
  process.exit(1);
}

const assets = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(js|mjs|cjs|html|css|json|txt|svg)$/.test(entry.name)) {
      assets.push(readFileSync(path, 'utf8'));
    }
  }
}
walk(distDir);
const bundle = assets.join('\n');

const failures = [];
for (const [contract, deployments] of Object.entries(manifest)) {
  const targetId = deployments[network].id;
  const otherNetwork = network === 'testnet' ? 'mainnet' : 'testnet';
  const otherId = deployments[otherNetwork].id;

  if (targetId !== 'UNDEPLOYED' && !bundle.includes(targetId)) {
    failures.push(`expected ${contract} ${network} ID is absent from dist`);
  }
  if (otherId !== 'UNDEPLOYED' && bundle.includes(otherId)) {
    failures.push(`${contract} ${otherNetwork} ID is present in ${network} dist`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`[contract-id-check] ${failure}`);
  process.exit(1);
}

console.log(`[contract-id-check] ${network} bundle contains only target-network manifest IDs`);
