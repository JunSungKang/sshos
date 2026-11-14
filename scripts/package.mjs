import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, runtimeEnvironment } from './environment.mjs';
const status = JSON.parse(readFileSync(join(root, 'docs/implementation-status.json'), 'utf8'));
if (status.release_ready !== true) {
  console.error('Packaging is unavailable until target, signing and production fuse verification are complete. See docs/implementation-status.json.');
  process.exit(2);
}
const target = process.argv[2];
if (!['win', 'mac'].includes(target)) throw new Error('Unsupported package target');
const args = [join(root, 'node_modules/electron-builder/cli.js'), ...(target === 'win' ? ['--win', 'portable', '--x64'] : ['--mac', 'zip', '--arm64', '--x64'])];
const child = spawnSync(process.execPath, args, { cwd: root, env: runtimeEnvironment('packaging'), stdio: 'inherit' });
process.exitCode = child.status ?? 1;
