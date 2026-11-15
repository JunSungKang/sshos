import { spawn } from 'node:child_process';
import { root, runtimeEnvironment } from './environment.mjs';
const env = runtimeEnvironment('development');
Object.assign(process.env, env);
const { default: electron } = await import('electron');
const child = spawn(electron, [`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`, root], { cwd: root, env, stdio: 'inherit' });
child.on('error', () => { console.error('Could not launch the built application. Run npm run build first.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
