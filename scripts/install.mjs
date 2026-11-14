import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, runtimeEnvironment, localPath } from './environment.mjs';
const baseline = JSON.parse(readFileSync(join(root, 'docs/dependency-baseline-v6.json'), 'utf8'));
if (process.versions.node !== baseline.development_node) {
  console.error(`Development requires Node ${baseline.development_node}; current ${process.versions.node}.`);
  process.exit(2);
}
const env = { ...runtimeEnvironment('development'), npm_config_devdir: localPath('node-gyp'), npm_config_update_notifier: 'false' };
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) process.exit(result.status ?? 1);
const install = spawnSync(process.execPath, [join(root, 'node_modules/electron/install.js')], { cwd: root, env, stdio: 'inherit' });
process.exitCode = install.status ?? 1;
